---
title: Home
layout: default
nav_order: 1
description: "SPEX — Spec-driven Programming EXecutor. AI agent orchestration framework for software development."
permalink: /
---

<p align="center">
  <img src="{{ site.baseurl }}/assets/spex-logo.svg" alt="SPEX — Spec-driven Programming EXecutor" width="520">
</p>

# SPEX
{: .fs-9 }

Spec-driven Programming EXecutor — an AI agent orchestration framework that turns vague feature requests into versioned specs, human-approved decisions, and executable code.
{: .fs-6 .fw-300 }

[Get started](#quick-start){: .btn .btn-primary .fs-5 .mb-4 .mb-md-0 .mr-2 }
[View on GitHub](https://github.com/rogcg/spex){: .btn .fs-5 .mb-4 .mb-md-0 }

---

## What is SPEX?

{: .warning }
> 🚧 **Work in progress — not production ready.** SPEX is an early-stage experimental project. It is **not** ready for production use or real-life applications. APIs may change without warning, flows that depend on external services (Linear, PostHog, Slack) have rough edges, and there is no support guarantee. Use it to explore the ideas, hack on it, give feedback — not to run anything you care about. Pin to a specific tag if you want any kind of reproducibility.

SPEX is an AI agent orchestration framework for software development, based on **versioned specs** and **human approval gates**. It orchestrates LLM agents to create, maintain, and operate codebases through:

1. **Interactive discovery** — understands the problem before executing.
2. **Versioned specs** — every change produces an auditable artifact in `.ai/`.
3. **Human approval gates** — AI proposes, human approves, AI executes.
4. **Multi-mode runtime** — CLI + MCP server + importable library.

| Runtime mode | Usage |
|---|---|
| CLI standalone | `spex new`, `spex implement`, `spex fix`, `spex review`, … |
| MCP server | Consumable by Claude Code, Cursor, and other MCP-compatible IDEs |
| Importable library | `import { TechSpecGenerator } from "@spex/core"` |

---

## Documentation map

| Page | What it covers |
|---|---|
| [CLI reference]({{ site.baseurl }}/cli-reference) | Every `spex` subcommand — arguments, flags, env vars, exit codes, examples. |
| [Configuration]({{ site.baseurl }}/configuration) | Full `.ai/config.yaml` schema for every integration (GitHub, Linear, PostHog, Slack). |
| [Discovery & tech spec]({{ site.baseurl }}/discovery-and-techspec) | The adaptive discovery flow, decision-gate engine, stack recommendation, scaffold planner. |
| [Audit & resume]({{ site.baseurl }}/audit-and-resume) | `.ai/scratch/` and `.ai/audit/` layout, workflow lifecycle, crash recovery, conflict resolution. |
| [GitHub workflows]({{ site.baseurl }}/github-workflows) | The GitHub Actions templates installed by `spex github setup`. |
| [MCP integration]({{ site.baseurl }}/mcp-integration) | Wiring SPEX as an MCP server for Claude Code / Cursor / other IDEs. |
| [Skills]({{ site.baseurl }}/skills) | The agent-facing skill bundle library — format, install, authoring guide. |

---

## Requirements

- Node.js **20 LTS** or newer
- pnpm **9** or newer
- An Anthropic API key. If you do not have `ANTHROPIC_API_KEY` set in your environment, `spex new` and `spex init` will prompt for it interactively and save it to a local `.env` file inside the project. Subsequent commands auto-load that `.env` and pick the key up.

### Environment variables

`ANTHROPIC_API_KEY` is the only one every command needs. Everything else is opt-in per integration / command — set them only when you use the corresponding flow.

| Env var | Required for |
|---|---|
| `ANTHROPIC_API_KEY` | **Always.** Every LLM call: `spex new`, `init`, `implement`, `fix`, `review`, and the MCP server tools. |
| `GITHUB_TOKEN` | `spex review`, `spex github pr`, and any flow that pushes a branch / opens a PR / posts a review comment. Inside GitHub Actions the default `GITHUB_TOKEN` is sufficient. |
| `LINEAR_API_KEY` | `spex linear-sync`, and `spex implement --from-issue <ISSUE-ID>`. Get one at [linear.app/settings/api](https://linear.app/settings/api). |
| `POSTHOG_API_KEY` | `spex fix --from-error=posthog:<ISSUE-ID>` and the `spex posthog-webhook` receiver. Use a personal API key with the **MCP Server** preset. |
| `POSTHOG_PROJECT_ID` | Together with `POSTHOG_API_KEY` to scope PostHog MCP calls when the key has access to multiple projects. |
| `POSTHOG_WEBHOOK_SECRET` | Production `spex posthog-webhook` — signature verification. Skipped (with a warning) if unset. |
| `SLACK_BOT_TOKEN` | Slack integration: notifications, async approval gates, slash commands. `xoxb-…` token with `chat:write` (+ `commands` for slash commands). |
| `SLACK_SIGNING_SECRET` | `spex slack-webhook` — HMAC verification of incoming Slack deliveries (5-minute replay window). |
| `SLACK_TOKEN_STORAGE_KEY` | AES-256-GCM key (64 hex chars) for the encrypted on-disk Slack workspace token store. Generate with `openssl rand -hex 32`. |

Optional internal knobs: `SPEX_LOG_LEVEL` (default `info`), `SPEX_LOG_DEST` (default stderr; supports `file:<path>`).

Full per-integration setup, OAuth scopes, and config schema: [Configuration]({{ site.baseurl }}/configuration).

---

## Quick start

### 1. Install from source

SPEX is currently distributed from GitHub. An `npm` package is on the v1.1 roadmap.

```bash
git clone https://github.com/rogcg/spex.git
cd spex
pnpm install
pnpm -r run build
```

The CLI entry point is `node packages/cli/dist/index.js`. To use it as a normal command, link it onto your `PATH`:

```bash
pnpm --filter @spex/cli link --global
```

To pin to a specific release, check out the tag before building:

```bash
git checkout v1.0.0
pnpm install
pnpm -r run build
```

### 2. Create a new project

```bash
ANTHROPIC_API_KEY=sk-... spex new my-saas
```

What it does:

1. Runs adaptive discovery — an architect agent asks one question at a time, each informed by all prior answers, until the project profile is complete.
2. Recommends best-fit stacks based on the discovery profile, with confidence + tradeoffs.
3. Drafts the tech spec as 10–14 small **decisions**. For each you can `[a]ccept`, `[r]eject`, `[d]ebate`, `[e]xplore`, `[m]odify`, or `[p]ause`.
4. Plans the scaffold, verifies it (file/dependency/typecheck/build checks), and retries on failure (max 3 attempts).
5. Injects `.ai/tech-spec.yaml`, `.ai/README.md`, and the audit trail into the new project.
6. Commits the `.ai/` folder.

Useful flags: `--stack`, `--constraints`, `--brainstorm`, `--auto`, `--strict`, `--resume`.

### 3. Add SPEX to an existing project

```bash
cd existing-nextjs-project
ANTHROPIC_API_KEY=sk-... spex init
```

Detects the existing stack from `package.json` + filesystem, asks follow-up questions for context that can't be inferred, and writes a retroactive `.ai/tech-spec.yaml`.

### 4. Implement a feature

```bash
cd my-saas
ANTHROPIC_API_KEY=sk-... spex implement "add pagination to the user list"
```

Five-phase flow (each previewed and gated by default):

1. Read codebase context.
2. Generate feature spec → approval gate.
3. Generate implementation plan → approval gate.
4. Create `feature/<slug>` branch and execute the plan.
5. Two conventional commits: `feat(<scope>): …` then `test(<scope>): …`.

Flags: `--auto`, `--dry-run`, `--no-git`.

### 5. Diagnose and fix a bug

```bash
cd my-saas
ANTHROPIC_API_KEY=sk-... spex fix "users get 500 on /api/login when email contains '+'"
```

Six-phase pipeline (each previewed and gated by default):

1. Read codebase + bug context.
2. Generate ranked hypotheses.
3. Root-cause analysis (loops through up to 3 hypotheses if the first is refuted).
4. Fix proposal.
5. Regression test generation.
6. Verify fail-then-pass, then commit.

### 6. Review a pull request

```bash
cd my-saas
GITHUB_TOKEN=ghp_... ANTHROPIC_API_KEY=sk-... \
  spex review https://github.com/owner/repo/pull/42
```

Fetches the PR + diff, locates the linked feature spec, generates a structured review across four sections (spec compliance, conventions, performance/security, test coverage), and posts the rendered Markdown as a PR comment.

### 7. Resume a paused workflow

```bash
spex resume               # interactive picker
spex resume <workflow-id> # resume a specific workflow
spex resume --list        # list all workflows in .ai/scratch/
```

Every `spex new` / `spex implement` / `spex fix` keeps its in-progress state under `.ai/scratch/workflows/<workflow-id>/`. `spex resume` enumerates them, classifies each (paused / interrupted / crashed), and routes you back into the originating flow.

### 8. Query the audit log

```bash
spex logs                                  # last 100 events, table format
spex logs --workflow <workflow-id>         # one workflow only
spex logs --since 1h                       # 1 hour back; also 30m, 2d, 1w
spex logs --type llm_call --actor agent    # combine filters (AND semantics)
```

Audit events live under `.ai/audit/`: `global.jsonl` (every event across every workflow) and `workflow-<id>.jsonl` (per-workflow). Each line is a JSONL entry conforming to `AuditEventSchema`. Secrets are redacted at write time.

---

## MCP server

Expose SPEX as MCP tools to Claude Code, Cursor, and other MCP-aware IDEs:

```bash
spex mcp-server                # default: stdio transport
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

Full setup + Cursor instructions: [MCP integration]({{ site.baseurl }}/mcp-integration).

---

## Skills

SPEX ships a library of agent-facing skill bundles. Install them into Claude Code (or any MCP-aware client):

```bash
spex skills install                 # default: user scope (~/.claude/skills/)
spex skills install --scope=project # project scope (./.claude/skills/)
```

The bundles cover both **routing skills** (which call the SPEX CLI / MCP) and **prompt-only skills** (pure methodology — brainstorm, architecture decision records, adversarial review). Full list and authoring guide on the [Skills]({{ site.baseurl }}/skills) page.

---

## Optional integrations

Each integration is opt-in via `.ai/config.yaml` plus one or two env vars. None of them change how `spex new` / `implement` / `fix` / `review` behave at the core — they layer on top.

| Integration | Adds |
|---|---|
| **GitHub** | PR review posting, branch + PR creation, three CI workflow templates via `spex github setup`. |
| **Linear** | Drive `spex implement --from-issue`, auto-sync PR/issue status (opened → In Review, merged → Done). |
| **PostHog** | `spex fix --from-error=posthog:<ISSUE-ID>`, optional webhook auto-trigger on filtered error events. |
| **Slack** | Outbound notifications, async approval gates with Block Kit buttons, slash commands. |

Configuration schema, env vars, and minimum scopes for each integration: [Configuration]({{ site.baseurl }}/configuration).

---

## Architecture at a glance

```
packages/
  schemas/       — zod schemas: TechSpec, FeatureSpec, ImplementationPlan, …
  core/          — discovery, tech-spec, scaffold, context, implementation, bug-fix, git
  cli/           — spex binary (commander)
  mcp-server/    — MCP server (stdio) exposing seven tools
  skills/        — markdown skill bundles + loader
  integrations/
    github/      — PR/branch/review operations
    linear/      — issue/PR sync
    posthog/     — bug-source + webhook receiver
    slack/       — notifications + approvals + slash commands
```

Locked architectural decisions (TypeScript strict, Node 20 LTS, pnpm workspaces, tsup, commander, zod, Vercel AI SDK + Anthropic, biome, vitest, pino) are documented in [`CLAUDE.md`](https://github.com/rogcg/spex/blob/main/CLAUDE.md).

---

## Contributing

```bash
pnpm install
pnpm -r run build   # build packages in dependency order
pnpm test           # run vitest in every package
pnpm typecheck      # tsc --noEmit in every package
pnpm lint           # biome check
pnpm format         # biome format --write
```

Cross-package tests in `@spex/core` resolve `@spex/schemas` through its built `dist/`, so a build is required before tests can run.

Conventions in short: TypeScript strict, kebab-case files, PascalCase types, camelCase functions, Conventional Commits in English, colocated tests, `execa` over raw `child_process`, no `any`, no inlined user-facing strings (centralised in `packages/cli/src/strings.ts`).

The full convention list is in [`CLAUDE.md`](https://github.com/rogcg/spex/blob/main/CLAUDE.md).

---

## License

MIT — see [`LICENSE`](https://github.com/rogcg/spex/blob/main/LICENSE).
