---
title: Configuration
layout: default
nav_order: 3
description: "Full .ai/config.yaml schema for every SPEX integration (GitHub, Linear, PostHog, Slack)."
---

# `.ai/config.yaml` reference

`.ai/config.yaml` is the opt-in configuration file for SPEX integrations. None of `spex new`, `spex implement`, `spex fix`, or `spex review` need it to operate against a plain local repo — it layers on top to wire GitHub, Linear, PostHog, and Slack.

The file is validated by the Zod schemas in [`packages/schemas/src/ai-config.ts`](../packages/schemas/src/ai-config.ts) in **strict mode** — unknown keys throw at load time. Defaults are applied for every optional field, so the smallest valid file is a literal empty `{}`.

```yaml
# .ai/config.yaml
integrations:
  github: { ... }
  linear: { ... }
  posthog: { ... }
  slack:   { ... }
```

Every block under `integrations` is optional; absent blocks simply mean "that integration is off". Below is the complete schema for each, with defaults and behaviour notes.

---

## Top-level

```yaml
integrations: <object> | absent
```

`integrations` is the only valid top-level key.

---

## `integrations.github`

Used by `spex implement`, `spex fix`, and `spex review` for push / PR / comment operations. Also used by `spex linear-sync` to resolve the PR's owning repo from event payloads.

```yaml
integrations:
  github:
    owner: rogcg                  # (required) repo owner
    repo: spex                    # (required) repo name
    auto_create_pr: true          # default: false
    pr_labels:                    # default: ["spex-generated"]
      - spex-generated
      - automated
    base_branch: main             # default: "main"
    host: github.com              # default: "github.com" (set for GitHub Enterprise)
    review_mode: split            # default: "single" — "single" | "split"
```

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `owner` | string | yes | — | Must be non-empty. |
| `repo` | string | yes | — | Must be non-empty. |
| `auto_create_pr` | boolean | no | `false` | When `true`, `spex implement` / `spex fix` push the feature/fix branch and open a PR after committing. |
| `pr_labels` | string[] | no | `["spex-generated"]` | Applied to every auto-created PR. |
| `base_branch` | string | no | `"main"` | The branch PRs are opened against. |
| `host` | string | no | `"github.com"` | Set to your GHE host for GitHub Enterprise. |
| `review_mode` | enum | no | `"single"` | `single` = one LLM call. `split` = four parallel calls (one per review section). |

**Required env**

- `GITHUB_TOKEN` with `repo` (read + write). For GitHub Enterprise, configure the Octokit base URL via `host`.

**Behaviour**

- When `auto_create_pr: true` and `GITHUB_TOKEN` is missing, SPEX logs a warning and skips PR creation. The local commits remain intact.
- When `auto_create_pr: false`, the branch is created and committed locally; no push or PR happens.
- The Claude-polished PR description falls back to a deterministic template if the LLM call fails.

---

## `integrations.linear`

Used by `spex implement --from-issue` and `spex linear-sync`.

```yaml
integrations:
  linear:
    team: SPX                              # (required) Linear team key
    status_mapping:                        # all optional, defaults shown
      in_progress: "In Progress"
      in_review: "In Review"
      done: "Done"
      todo: "Todo"
    comment_on_unmerged_close: true        # default: true
```

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `team` | string | yes | — | Linear team key (the prefix used for issue ids, e.g. `SPX` for `SPX-47`). Drives `list_issues` filtering and the Linear-id extraction fallbacks. |
| `status_mapping.in_progress` | string | no | `"In Progress"` | Workflow state name used when SPEX begins implementing. |
| `status_mapping.in_review` | string | no | `"In Review"` | Set when a PR is opened. |
| `status_mapping.done` | string | no | `"Done"` | Set when a PR is merged. |
| `status_mapping.todo` | string | no | `"Todo"` | The "fresh" state, used for resets. |
| `comment_on_unmerged_close` | boolean | no | `true` | When `true`, `spex linear-sync` posts a comment on the Linear issue when a PR closes without merging (records the rejection rationale). |

