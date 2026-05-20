# SPEX docs

This directory holds the detailed documentation for SPEX. The top-level [`README.md`](../README.md) has the elevator-pitch summary; everything in here is the reference material.

## Pages

| Page | What it covers |
|---|---|
| [`cli-reference.md`](./cli-reference.md) | Every `spex` subcommand — arguments, flags, env vars, exit codes, examples. The entry point if you want to know what a command does. |
| [`configuration.md`](./configuration.md) | Full `.ai/config.yaml` schema for every integration (GitHub, Linear, PostHog, Slack), including defaults and validation rules. |
| [`discovery-and-techspec.md`](./discovery-and-techspec.md) | The adaptive discovery flow, the architect agent, the decision-gate engine for `spex new`, stack recommendation, scaffold planner / verifier / self-correction. |
| [`audit-and-resume.md`](./audit-and-resume.md) | `.ai/scratch/` and `.ai/audit/` layout, workflow lifecycle, crash recovery, conflict resolution, audit event schema, secret redaction. |
| [`github-workflows.md`](./github-workflows.md) | The three GitHub Actions templates installed by `spex github setup` — triggers, permissions, secrets, repo settings, and known caveats. |
| [`mcp-integration.md`](./mcp-integration.md) | Wiring SPEX as an MCP server (stdio) for Claude Code, Cursor, and other MCP-aware IDEs. Documents all seven tools. |
| [`skills.md`](./skills.md) | The agent-facing skill bundle library — format, install routes, MCP `list_skills` / `get_skill` flow, authoring guide. |

## How they fit together

- **Start here for end users:** [`cli-reference.md`](./cli-reference.md) → look up the command you want.
- **Adding an integration:** [`configuration.md`](./configuration.md) → find the block, set the env vars, enable the feature.
- **Setting up CI:** [`github-workflows.md`](./github-workflows.md) → install templates, configure secrets, check repo settings.
- **Connecting an IDE:** [`mcp-integration.md`](./mcp-integration.md) → wire the MCP server into Claude Code / Cursor.
- **Investigating a paused or crashed workflow:** [`audit-and-resume.md`](./audit-and-resume.md) → understand the on-disk layout and crash classification.
- **Understanding how `spex new` decides things:** [`discovery-and-techspec.md`](./discovery-and-techspec.md) → the discovery → recommend → decide → scaffold pipeline.
- **Letting an agent drive SPEX:** [`skills.md`](./skills.md) → install or expose the skill bundles.

## See also

- [`../README.md`](../README.md) — project overview, install, quick start.
- [`../CHANGELOG.md`](../CHANGELOG.md) — per-release diff.
- [`../CLAUDE.md`](../CLAUDE.md) — architectural decisions and code conventions.
