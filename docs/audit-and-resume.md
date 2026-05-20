---
title: Audit & resume
layout: default
nav_order: 5
description: ".ai/scratch/ and .ai/audit/ layout, workflow lifecycle, crash recovery, conflict resolution, audit event schema."
---

# Scratch state, audit log, and resume

SPEX records every long-running operation in two on-disk locations under the project root:

- `.ai/scratch/` — **transient working state**. The contract is that any `spex new` / `spex implement` / `spex fix` can be killed and re-launched, and the next run will pick up where the prior left off (or surface a clean conflict resolution).
- `.ai/audit/` — **append-only history**. Every LLM call, file write, git operation, decision, and approval is logged here. Used by `spex logs` for querying and never modified after write.

This page explains the layout, the lifecycle, and the recovery semantics.

---

## Layout

```
.ai/
├── audit/
│   ├── global.jsonl                    # every event, every workflow
│   ├── workflow-<id>.jsonl             # per-workflow stream
│   └── decisions-<ISO-timestamp>.jsonl # legacy decision-only log written
│                                       # by `spex new` proposal gates
└── scratch/
    ├── session.yaml                    # current active workflow pointer
    ├── lock                            # global mutex (optional)
    ├── approvals/                      # Slack async approval state
    │   └── <correlation-id>.json
    └── workflows/
        └── <workflow-id>/
            ├── state.yaml              # ScratchState
            ├── checkpoints/            # named checkpoints with file snapshots
            │   └── <name>.yaml
            └── lock                    # per-workflow mutex
```

`<workflow-id>` matches the pattern `^[a-z0-9][a-z0-9_-]{0,127}$`.

---

## Workflow lifecycle

`ScratchState.kind` is one of:

| Kind | Originating command |
|---|---|
| `discovery` | `spex new` / `spex init` (adaptive discovery flow) |
| `proposal` | `spex new` (decision gates) |
| `implementation` | `spex implement` |
| `fix` | `spex fix` |

`ScratchState.status` transitions through:

| Status | Meaning |
|---|---|
| `running` | The owning process is currently executing the workflow. The lock file is held. |
| `paused` | The user pressed `[p]`. State + last checkpoint are durable. The process exited cleanly. |
| `completed` | The workflow ran to its terminal state. Eligible for retention cleanup. |
| `abandoned` | The user explicitly discarded it via `spex resume --abandon <id>`. Cleaned up after retention. |
| `crashed` | The process died and the next `spex resume` invocation detected it (PID gone or hostname mismatch with no live process). |

State transitions are themselves logged as `state_transition` events in the audit log.

---

## File snapshots and drift detection

Each checkpoint stores `FileSnapshot[]` for every file the workflow touched:

```yaml
fileSnapshots:
  - path: src/api/login.ts
    hash: <SHA-256 hex>
    size: 1483
    exists: true
```

On `spex resume`, SPEX re-reads each path and compares the current SHA-256 against the snapshot:

| State on disk | Snapshot says | Classification |
|---|---|---|
| Same hash | exists | `unchanged` |
| Different hash | exists | `modified` |
| Missing | exists | `deleted` |
| Present | did not exist at checkpoint time | `unexpected` |

`buildConflictReport` aggregates these into a typed `ConflictReport`. `resolveConflicts` drives an interactive resolution loop via a pluggable `ConflictPrompter` with four per-file outcomes:

- `keep_current` — accept what's on disk now.
- `restore_checkpoint` — overwrite with the snapshot version.
- `diff` — re-prompt (after showing a diff).
- `abort` — stop the loop and flag the report aborted.

---

## Crash recovery

`detectCrashedWorkflows` runs at the start of every `spex resume`. It classifies any workflow in `running` status:

| Classification | Trigger | Action |
|---|---|---|
| `clean` | Status is actually `paused` — no recovery needed. | None. |
| `interrupted` | PID is gone (`process.kill(pid, 0)` throws ESRCH) and no file drift. | Workflow safely resumable; status flipped to `crashed`. |
| `partial_write` | PID is gone AND at least one file hash diverges from the last checkpoint. | Same as `interrupted` plus the divergent paths are flagged for review before resume. |
| `foreign_host` | The lock was acquired on a different machine (`hostname` mismatch). We can't check PID liveness across hosts. | Surface to the user; do not auto-act. |

PID liveness uses the POSIX-portable `process.kill(pid, 0)` (signal 0 just tests permission/existence). Hostname comes from the lock file, written at acquisition time.

---

## Locks

SPEX uses two layers:

- **Per-workflow lock** at `.ai/scratch/workflows/<id>/lock`. Acquired for the duration of the run. Holds `{ workflowId, pid, hostname, acquiredAt }`.
- **Global lock** at `.ai/scratch/lock` (optional). Used by operations that mutate the workflow index (e.g. abandonment).

Both are advisory — `acquireLock` writes the file, `readLock` parses it, `releaseLock` removes it. The CLI never force-acquires a held lock; if the holder is alive, the new caller exits with a clear error.

---

## Audit log

The audit infrastructure is built on `createAuditLogger` (writer) and `createAuditReader` (query). Every event conforms to `AuditEventSchema`:

```ts
{
  timestamp: string;       // ISO-8601 UTC
  workflowId: string;      // matches the workflow's id
  type: AuditEventType;
  actor: AuditActor;       // user | agent | system
  payload: Record<string, unknown>;
  correlationId?: string;
}
```

### Event types

| Type | Emitted when |
|---|---|
| `llm_call` | Any call into the LLM provider (`generateStructured`, `generateText`). Payload includes the model, token counts, latency, and a redacted prompt summary. |
| `decision` | Each iterative decision gate during `spex new` (accept / reject / debate / explore / modify / pause). Payload includes the decision id, the original AI proposal, the resolved value, the confidence rating, and any user note. |
| `file_write` | Any file the executor or scaffold runner writes to disk. Payload includes the relative path and a hash. |
| `file_read` | Any file the context aggregator reads (subject to token budget). |
| `git_operation` | Branch creation, commit, push, status check. Payload includes operation kind + ref. |
| `tool_invocation` | Any third-party tool / MCP call (PostHog MCP, Linear API, GitHub Octokit). |
| `approval` | Async approval gate state changes (pending → approved / rejected / expired). |
| `error` | Any caught error surfaced to the user. |
| `state_transition` | Workflow status changes (`running` → `paused`, etc.). |

### File layout

Two streams in parallel:

- `.ai/audit/global.jsonl` — every event from every workflow.
- `.ai/audit/workflow-<id>.jsonl` — one stream per workflow.

Both are JSONL — append-only, one event per line. `spex logs` reads them with filters applied in-memory.

### Secret redaction

Every event passes through a redactor before write. Defaults cover:

| Pattern | Source |
|---|---|
| `sk-ant-…` | Anthropic API keys |
| `sk-…` | OpenAI API keys |
| `ghp_…`, `github_pat_…`, `ghs_…`, `gho_…`, `ghu_…` | GitHub tokens |
| `xoxb-…`, `xoxp-…`, `xapp-…` | Slack tokens |
| `lin_api_…` | Linear API keys |
| `phx_…`, `phc_…` | PostHog keys |
| `Bearer …` | Generic bearer tokens (case-insensitive) |
| Keys named `api_key`, `secret`, `password`, `token`, `authorization`, `x-api-key`, … | Replaced with `<redacted>`. |

Redaction is applied to both top-level event fields and recursive payload values.

---

## Decision audit (legacy stream)

The `spex new` decision gate flow ALSO writes to `.ai/audit/decisions-<ISO-timestamp>.jsonl`. This predates the global audit log and is preserved for diffability across runs. Each line is one decision with:

