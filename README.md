# SPEX

[![CI](https://github.com/rogcg/spex/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/rogcg/spex/actions/workflows/ci.yml)

**Spec-driven Programming EXecutor**

> AI agent orchestration framework for software development, based on versioned specs and human approval gates.

> ⚠️ **Work in progress — do NOT use for real projects.** SPEX is under active development and is **not production-ready**. CLI flags, package APIs, `.ai/` artifact formats, and MCP tool shapes may change without notice and without migration paths. Expect breakages, partial features, and undocumented behavior. Use it on throwaway sandboxes for evaluation only.

See [`CLAUDE.md`](./CLAUDE.md) for the architectural decisions and code conventions, and [`CHANGELOG.md`](./CHANGELOG.md) for the per-release diff.

## Requirements

- Node.js 20 LTS or newer
- pnpm 9 or newer
- An `ANTHROPIC_API_KEY` set in your environment (see `.env.example`)
- A `GITHUB_TOKEN` if you want SPEX to push branches / open PRs / post review comments

## Install from GitHub

SPEX is **not yet published to npm.** Until then, install by cloning this repo and building from source:

```bash
git clone https://github.com/rogcg/spex.git
cd spex
pnpm install
pnpm -r run build
```

The CLI entry point is then `node packages/cli/dist/index.js`. To use it like a normal command you can symlink it onto your `PATH`:

```bash
# optional convenience: put `spex` on $PATH
pnpm --filter @spex/cli link --global
```

To pin to a specific release, check out a tag before building (e.g. `git checkout v0.9.0`). An `npm install -g spex` install is not available yet.

### Create a new project — `spex new`

```bash
ANTHROPIC_API_KEY=sk-... node packages/cli/dist/index.js new my-saas
```

1. Run discovery — a static 5-question flow by default. An adaptive architect-driven flow is also available via the library API; see [Adaptive discovery](#adaptive-discovery) below.
2. Generate a `tech-spec.yaml` via Claude.
3. Show the spec and ask for approval.
4. Scaffold a Next.js application via `create-next-app`.
5. Inject `.ai/tech-spec.yaml` and `.ai/README.md` into the new project.
6. Record the `.ai/` folder in a git commit.

### Add SPEX to an existing project — `spex init`

```bash
cd existing-nextjs-project
ANTHROPIC_API_KEY=sk-... node /path/to/spex/packages/cli/dist/index.js init
```

Detects Next.js + TypeScript + Tailwind + App Router from `package.json` and the
filesystem, asks follow-up questions for context that can't be inferred, and
generates a retroactive `.ai/tech-spec.yaml` whose `inference` block flags the
fields that came from detection.

### Implement a feature — `spex implement`

```bash
cd my-saas    # project that already has .ai/ from `spex new` or `spex init`
ANTHROPIC_API_KEY=sk-... node /path/to/spex/packages/cli/dist/index.js implement \
  "add pagination to the user list"
```

Phases (each previewed and gated by default):

1. Read codebase context (tech spec, package info, detected patterns, file listing).
2. Generate a feature spec → approval gate.
3. Generate an implementation plan → approval gate.
4. Create a `feature/<slug>` branch and execute the plan (step-by-step by default).
5. Two conventional-commits commits: `feat(<scope>): …` then `test(<scope>): …`.

Flags:

- `--auto` — skip all approval gates (dangerous; applies everything without prompts).
- `--dry-run` — show what would happen without writing or running git.
- `--no-git` — skip branch creation and commits.

### Diagnose and fix a bug — `spex fix`

```bash
cd my-saas
ANTHROPIC_API_KEY=sk-... node /path/to/spex/packages/cli/dist/index.js fix \
  "users get 500 on /api/login when email contains '+'"
```

Six-phase pipeline (each previewed and gated by default):

1. Read codebase + bug context.
2. Generate ranked hypotheses.
3. Root-cause analysis (loops through up to 3 hypotheses if the first is refuted).
4. Fix proposal.
5. Regression test generation.
6. Verify fail-then-pass, then commit.

Flags: `--auto`, `--dry-run`, `--no-git`, `-a/--affected <path>`, `--error-message`, `--error-stack`.

### Review a pull request — `spex review`

```bash
cd my-saas    # project with .ai/config.yaml containing integrations.github
GITHUB_TOKEN=ghp_... ANTHROPIC_API_KEY=sk-... \
  node /path/to/spex/packages/cli/dist/index.js review \
  https://github.com/owner/repo/pull/42
```

Fetches the PR + diff, locates the linked feature spec via branch convention (`feature/<slug>` → `.ai/specs/<slug>.yaml`), generates a structured review across four sections (spec compliance, conventions, performance/security, test coverage), and posts the rendered Markdown as a PR comment.

Flags: `--auto` (skip confirm-before-post), `--dry-run` (preview without posting). `integrations.github.review_mode` in `.ai/config.yaml` selects `single` (one LLM call) or `split` (four parallel calls, one per section).

### Install GitHub Actions workflow templates — `spex github setup`

```bash
cd my-saas
node /path/to/spex/packages/cli/dist/index.js github setup
```

Writes two workflows to `.github/workflows/`:

- `pr-review.yml` — auto-review every newly opened PR.
- `implement-from-issue.yml` — when an issue is labelled `spex:implement`, SPEX implements it on a branch and opens a PR.

Both workflows install SPEX from this repo via `actions/checkout` + `pnpm install` + `pnpm -r build` until SPEX is published to npm. The `SPEX_REPO` and `SPEX_REF` env vars at the top of each template let you pin a tag or a fork. The workflows require repo secrets `ANTHROPIC_API_KEY` (the default `GITHUB_TOKEN` provided by Actions is sufficient for the rest).

### Install Claude Code skills — `spex skills install`

```bash
spex skills install                 # default: user scope (~/.claude/skills/)
spex skills install --scope=project # project scope (./.claude/skills/)
```

Copies the SPEX skill bundles into a Claude Code skills directory so the IDE's agent can invoke SPEX workflows by name (`spex-new`, `spex-implement`, `spex-fix`, `spex-review`, `spex-discovery`, `spex-brainstorm`, `spex-architecture-decision`, `spex-adversarial-review`, …). Idempotent — re-running overwrites in place.

Full Skills overview, including the format, the shipped library, and how to author new skills: see [`docs/skills.md`](./docs/skills.md).

## Adaptive discovery

The discovery flow used by `spex new` and `spex init` is, by default, a static 5-question script. A richer **architect-driven adaptive** flow is also available via the library API:

```ts
import { AnthropicProvider, createArchitectAgent, runAdaptiveDiscovery } from '@spex/core';

const llm = new AnthropicProvider();
const agent = createArchitectAgent({ llm });
const result = await runAdaptiveDiscovery({
  agent,
  nav: { scratchPath: '.ai/scratch/discovery.yaml' },
});

console.log(result.answers); // DiscoveryAnswers keyed by question id
console.log(result.gap);     // GapAssessment from the architect
```

The architect agent asks one question at a time, with each question informed by all prior answers. Four question types are supported: free-form input, single-select, multi-select, and yes/no confirm. At the end of the interview the architect classifies the discovery as `complete`, `nice_to_have_missing`, or `critical_missing` — on critical, the user is prompted to confirm before the flow returns.

**Universal navigation** during any flow (static or adaptive):

| Command | Effect |
|---|---|
| `/why` | Show the rationale for the current question. |
| `/skip` | Skip the current question (excluded from final answers). |
| `/back` | Return to the previous question; can re-answer. |
| `/pause` | Save state to `.ai/scratch/discovery.yaml` and exit (throws `DiscoveryPausedError`). |
| `/?` (alias `/help`) | Show available commands. |

The CLI commands (`spex new`, `spex init`) are not yet wired to `runAdaptiveDiscovery` — the library API is the entry point.

## Optional integrations

Each integration is opt-in via `.ai/config.yaml` plus an env var or two. Nothing
below changes how `spex new` / `implement` / `fix` / `review` behave at their
core — they layer on top.

The `.ai/config.yaml` schema for every block is in
[`packages/schemas/src/ai-config.ts`](./packages/schemas/src/ai-config.ts) and
is strict-mode (unknown keys throw at load time).

### Linear — drive `implement` from issues + auto-sync PR/issue status

Read a feature description from a Linear issue, then keep the issue's status
in sync with PR lifecycle events (opened → In Review, merged → Done, closed
unmerged → optional comment).

```bash
export LINEAR_API_KEY=lin_api_...   # personal API key, https://linear.app/settings/api
```

`.ai/config.yaml`:

```yaml
integrations:
  linear:
    team: <TEAM-KEY>            # e.g. the prefix used for issue ids
    status_mapping:             # optional; shown here with defaults
      in_progress: "In Progress"
      in_review: "In Review"
      done: "Done"
      todo: "Todo"
    comment_on_unmerged_close: true
```

Then:

```bash
# pull title + description from a Linear issue, run the implement flow on it
spex implement --from-issue <ISSUE-ID>

# read a GitHub PR webhook payload (or pass --pr-url manually) and update the
# linked Linear issue's status. Designed to be called from a GitHub Action.
spex linear-sync --event-path .github/event.json --pr-url <PR-URL>
```

The PR ↔ issue link comes from either a `feature/<linear-id>-...` branch name
convention or a `Closes <ISSUE-ID>` line in the PR body — whichever exists.

### PostHog — pull bug context + auto-trigger `fix` on errors

Use PostHog's MCP server as the source of bug context: stack frames, occurrence
counts, affected user counts, session recording deep-links. Optionally
auto-trigger `spex fix` from a PostHog error-tracking webhook.

```bash
export POSTHOG_API_KEY=phx_...           # personal API key with the "MCP Server" preset
export POSTHOG_PROJECT_ID=<numeric-id>   # optional; defaults to the key's default project
export POSTHOG_WEBHOOK_SECRET=...        # only needed if you wire the auto-trigger webhook
```

`.ai/config.yaml`:

```yaml
integrations:
  posthog:
    auto_fix:
      enabled: false              # set true to wire the webhook auto-trigger
      severity: ["critical"]      # severity allow-list; events with no severity tag
                                  # also pass when this list contains "critical"
      min_occurrences: 5          # skip until the issue has fired this many times
```

Then:

```bash
# manually: pull bug context from PostHog and run the full fix pipeline
spex fix --from-error=posthog:<ISSUE-ID>

# unattended (e.g. from a GitHub Action / serverless function): receive one
# PostHog error-tracking webhook delivery, verify its signature, apply the
# filter above, and on a trigger decision run `spex fix --from-error=… --auto`.
spex posthog-webhook \
  --payload-path body.json \
  --signature "$X_POSTHOG_SIGNATURE" \
  --secret "$POSTHOG_WEBHOOK_SECRET"
```

`regression` events are always skipped — re-firing of a resolved issue is too
risky for an unattended AI fix.

### Slack — notifications, async approvals, slash commands

Three flows: outbound notifications (PR opened, fix proposed, spec generated,
review complete), async approval gates with Block Kit buttons, and slash
commands (`/spex review <pr-url>`, `/spex implement <description>`,
`/spex status`).

```bash
export SLACK_BOT_TOKEN=xoxb-...           # bot user OAuth token; needs chat:write
                                          # (and commands if you add slash commands)
export SLACK_SIGNING_SECRET=...           # for HMAC verification of incoming webhooks
export SLACK_TOKEN_STORAGE_KEY=$(openssl rand -hex 32)   # AES-256-GCM key for the
                                                          # encrypted on-disk token store
```

`.ai/config.yaml`:

```yaml
integrations:
  slack:
    channels:                       # per-event routing; falls back to `default`,
                                    # silently skipped if neither is set
      pr_opened: "#<channel>"
      fix_proposed: "#<channel>"
      spec_generated: "#<channel>"
      review_complete: "#<channel>"
      default: "#<channel>"
    approvals:                      # async approval gate (defaults shown)
      enabled: false
      approvers: []                 # Slack user ids allowed to approve / reject
      mode: any_of                  # any_of | all_of | quorum
      # quorum: 2                   # required when mode = "quorum"
      timeout_hours: 24
    slash_commands:
      enabled: true
      allowed_users: []             # empty = anyone; otherwise allow-list for
                                    # state-changing commands (review, implement)
      allowed_channels: []          # empty = any channel
```

#### Slack app — minimum scopes

Create a Slack app at https://api.slack.com/apps. Under "OAuth & Permissions",
add these Bot Token Scopes:

- `chat:write` (post messages)
- `chat:write.public` (post without being invited to the channel)
- `commands` (slash commands)
- `channels:read`, `users:read`, `im:write` (optional, for the slash-command UX)

Install (or reinstall) the app to your workspace and copy the **Bot User OAuth
Token** (`xoxb-...`) — that is what `SLACK_BOT_TOKEN` points to. The signing
secret is on the "Basic Information" page under "App Credentials".

#### Handling a Slack delivery

`spex slack-webhook` is a one-shot CLI that parses a single Slack delivery
body (slash command or `block_actions` button click), verifies the HMAC, and
dispatches:

```bash
spex slack-webhook \
  --payload-path body.txt \
  --signature "$X_SLACK_SIGNATURE" \
  --timestamp "$X_SLACK_REQUEST_TIMESTAMP" \
  --secret "$SLACK_SIGNING_SECRET"
```

Run it behind a tiny HTTP shim (Lambda, Cloud Run, ngrok + a one-route
Express handler) that writes the request body to a temp file and shells out
to the CLI. Long-running Bolt-SDK server mode is a future release; the
one-shot path matches the serverless / GitHub Actions delivery pattern.

#### Live validation

`scripts/slack-live-probe.mjs` exercises every Slack-side surface
(encrypted token store, HMAC, the four Block Kit templates posted to a
channel, approval state machine) using `SLACK_BOT_TOKEN`,
`SLACK_SIGNING_SECRET`, and `SLACK_TEST_CHANNEL`. Useful after a fresh
app install to confirm scopes + channel access in under 5 seconds.

### Run as an MCP server — `spex mcp-server`

Expose SPEX as tools to Claude Code, Cursor, and other MCP-compatible IDEs.
The server speaks the [Model Context Protocol](https://modelcontextprotocol.io/)
over stdio and registers six tools that the IDE's LLM can call directly:

- `spex_new`, `spex_implement`, `spex_fix`, `spex_review` — the four engine tools.
- `list_skills`, `get_skill` — pull the SPEX skill bundles at runtime (see [`docs/skills.md`](./docs/skills.md)).

```bash
spex mcp-server                # default: stdio transport, logs to stderr
spex mcp-server --transport stdio  # explicit
```

Minimal Claude Code config (`~/.claude.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "spex": {
      "command": "spex",
      "args": ["mcp-server"],
      "env": { "ANTHROPIC_API_KEY": "sk-ant-..." }
    }
  }
}
```

Full setup, troubleshooting, and Cursor instructions: see
[`docs/mcp-integration.md`](./docs/mcp-integration.md).

## Development

```bash
pnpm install
pnpm -r run build   # build packages in dependency order
pnpm test           # run vitest in every package
pnpm typecheck      # tsc --noEmit in every package
pnpm lint           # biome check
pnpm format         # biome format --write
```

Cross-package tests in `@spex/core` resolve `@spex/schemas` through its built
`dist/`, so a build is required before tests can run.

## Repository layout

```
packages/
  schemas/       — zod schemas: TechSpec, FeatureSpec, ImplementationPlan, … (@spex/schemas)
  core/          — LLM, discovery (static + adaptive architect agent + gap detection
                   + universal navigation + YAML state persistence), tech-spec, scaffold,
                   init, context, feature-spec, implementation (planner/executor),
                   bug-fix, git, logger (@spex/core)
  cli/           — spex binary with new, init, implement, fix, review, skills install,
                   linear-sync, posthog-webhook, slack-webhook, mcp-server commands (@spex/cli)
  mcp-server/    — MCP server (stdio) exposing six tools: spex_new, spex_implement,
                   spex_fix, spex_review, list_skills, get_skill (@spex/mcp-server)
  skills/        — markdown skill bundles + loader; six routing skills (spex-new, init,
                   discovery, implement, fix, review) and three prompt-only skills
                   (brainstorm, architecture-decision, adversarial-review) (@spex/skills)
  integrations/
    github/      — GitHub PR/branch/review operations (@spex/integrations-github)
    linear/      — Linear MCP client + issue/PR sync (@spex/integrations-linear)
    posthog/     — PostHog MCP client + bug-source + webhook receiver (@spex/integrations-posthog)
    slack/       — Slack OAuth + token store + notification templates + approval flow
                   + slash-command parser + webhook receiver (@spex/integrations-slack)
```

## License

[MIT](./LICENSE)