**Required env**

- `LINEAR_API_KEY` — personal API key, https://linear.app/settings/api.

**Behaviour**

- The PR ↔ issue link comes from either a `feature/<linear-id>-…` branch name or a `Closes <ISSUE-ID>` line in the PR body — whichever exists.
- `status_mapping` names must match the actual workflow state names in your Linear team. Mismatches surface as Linear API errors at sync time.

---

## `integrations.posthog`

Used by `spex fix --from-error=posthog:<id>` and `spex posthog-webhook`.

```yaml
integrations:
  posthog:
    auto_fix:
      enabled: false                # default: false
      severity:                     # default: ["critical"]
        - critical
        - error
      min_occurrences: 5            # default: 5
```

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `auto_fix.enabled` | boolean | no | `false` | Master switch for the webhook auto-trigger. Must be `true` for `spex posthog-webhook` to invoke `spex fix`. |
| `auto_fix.severity` | enum[] | no | `["critical"]` | Severity allow-list. Allowed values: `critical`, `error`, `warning`, `info`, `debug`. Events whose severity is unclassified by PostHog also pass when this list contains `"critical"`. |
| `auto_fix.min_occurrences` | integer ≥ 1 | no | `5` | Skip until the issue has fired this many times. Defaults to 5 to skip one-off transient errors. |

**Required env**

- `POSTHOG_API_KEY` — personal API key with the **MCP Server** preset. Settings → User → Personal API Keys.
- `POSTHOG_PROJECT_ID` (optional) — defaults to the key's default project.
- `POSTHOG_WEBHOOK_SECRET` (production-only) — required to verify webhook signatures.

**Behaviour**

- `regression` events are always skipped, regardless of config — re-firing of a resolved issue is too risky for an unattended AI fix.
- The downstream call is exactly `spex fix --from-error=posthog:<id> --auto`, so all of `spex fix`'s preconditions still apply (clean working tree, `.ai/`, etc.).

---

## `integrations.slack`

Used by `spex slack-webhook` and (when wired) by the outbound notification dispatchers (`notifyPrOpened`, `notifyFixProposed`, `notifySpecGenerated`, `notifyReviewComplete`).

```yaml
integrations:
  slack:
    channels:
      pr_opened: "#engineering"
      fix_proposed: "#bugs"
      spec_generated: "#engineering"
      review_complete: "#engineering"
      default: "#spex"

    approvals:
      enabled: true                   # default: false
      approvers:                      # default: []
        - U01ABCDEFG
        - U02HIJKLMN
      mode: quorum                    # default: "any_of" — "any_of" | "all_of" | "quorum"
      quorum: 2                       # required when mode = "quorum"
      timeout_hours: 24               # default: 24

    slash_commands:
      enabled: true                   # default: true
      allowed_users:                  # default: [] (empty = anyone)
        - U01ABCDEFG
      allowed_channels:               # default: [] (empty = any channel)
        - C0123456789
```

### `channels`

All keys are optional and default to empty (no routing). Each value is a Slack channel id (`C…`) or `#name`.

| Field | Routes |
|---|---|
| `pr_opened` | `notifyPrOpened` template. |
| `fix_proposed` | `notifyFixProposed` approval card (with Approve / Reject / Inspect buttons threaded to a correlation id). |
| `spec_generated` | `notifySpecGenerated` notification (optionally approval-gated). |
| `review_complete` | `notifyReviewComplete` notification. |
| `default` | Fallback when an event-specific entry is missing. |

When neither the event-specific key nor `default` is set, the notification is silently skipped (NOT a fatal error).

### `approvals`

