---
title: MCP integration
layout: default
nav_order: 7
description: "Wiring SPEX as an MCP server for Claude Code, Cursor, and other MCP-aware IDEs."
---

# SPEX MCP integration

This guide explains how to expose SPEX to MCP-compatible IDEs (Claude Code,
Cursor, …) so the IDE's LLM can invoke SPEX workflows directly.

SPEX speaks the [Model Context Protocol](https://modelcontextprotocol.io/) over
the **stdio transport**. HTTP/SSE transports are planned.

---

## What you get

Once configured, the IDE sees seven tools — five engine tools and two skills tools.

### Engine tools

| Tool | Purpose |
|---|---|
| `spex_new` | Create a new SPEX-managed project. The AI recommends a best-fit stack from the supplied discovery answers (or honors an optional `stack` argument for an explicit choice), plans the scaffold dynamically, executes it with a verification + self-correction loop, and writes `.ai/`. Non-interactive: all answers in one call. |
| `spex_implement` | Implement a single feature inside an existing SPEX project (must contain `.ai/`). Runs the full context → spec → plan → execute → commit pipeline non-interactively. |
| `spex_fix` | Diagnose and fix a bug in an existing SPEX project. Runs the full 6-phase pipeline (hypotheses → root cause → fix proposal → regression test → verify) non-interactively. Optionally accepts a structured `error` payload, a per-bug `affected_files` list, and a `test_command` override when the host doesn't have vitest/jest on `PATH`. |
| `spex_review` | Review a GitHub PR against its linked feature spec and project conventions. Returns a structured review + rendered Markdown comment. Optionally posts to the PR. Requires `GITHUB_TOKEN`. |
| `spex_resume` | Inspect or manage paused / interrupted SPEX workflows under `.ai/scratch/`. Without arguments returns the resumable subset of the workflow list; `list: true` enumerates all known workflows; `workflow_id` targets one; `abandon: <id>` deletes a workflow cleanly. |

### Skills tools

| Tool | Purpose |
|---|---|
| `list_skills` | List the SPEX skill bundles available on this server. Returns each skill's manifest (name, description, optional allowed-tools). Empty input. |
| `get_skill` | Fetch a single skill by name. Returns the manifest plus the full `SKILL.md` markdown body. Input: `{ "name": "<kebab-case-name>" }`. |

### Tool input shapes — quick reference

| Tool | Required | Optional |
|---|---|---|
| `spex_new` | `name`, `project_type` | `primary_users`, `expected_scale`, `auth_requirements`, `data_persistence`, `stack`, `parent_dir` |
| `spex_implement` | `description` | `project_dir`, `dry_run`, `no_git` |
| `spex_fix` | `description` | `project_dir`, `affected_files`, `error` (`message` / `stack` / `firstOccurrence`), `dry_run`, `no_git`, `test_command` (`bin` / `args` / `append_test_path`) |
| `spex_review` | `pr_ref` | `project_dir`, `owner`, `repo`, `review_mode` (`single` \| `split`), `auto_post` |
| `spex_resume` | — | `project_dir`, `workflow_id`, `list`, `abandon` |
| `list_skills` | — | — |
| `get_skill` | `name` | — |

All tools return `isError: true` with a structured payload on validation failures, missing env vars, dirty working trees, or downstream errors. They never re-prompt — the host is responsible for collecting any further input from the user.

Skills are markdown bundles that instruct the agent how to invoke SPEX
workflows (routing skills) or how to apply a methodology like brainstorming
or adversarial review (prompt-only skills). See [`docs/skills.md`](./skills.md)
for the full library and authoring guide.

The IDE's LLM is responsible for gathering parameters from the user via chat
and assembling a single tool call. SPEX never re-prompts during a tool
invocation.

---

## Requirements

- Node.js 20 LTS or newer.
- `ANTHROPIC_API_KEY` available to the process the IDE spawns. SPEX calls
  Anthropic from inside both tools; without the key the call returns an
  `isError` result with a clear message.
- For `spex_implement`: the target project must already be a git repo with a
  clean working tree (or call with `no_git: true`).
- The `spex` binary must be on the IDE process's `PATH`, **or** the config
  must use an absolute path to it.

### Installing the binary

From the repo checkout, the simplest setup is:

```bash
pnpm install
pnpm -r run build
# Make `spex` callable from anywhere:
cd packages/cli
npm link
```

`npm link` creates a global symlink so any spawn of `spex` (including from an
IDE child process) resolves to your built binary. You can also use the
equivalent `spex-mcp-server` binary published by `@spex/mcp-server`:

```bash
cd packages/mcp-server
npm link
# Now `spex-mcp-server` works too.
```

You can also point the IDE at an absolute `node …/packages/cli/dist/index.js`
invocation if you prefer not to globally link.

---

## Claude Code

Claude Code reads MCP server configuration from a few locations. The simplest
is the user-scope file at `~/.claude.json`, or a project-scope `.mcp.json`
file in your workspace root. The file format is the same:

```jsonc
{
  "mcpServers": {
    "spex": {
      "command": "spex",
      "args": ["mcp-server"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

If you'd rather call the dedicated binary directly:

```jsonc
{
  "mcpServers": {
    "spex": {
      "command": "spex-mcp-server",
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

Or with an absolute path (no `npm link` required):

```jsonc
{
  "mcpServers": {
    "spex": {
      "command": "node",
      "args": ["/Users/you/code/spex/packages/cli/dist/index.js", "mcp-server"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

Equivalent CLI:

```bash
claude mcp add spex --command spex --args mcp-server
```

After editing the config, restart Claude Code. Open a new conversation and
ask the assistant something like "list the spex tools" — it should report
all seven: `spex_new`, `spex_implement`, `spex_fix`, `spex_review`,
`spex_resume`, `list_skills`, and `get_skill`.

For the most up-to-date Claude Code MCP setup details, see the official docs:
<https://docs.claude.com/en/docs/claude-code/mcp>.

---

## Cursor

Cursor reads MCP server configuration from `~/.cursor/mcp.json` (user scope)
or `.cursor/mcp.json` at the workspace root (project scope). The schema is
the same as Claude Code:

```jsonc
{
  "mcpServers": {
    "spex": {
      "command": "spex",
      "args": ["mcp-server"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-..."
      }
    }
  }
}
```

Restart Cursor after editing. In a new chat, the agent's tool list should
include all seven SPEX tools: `spex_new`, `spex_implement`, `spex_fix`,
`spex_review`, `spex_resume`, `list_skills`, and `get_skill`.

---

## Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | Required by every engine tool (`spex_new`, `spex_implement`, `spex_fix`, `spex_review`). Used to call Claude for spec / plan / review generation. | — |
| `GITHUB_TOKEN` | Required by `spex_review` (Octokit auth) and by any flow that pushes a branch / opens a PR. The default `GITHUB_TOKEN` provided by GitHub Actions is sufficient when running in a workflow. | — |
| `LINEAR_API_KEY` | Only consumed when SPEX flows linked through Linear actually run (`spex_implement` with a Linear-sourced description, or the `spex linear-sync` CLI). | — |
| `POSTHOG_API_KEY` | Only consumed when `spex_fix` is invoked with a PostHog-sourced error reference or `spex posthog-webhook` fires. | — |
| `POSTHOG_PROJECT_ID` | Optional default project when the personal API key has multiple projects. | — |
| `SLACK_BOT_TOKEN` / `SLACK_SIGNING_SECRET` / `SLACK_TOKEN_STORAGE_KEY` | Required only when the Slack integration is wired up (notifications, approval gates, slash commands). | — |
| `SPEX_LOG_DEST` | Where SPEX writes logs. `stderr` (default and safe), `stdout` (NEVER under stdio MCP), or `file:<path>`. | `stderr` (forced by `spex mcp-server`) |
| `SPEX_LOG_LEVEL` | pino log level. Useful values: `debug`, `info`, `warn`, `error`. | `info` |

`spex mcp-server` and `spex-mcp-server` both force `SPEX_LOG_DEST=stderr`
when it isn't already set, so logs cannot accidentally corrupt the protocol
stream on stdout.

---

## Troubleshooting

### The IDE says "no spex tools available"

The IDE couldn't start the server. Common causes:

- **`spex` not on PATH.** Try `which spex` (Unix) or `where spex` (Windows)
  inside a shell that mirrors the IDE's environment. If empty, use an
  absolute `command` / `args` like the `node …/dist/index.js` form above.
- **Permission denied.** After a fresh `pnpm build`, run
  `ls -l packages/cli/dist/index.js` — the bin should be executable. The
  `#!/usr/bin/env node` shebang plus npm-link bookkeeping usually handles
  this; if not, `chmod +x packages/cli/dist/index.js`.
- **Stale build.** SPEX is not yet published to npm. Re-run
  `pnpm -r run build` after pulling.

### The IDE log shows "JSON parse error" or "transport closed unexpectedly"

Something wrote non-JSON-RPC to stdout, breaking the framing. This is the
most-likely-cause checklist:

- Confirm you launched via `spex mcp-server`, **not** `spex new`/`spex init`/
  `spex implement` — those CLI commands write a banner to stdout and are
  expected to be human-facing only.
- Ensure `SPEX_LOG_DEST` is unset (the binary forces `stderr` automatically)
  or explicitly set to `stderr` / `file:<path>`. Setting it to `stdout`
  WILL corrupt the protocol.
- The CLI command auto-skips the banner. If you wrapped the binary in your
  own shell script that prints something before exec-ing, remove the print.

### `isError: true` with "ANTHROPIC_API_KEY is not set"

The IDE process doesn't see the key. Put it in the `env` block of the MCP
config (see examples above), or export it in your shell profile if the IDE
inherits parent env, then restart the IDE.

### `spex_implement` returns "uncommitted changes"

The target project's working tree is dirty. Either commit / stash first, or
pass `no_git: true` in the tool arguments.

### Tools work but I can't see logs

Set a file destination so you can `tail -f` them while debugging:

```jsonc
{
  "mcpServers": {
    "spex": {
      "command": "spex",
      "args": ["mcp-server"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "SPEX_LOG_DEST": "file:/tmp/spex-mcp.log",
        "SPEX_LOG_LEVEL": "debug"
      }
    }
  }
}
```

Then in a separate terminal: `tail -f /tmp/spex-mcp.log`.

---

## Resume + audit log via MCP

`spex_resume` lets the IDE manage paused or crashed workflows without leaving the chat. Typical flow:

1. The IDE calls `spex_resume` with no arguments → server returns `resumable` (the subset in `paused` / `running` / `crashed` status) plus the full `workflows` list for context.
2. The IDE shows the resumable list to the user and decides which workflow to resume.
3. To resume a specific workflow, the IDE calls `spex_resume` with `workflow_id`. The server returns the full `ScratchState` payload (`kind`, `status`, `description`, `pid`, `hostname`, `payload`) so the IDE can re-enter the originating flow on its side.
4. To discard a workflow, the IDE calls `spex_resume` with `abandon: <id>`. The server deletes the scratch directory and returns `{ status: "success", abandoned: <id> }`.

The audit log under `.ai/audit/` is intentionally NOT exposed as a tool — it is a local on-disk record. Use the `spex logs` CLI from the same project for querying. See [`docs/audit-and-resume.md`](./audit-and-resume.md) for the on-disk layout and event schema.

---

## Not yet supported

- HTTP / SSE transports. Only stdio is supported; `--port` is a placeholder.
- GitHub `--from-issue` inside the MCP tools. Available via the CLI (`spex implement --from-issue <ID>`); the MCP `spex_implement` tool accepts a plain description only.
- Interactive prompts inside a tool call. Tools are non-interactive by
  design — the IDE's chat is the user interaction layer. The `spex_resume`
  tool returns enough information for the IDE to drive the conversation,
  but it cannot itself prompt the user.