- decision id, order, category, target tech-spec path
- AI's original proposal + rationale + confidence
- user-resolved value (only when different from the proposal)
- optional user note
- ISO timestamp

This stream is append-only by design — easy to diff with `git diff` style tools across multiple runs of `spex new`.

---

## Retention

`StateStore.cleanup({ retention })` is called periodically (and on workflow completion) with a retention policy. The defaults retain:

- All `running` and `paused` workflows.
- The last N `completed` workflows (configurable).
- The last N `abandoned` workflows (configurable).
- All `crashed` workflows until explicitly abandoned by the user.

The audit log itself is **never auto-pruned** — it is the durable history. Users who want to compress old streams can do so manually.

---

## Slack approvals

Slack's async approval gate has its own state directory at `.ai/scratch/approvals/<correlation-id>.json`. Each file holds:

- decision mode (`any_of` / `all_of` / `quorum`)
- approver allow-list
- timeout deadline
- decision log (one entry per approve / reject vote)
- final status (`pending` / `approved` / `rejected` / `expired`)

Files are written with mode `0o600` on POSIX. Lazy expiry happens on the next decision attempt after the deadline; an `expirePendingApprovals` sweep also runs periodically.

See [`docs/configuration.md`](./configuration.md#approvals) for the config block that drives these defaults.

---

## Querying via `spex logs`

```bash
spex logs                                       # last 100 events, table
spex logs --workflow wf_2026-05-20T...          # one workflow
spex logs --since 1h                            # 1h back; also 30m, 2d, 1w
spex logs --type llm_call --actor agent         # combine filters
spex logs --format summary                      # rollup by type + actor
spex logs --format json                         # raw events, pretty
spex logs --export audit-snapshot.json          # to disk
spex logs --tail                                # current snapshot (live follow not yet implemented)
```

Filters compose with AND semantics. See the [`spex logs` CLI reference](./cli-reference.md#spex-logs) for the full flag list.

---

## Resuming via `spex resume`

```bash
spex resume                       # interactive picker
spex resume <workflow-id>         # resume by id
spex resume --list                # enumerate without resuming
spex resume --abandon <id>        # delete a workflow's scratch state
```

On resume:

1. Re-reads `state.yaml` and the latest checkpoint.
2. Re-runs `detectCrashedWorkflows` (only relevant for `running` status).
3. Runs `buildConflictReport` against the on-disk files.
4. If conflicts exist, drives `resolveConflicts` interactively.
5. Routes back into the originating flow (proposal continues from the same decision id, implementation continues from the next planned operation, etc.).

If the originating CLI command was `spex new --resume <name>`, the project-level scratch file (`<parentDir>/.<projectName>-spex-proposal.yaml`) is loaded instead — that file predates the workflow-id-based scratch and is preserved for compatibility with paused proposals.

---

## MCP exposure

The `spex_resume` MCP tool exposes the inspect / resume / abandon operations to MCP-aware IDEs. See [`docs/mcp-integration.md`](./mcp-integration.md#resume--audit-log-via-mcp) for the wire shape.

The audit log itself is **not** an MCP tool — it is a local on-disk record. Use the `spex logs` CLI from the same project for querying.

---

## Related schemas

- `ScratchStateSchema`, `CheckpointSchema`, `FileSnapshotSchema`, `ScratchLockSchema`, `ScratchSessionSchema`, `AuditEventSchema` — all in [`packages/schemas/src/scratch-state.ts`](../packages/schemas/src/scratch-state.ts).
- `WORKFLOW_ID_PATTERN` — the regex that constrains workflow ids.

## Related docs

- [`docs/cli-reference.md`](./cli-reference.md) — every command that reads or writes scratch state / audit log.
- [`docs/configuration.md`](./configuration.md) — Slack approval config (the only `.ai/config.yaml` block that affects `.ai/scratch/approvals/`).
- [`docs/mcp-integration.md`](./mcp-integration.md) — the `spex_resume` MCP tool.