Async approval gate. Files are written under `.ai/scratch/approvals/<correlation-id>.json` (mode `0o600` on POSIX).

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `enabled` | boolean | no | `false` | Master switch. |
| `approvers` | string[] | no | `[]` | Slack user ids (`U…`) allowed to approve / reject. Empty + `enabled: true` makes the gate unsatisfiable. |
| `mode` | enum | no | `"any_of"` | `any_of` — one approver. `all_of` — every listed approver. `quorum` — at least `quorum` approvers. |
| `quorum` | integer ≥ 1 | conditional | — | **Required when `mode = "quorum"`.** Number of approvers needed. |
| `timeout_hours` | integer ≥ 1 | no | `24` | Approval expiry. Lazy expiry happens on the first decision attempt after the deadline; a background `expirePendingApprovals` sweep also exists. |

### `slash_commands`

Permission gate for `/spex review`, `/spex implement`, `/spex status`, `/spex help`.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `enabled` | boolean | no | `true` | When `false`, every slash command is rejected. |
| `allowed_users` | string[] | no | `[]` | Slack user ids allowed to run **state-changing** commands (`review`, `implement`). Empty = anyone (subject to `enabled`). Read-only commands (`status`, `help`) are unrestricted. |
| `allowed_channels` | string[] | no | `[]` | Channels commands may be invoked from. Empty = any channel. |

**Required env**

| Var | Used for |
|---|---|
| `SLACK_BOT_TOKEN` | `xoxb-…` bot user OAuth token. Scopes: `chat:write`, `chat:write.public`, `commands` (+ `channels:read`, `users:read`, `im:write` for the slash-command UX). |
| `SLACK_SIGNING_SECRET` | HMAC v0 verification of every incoming Slack delivery (5-minute replay window). |
| `SLACK_TOKEN_STORAGE_KEY` | AES-256-GCM key (64 hex chars) for the encrypted on-disk workspace token store. Generate via `openssl rand -hex 32`. |

---

## Loading + validation

The config is loaded by `loadAiConfig({ projectDir })` in `@spex/core`. The loader:

1. Reads `.ai/config.yaml`. If the file is absent, returns `null` (every command treats this as "no integrations configured").
2. Parses with `yaml`.
3. Validates with `AiConfigSchema` (strict). Unknown keys at any nesting level throw with a path-annotated message.
4. Returns the fully-defaulted object.

A typical validation failure looks like:

```
Error: .ai/config.yaml is invalid:
  - integrations.github.review_mode: Invalid enum value. Expected 'single' | 'split', received 'combined'
```

---

## Minimal example

```yaml
# .ai/config.yaml — minimal: just GitHub
integrations:
  github:
    owner: rogcg
    repo: spex
    auto_create_pr: true
```

## Full example

```yaml
# .ai/config.yaml — every integration wired up
integrations:
  github:
    owner: rogcg
    repo: spex
    auto_create_pr: true
    pr_labels: [spex-generated]
    base_branch: main
    review_mode: split

  linear:
    team: SPX
    status_mapping:
      in_progress: "In Progress"
      in_review: "In Review"
      done: "Done"
      todo: "Backlog"
    comment_on_unmerged_close: true

  posthog:
    auto_fix:
      enabled: true
      severity: [critical, error]
      min_occurrences: 10

  slack:
    channels:
      pr_opened: "#engineering"
      fix_proposed: "#bugs"
      default: "#spex"
    approvals:
      enabled: true
      approvers: [U01ABCDEFG, U02HIJKLMN]
      mode: quorum
      quorum: 2
      timeout_hours: 24
    slash_commands:
      enabled: true
      allowed_users: [U01ABCDEFG]
      allowed_channels: [C0123456789]
```

---

## Related docs

- [`docs/cli-reference.md`](./cli-reference.md) — every command that consumes this config.
- [`docs/github-workflows.md`](./github-workflows.md) — GitHub Actions templates that read these blocks at runtime.
- [`docs/audit-and-resume.md`](./audit-and-resume.md) — where Slack approval state lives (`.ai/scratch/approvals/`).
- [`packages/schemas/src/ai-config.ts`](../packages/schemas/src/ai-config.ts) — the canonical Zod schema.
