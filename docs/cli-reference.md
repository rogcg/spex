---
title: CLI reference
layout: default
nav_order: 2
description: "Every spex subcommand — arguments, flags, env vars, exit codes, examples."
---

# SPEX CLI reference

This page lists every `spex` subcommand: its arguments, flags, environment
requirements, exit behaviour, and concrete invocations. For broader topics
(audit log, scratch state, integrations) follow the cross-links at the
bottom of each section.

> Until SPEX is published to npm, the binary is `node packages/cli/dist/index.js`
> by default. The examples below assume you have made it callable as `spex` via
> `pnpm --filter @spex/cli link --global` or `npm link`.

---

## Command index

| Command | Purpose |
|---|---|
| [`spex new`](#spex-new-name) | Create a new SPEX-managed project from scratch. |
| [`spex init`](#spex-init) | Add `.ai/` infrastructure to an existing project. |
| [`spex implement`](#spex-implement-description) | Implement a single feature in the current project. |
| [`spex fix`](#spex-fix-description) | Diagnose a bug, propose a fix, generate + verify a regression test. |
| [`spex review`](#spex-review-pr-ref) | Review a GitHub PR against its linked feature spec and project conventions. |
| [`spex github setup`](#spex-github-setup) | Install SPEX GitHub Actions workflow templates into the current project. |
| [`spex skills install`](#spex-skills-install) | Copy SPEX skill bundles into a Claude Code skills directory. |
| [`spex resume`](#spex-resume-workflow-id) | Resume a paused or interrupted SPEX workflow under `.ai/scratch/`. |
| [`spex logs`](#spex-logs) | Query the audit log under `.ai/audit/`. |
| [`spex linear-sync`](#spex-linear-sync) | Sync a GitHub PR lifecycle event to the linked Linear issue (CI use). |
| [`spex posthog-webhook`](#spex-posthog-webhook) | Handle a PostHog error-tracking webhook delivery (CI / serverless use). |
| [`spex slack-webhook`](#spex-slack-webhook) | Handle a Slack slash-command or block_actions delivery (CI / serverless use). |
| [`spex mcp-server`](#spex-mcp-server) | Start SPEX as an MCP server over stdio for Claude Code / Cursor. |

---

## Global behaviour

- **Banner.** All interactive commands print a one-line banner. `spex mcp-server` does **not**, so it cannot corrupt the JSON-RPC stream.
- **Exit codes.** `0` on success, `1` on any caught error. Errors are written to stderr (so they never corrupt the MCP stdio framing when the failure happens inside `spex mcp-server`).
- **Logging.** Library code uses pino, written to `stderr` by default. Override via `SPEX_LOG_DEST` (`stderr` | `stdout` | `file:<path>`) and `SPEX_LOG_LEVEL` (`debug` | `info` | `warn` | `error`).
- **API keys.** `ANTHROPIC_API_KEY` is required for every command that calls an LLM (every command except `github setup`, `skills install`, `mcp-server` startup, `resume`, `logs`, and the webhook receivers in `--dry-run` mode). `spex new` and `spex init` will prompt for it interactively when missing and save it to `<project>/.env`; subsequent commands auto-load `<cwd>/.env` at startup (shell-set values take precedence).
- **Working directory.** Most commands assume the current working directory is the SPEX project root (the directory that contains `.ai/`). Exceptions are called out below.

---

## `spex new <name>`

Create a new SPEX-managed project: discovery → stack recommendation → tech-spec decision gates → scaffold (plan / execute / verify / self-correct) → `.ai/` injection → initial `git` commit.

**Arguments**

- `<name>` (required) — project directory name. Must match `^[a-z0-9][a-z0-9-]*$` (lowercase letters, digits, dashes).

**Flags**

| Flag | Type | Description |
|---|---|---|
| `--stack <label>` | string | Explicit stack choice (e.g. `"Next.js + Postgres + Drizzle"`). Validation warnings are surfaced but do not block. Recorded with `source: "user"` in the tech-spec. |
| `--constraints <text>` | string | Hard constraints forwarded to the recommender (e.g. `"must use Postgres"`). Embedded in the rationale. |
| `--brainstorm` | flag | Run a bounded multi-round brainstorm (default 5 rounds) where prior proposals + your feedback feed the next recommendation. |
| `--auto` | flag | Skip the iterative decision gates and auto-accept every AI-proposed decision. Audit trail is still written. Logs a `WARNING` at start. |
| `--strict` | flag | Only meaningful with `--auto`. Aborts on the first decision with `confidence: low` instead of accepting it. |
| `--resume` | flag | Continue a previously paused proposal from `<parentDir>/.<projectName>-spex-proposal.yaml`. |

**Prerequisites**

- `ANTHROPIC_API_KEY` set in your environment, **or** enter it at the prompt — it will be saved to `<name>/.env` for future runs.
- The parent directory must not already contain a directory named `<name>`.

**What it writes**

```
<name>/
├── .ai/
│   ├── tech-spec.yaml
│   ├── README.md
│   └── audit/
│       └── decisions-<ISO-timestamp>.jsonl
└── ... (scaffolded stack files)
```

Plus a fresh `git init` + initial commit if the scaffolder's chosen stack template didn't already set one up.

**Decision actions during the gates**

| Action | Effect |
|---|---|
| `[a]ccept` | Accept the AI's proposal verbatim. |
| `[r]eject` | AI revises the proposal using your feedback. `status` becomes `modified`. |
| `[d]ebate` | AI defends or refines as prose without changing status. |
| `[e]xplore` | AI returns 2–3 alternatives with trade-offs; pick one (`status` → `modified`). |
| `[m]odify` | Enter the value directly. |
| `[p]ause` | Serialise state to YAML and exit cleanly. Resume with `--resume`. |

See [`docs/discovery-and-techspec.md`](./discovery-and-techspec.md) for the full decision flow and audit trail layout.

**Example**

```bash
ANTHROPIC_API_KEY=sk-ant-... spex new my-saas \
  --stack "Next.js + Postgres + Drizzle" \
  --constraints "must run on Vercel"
```

---

## `spex init`

Add `.ai/` infrastructure to an existing project. Detects the stack from `package.json` + filesystem, asks follow-up questions for context that cannot be inferred, and generates a retroactive `.ai/tech-spec.yaml` whose `inference` block flags the fields that came from detection (so the user can review them).

**Flags**

| Flag | Type | Description |
|---|---|---|
| `-f, --force` | flag | Overwrite an existing `.ai/` directory. Off by default — protects against accidental clobber. |

**Prerequisites**

- `ANTHROPIC_API_KEY` set in your environment, **or** enter it at the prompt — it will be saved to `<cwd>/.env` for future runs.
- Run from inside the project root.

**Currently detected stack signals**

- Next.js + TypeScript + Tailwind + App Router (from `package.json` + filesystem).
- Generic fallback when the framework isn't recognised — discovery questions fill the gap.

**Example**

```bash
cd existing-nextjs-project
ANTHROPIC_API_KEY=sk-ant-... spex init
```

---

## `spex implement [description]`

Run the full feature-implementation pipeline: read codebase context → generate a feature spec → generate an implementation plan → execute → commit.

Each phase has an approval gate by default. The flow expects to be invoked inside a project that already has `.ai/` and a clean git working tree.

**Arguments**

- `[description]` (optional) — one-line description of the feature. Required unless `--from-issue` is supplied.

**Flags**

| Flag | Type | Description |
|---|---|---|
| `--auto` | flag | Skip all approval gates and apply everything without prompts. Dangerous — only suitable for fully unattended runs (e.g. inside a GitHub Action). |
| `--dry-run` | flag | Show the spec, plan, and the operations that would run. Do not write files or run git. |
| `--no-git` | flag | Skip branch creation and commits. Writes files directly on the current branch. |
| `--from-issue <id>` | string | Pull title + description from a Linear issue (e.g. `SPX-47`). Requires `LINEAR_API_KEY`. |

**Prerequisites**

- `ANTHROPIC_API_KEY` set.
- Project contains `.ai/`.
- Working tree clean (unless `--no-git` or `--dry-run`).
- If `--from-issue` is used: `LINEAR_API_KEY` set; `integrations.linear.team` configured in `.ai/config.yaml`.

**Commits produced**

By default the executor writes two conventional-commits commits on the new `feature/<slug>` branch:

1. `feat(<scope>): <feature title>` — feature spec + source operations.
2. `test(<scope>): <feature title>` — generated tests.

Either commit is skipped when there is nothing to write (e.g. tests-only feature → no `feat` commit).

**Example**

```bash
# from a description
spex implement "add pagination to the user list"

# from a Linear issue
LINEAR_API_KEY=lin_api_... spex implement --from-issue SPX-47

# preview only
spex implement --dry-run "soft-delete users on account close"
```

---

## `spex fix [description]`

Six-phase bug fix pipeline.

| Phase | What happens |
|---|---|
| 1 | Read codebase + bug context (optional structured `--error-*` info, optional PostHog issue, optional `--affected` files). |
| 2 | Generate ranked hypotheses. |
| 3 | Root-cause analysis. Loops through up to 3 hypotheses if the first is refuted. |
| 4 | Fix proposal with multiple ranked options + trade-offs. |
| 5 | Regression test generation. |
| 6 | Verify fail-then-pass (run the test against the unfixed code, apply the fix, re-run), then commit. |

**Arguments**

- `[description]` (optional) — one-line description of the bug. Required unless `--from-error` is supplied.

**Flags**

| Flag | Type | Description |
|---|---|---|
| `-a, --affected <path>` | repeatable string | Project-relative file path the bug appears in. Pass once per file. |
| `--error-message <text>` | string | Free-form error message text to seed the analysis. |
| `--error-stack <text>` | string | Free-form stack trace text. |
| `--auto` | flag | Skip every approval gate. Applies the top-ranked hypothesis, recommended fix option, and generated regression test automatically. |
| `--dry-run` | flag | Show the analysis + proposed fix without writing or running git. |
| `--no-git` | flag | Skip branch creation + commit. |
| `--from-error <ref>` | string | Pull bug context from a structured source. Supported: `posthog:<issue-id>` or bare `<issue-id>` (defaults to posthog). |

**Prerequisites**

- `ANTHROPIC_API_KEY` set.
- Project contains `.ai/`.
- Working tree clean (unless `--no-git` or `--dry-run`).
- If `--from-error=posthog:…` is used: `POSTHOG_API_KEY` set with the "MCP Server" preset.

**Commit produced**

A single `fix(<scope>): <bug summary>` commit on a `fix/<slug>` branch (slug derived from the chosen fix option). Includes both the source change and the regression test.

**Example**

```bash
# from a description
spex fix "users get 500 on /api/login when email contains '+'" \
  -a src/api/login.ts -a src/lib/email.ts

# from a PostHog issue
POSTHOG_API_KEY=phx_... spex fix --from-error=posthog:err_01H3...

# with a structured error payload
spex fix "auth callback throws" \
  --error-message "TypeError: Cannot read properties of undefined (reading 'sub')" \
  --error-stack "$(cat /tmp/stack.txt)"
```

---

## `spex review [pr-ref]`

Fetch a GitHub PR + its diff, locate the linked feature spec via branch convention (`feature/<slug>` → `.ai/specs/<slug>.yaml`), generate a structured review across four sections (spec compliance, conventions, performance/security, test coverage), and post the rendered Markdown as a PR comment.

**Arguments**

- `[pr-ref]` (optional but practical) — PR number (e.g. `42`) or a full GitHub PR URL (e.g. `https://github.com/owner/repo/pull/42`).

**Flags**

| Flag | Type | Description |
|---|---|---|
| `--auto` | flag | Skip the confirm-before-post prompt and post immediately. |
| `--dry-run` | flag | Generate the review and print the Markdown without posting to GitHub. |

**Prerequisites**

- `ANTHROPIC_API_KEY` set.
- `GITHUB_TOKEN` set with read access to the repo (`repo:read`, plus `repo:write` to post the comment).
- For a bare PR number, `.ai/config.yaml` must define `integrations.github.{owner, repo}` so SPEX knows which repo the number belongs to. Full PR URLs are self-contained.
- `integrations.github.review_mode` selects `single` (one LLM call) or `split` (four parallel calls, one per section). Defaults to `single`.

**Example**

```bash
# review a PR by number, posting after a confirm prompt
spex review 42

# review by URL, post immediately, no confirm
spex review --auto https://github.com/rogcg/spex/pull/137

# preview only
spex review --dry-run 42
```

---

## `spex github setup`

Install SPEX GitHub Actions workflow templates into `.github/workflows/`.

| Workflow | Trigger |
|---|---|
| `pr-review.yml` | `pull_request` events: `opened`, `reopened`, `ready_for_review`. Posts a `spex review` comment automatically. |
| `implement-from-issue.yml` | `issues` event `labeled` with `spex:implement`. Implements the issue on a branch, opens a PR. |

**Flags**

| Flag | Type | Description |
|---|---|---|
| `--force` | flag | Overwrite existing workflow files at `.github/workflows/<name>.yml`. |

**Required repo secrets**

| Secret | Used by |
|---|---|
| `ANTHROPIC_API_KEY` | Both workflows. |
| `GITHUB_TOKEN` | Provided automatically by GitHub Actions — no setup needed. |

**Required repo settings**

The `implement-from-issue.yml` workflow opens PRs from the runner. That requires Settings → Actions → General → **"Allow GitHub Actions to create and approve pull requests"** to be enabled. Without it the branch is pushed but PR creation fails with `"GitHub Actions is not permitted to create or approve pull requests"`. The branch and commits remain intact; the PR can be opened manually.

For the full workflow source, pin pattern, and known caveats, see [`docs/github-workflows.md`](./github-workflows.md).

---

## `spex skills install`

Copy the SPEX skill bundles (`packages/skills/<name>/SKILL.md`) into a Claude Code skills directory. Idempotent — re-running overwrites in place. Useful after a SPEX upgrade.

**Flags**

| Flag | Type | Description |
|---|---|---|
| `--scope <scope>` | `user` \| `project` | Where to install. `user` → `~/.claude/skills/`. `project` → `./.claude/skills/`. Default: `user`. |

**Example**

```bash
spex skills install                     # ~/.claude/skills/
spex skills install --scope=project     # ./.claude/skills/
```

See [`docs/skills.md`](./skills.md) for the format, the full library, and the authoring guide.

---

## `spex resume [workflow-id]`

Resume a paused or interrupted SPEX workflow. SPEX persists every `spex new` / `spex implement` / `spex fix` run under `.ai/scratch/workflows/<workflow-id>/` (state + checkpoints + lock). This command enumerates them, classifies each (paused / interrupted / crashed / partial-write), and routes you back into the originating flow.

**Arguments**

- `[workflow-id]` (optional) — resume a specific workflow id. If omitted, the command lists known workflows and prompts you to choose.

**Flags**

| Flag | Type | Description |
|---|---|---|
| `--list` | flag | List every workflow in `.ai/scratch/` without resuming. |
| `--abandon <id>` | string | Mark a workflow abandoned and delete its scratch state. |

**Crash classification**

| Classification | Meaning |
|---|---|
| `clean` | Status is `paused` — nothing went wrong, just save-and-exit. |
| `interrupted` | Status is `running` but the owning PID is gone (SIGKILL, OOM, system crash). No file drift detected. |
| `partial_write` | Same as `interrupted`, but file content hashes diverge from the last checkpoint. SPEX flags the affected paths so you can review before resuming. |
| `foreign_host` | The lock was acquired on a different machine — SPEX can't check PID liveness, so it surfaces without auto-acting. |

On resume, conflict resolution offers four per-file choices: `keep_current` / `restore_checkpoint` / `diff` (re-prompts) / `abort` (stops the loop).

For the full layout and event vocabulary, see [`docs/audit-and-resume.md`](./audit-and-resume.md).

**Example**

```bash
spex resume                               # interactive picker
spex resume wf_2026-05-20T12-34-56_abc    # resume by id
spex resume --list                        # enumerate without resuming
spex resume --abandon wf_2026-05-19T...   # delete a workflow's scratch state
```

---

## `spex logs`

Query the audit log under `.ai/audit/`. Each entry is one JSONL line conforming to `AuditEventSchema`.

**Flags**

| Flag | Type | Description |
|---|---|---|
| `--workflow <id>` | string | Restrict to events for one workflow id. |
| `--since <duration>` | string | Only events newer than this. Format: `<n><unit>` where unit is `s`, `m`, `h`, `d`, or `w` (e.g. `1h`, `2d`, `30m`). |
| `--type <type>` | string | Filter by event type — see table below. |
| `--actor <actor>` | `user` \| `agent` \| `system` | Filter by actor. |
| `--format <format>` | `table` \| `json` \| `summary` | Output format. Default `table`. |
| `--export <path>` | string | Write filtered events as JSON to a file. |
| `--tail` | flag | Render the current snapshot. Live follow is not yet implemented. |
| `--limit <n>` | number | Maximum events to render (default 100). |

All filters compose with AND semantics. `--format=summary` produces a rollup by type and actor; `--format=table` is one line per event; `--format=json` pretty-prints the raw event objects.

**Event types**

`llm_call`, `decision`, `file_write`, `file_read`, `git_operation`, `tool_invocation`, `approval`, `error`, `state_transition`.

**Redaction**

Secrets are redacted at write time. Defaults cover Anthropic / OpenAI / GitHub / Slack / Linear / PostHog token shapes, generic `Bearer …` patterns, and sensitive key names (`api_key`, `secret`, `password`, `token`, `authorization`, …).

**Example**

```bash
spex logs                                       # last 100 events, table format
spex logs --workflow wf_2026-05-20T...          # one workflow only
spex logs --since 1h                            # 1 hour back
spex logs --type llm_call --actor agent         # combine filters
spex logs --format summary                      # rollup
spex logs --export audit-snapshot.json          # to file
```

---

## `spex linear-sync`

Sync a GitHub PR lifecycle event to the linked Linear issue. Intended to be called from a GitHub Action job that runs on `pull_request` events.

**Flags**

| Flag | Type | Description |
|---|---|---|
| `--event <event>` | `opened` \| `merged` \| `closed_unmerged` | PR event kind (use `--event-path` to auto-detect). |
| `--event-path <path>` | string | Path to a GitHub Actions `pull_request` event payload (typically `$GITHUB_EVENT_PATH`). |
| `--linear-id <id>` | string | Override Linear issue id (e.g. `SPX-47`). Otherwise auto-detected from PR body / branch. |
| `--pr-number <n>` | number | PR number (auto-detected from `--event-path` when omitted). |
| `--pr-url <url>` | string | PR URL (auto-detected from `--event-path` when omitted). |
| `--branch <ref>` | string | PR head branch name — used as a Linear-id extraction fallback. |
| `--pr-body <text>` | string | PR body text — used to find a `Closes <ID>` reference. |
| `--dry-run` | flag | Log the planned status change without calling Linear. |

**Prerequisites**

- `LINEAR_API_KEY` set.
- `.ai/config.yaml` defines `integrations.linear.{team, status_mapping?, comment_on_unmerged_close?}`.

**Link resolution order**

1. Explicit `--linear-id`.
2. `Closes <ID>` in the PR body.
3. Linear id extracted from the head branch name (e.g. `feature/SPX-47-…`).
4. None → skip silently.

**Status mapping** (defaults shown)

| Event | Linear status |
|---|---|
| `opened` | `In Review` |
| `merged` | `Done` |
| `closed_unmerged` | (no status change, optional comment if `comment_on_unmerged_close: true`) |

---

## `spex posthog-webhook`

Parse one PostHog error-tracking webhook delivery, verify its signature, apply the `.ai/config.yaml` filter, and on a trigger decision invoke `spex fix --from-error=posthog:<id> --auto`. Designed to be called from a tiny HTTP shim (GitHub Action / Lambda / Cloud Run) that writes the request body to a temp file and shells out to this command.

**Flags**

| Flag | Type | Description |
|---|---|---|
| `--payload-path <path>` | string | Path to a file containing the JSON-decoded webhook body. |
| `--signature <header>` | string | PostHog signature header value (e.g. `sha256=…`). |
| `--secret <secret>` | string | Override `POSTHOG_WEBHOOK_SECRET` for signature verification. |
| `--dry-run` | flag | Parse + apply the filter, but do not invoke `spex fix`. |

**Prerequisites**

- `POSTHOG_API_KEY` set (for downstream `spex fix --from-error` execution).
- `.ai/config.yaml` defines `integrations.posthog.auto_fix.{enabled, severity, min_occurrences}`.
- Set `POSTHOG_WEBHOOK_SECRET` in production. Without it, the signature step is skipped and a warning is logged.

**Behaviour**

- `regression` events are always skipped — re-firing of a resolved issue is too risky for an unattended AI fix.
- Events with severity NOT in `auto_fix.severity` are skipped.
- Events with occurrences below `auto_fix.min_occurrences` are skipped.

---

## `spex slack-webhook`

Parse one Slack request body (slash command or `block_actions` interactive payload), verify the HMAC, apply the permission gate, and dispatch:

- Slash commands → `runImplementCommand` / `runReviewCommand` / status / help.
- Block button clicks → recorded against the approval store at `.ai/scratch/approvals/<correlation-id>.json`.

**Flags**

| Flag | Type | Description |
|---|---|---|
| `--payload-path <path>` | string | Path to a file containing the raw Slack request body. |
| `--signature <header>` | string | Slack signature header value (`X-Slack-Signature`, e.g. `v0=…`). |
| `--timestamp <header>` | string | Slack request timestamp header (`X-Slack-Request-Timestamp`, unix seconds). |
| `--secret <secret>` | string | Override `SLACK_SIGNING_SECRET` for signature verification. |
| `--dry-run` | flag | Verify + parse, but do not invoke any downstream SPEX flow. |

**Prerequisites**

- `SLACK_BOT_TOKEN` set (`xoxb-…`) with scopes `chat:write`, `chat:write.public`, `commands` (+ optionally `channels:read`, `users:read`, `im:write`).
- `SLACK_SIGNING_SECRET` set.
- `SLACK_TOKEN_STORAGE_KEY` set (AES-256-GCM key, 64 hex chars — generate via `openssl rand -hex 32`).
- `.ai/config.yaml` defines `integrations.slack.{channels, approvals, slash_commands}` — see [`docs/configuration.md`](./configuration.md).

**Signature window**

HMAC v0 — `v0:<ts>:<body>` HMAC-SHA256 with a 5-minute replay window enforced via `timingSafeEqual` comparison.

---

## `spex mcp-server`

Start SPEX as an MCP server over stdio. Exposes seven tools (`spex_new`, `spex_implement`, `spex_fix`, `spex_review`, `spex_resume`, `list_skills`, `get_skill`) for consumption by Claude Code, Cursor, and other MCP-compatible IDEs.

**Flags**

| Flag | Type | Description |
|---|---|---|
| `--transport <transport>` | `stdio` | The only supported transport today. HTTP/SSE is planned; `--port` is a placeholder that returns an error. |
| `--port <port>` | number | Placeholder for the HTTP transport (not yet supported). |

**Stdout / stderr discipline**

This command does **NOT** print a banner — banner text would corrupt the protocol stream. It also forces `SPEX_LOG_DEST=stderr` if not already set, so pino logs cannot leak onto stdout.

For full setup, troubleshooting, and Claude Code / Cursor wiring, see [`docs/mcp-integration.md`](./mcp-integration.md).

---

## Related docs

- [`docs/configuration.md`](./configuration.md) — `.ai/config.yaml` schema for every integration.
- [`docs/audit-and-resume.md`](./audit-and-resume.md) — what `spex resume` / `spex logs` query and how the on-disk state is laid out.
- [`docs/discovery-and-techspec.md`](./discovery-and-techspec.md) — the discovery flow and decision-gate engine behind `spex new`.
- [`docs/mcp-integration.md`](./mcp-integration.md) — running SPEX inside an MCP-aware IDE.
- [`docs/skills.md`](./skills.md) — agent-facing skill bundles.
- [`docs/github-workflows.md`](./github-workflows.md) — GitHub Actions templates.
