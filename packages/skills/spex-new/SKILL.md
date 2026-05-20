---
name: spex-new
description: Scaffold a new SPEX-managed project from scratch — runs discovery, generates a TechSpec, scaffolds the chosen stack, and writes the .ai/ folder. Requires ANTHROPIC_API_KEY.
---

# spex-new

This skill creates a new project under SPEX management. Use it when the user has no existing codebase and wants to start one with spec-driven scaffolding.

## When to use this skill

- The user says "create a new project", "scaffold a new app", "spex new", or similar.
- The user has no existing codebase yet — for adding SPEX to an existing project, use **`spex-init`** instead.
- The user wants the architect to interview them about the project, generate a TechSpec, and scaffold the chosen stack.

## What this skill does

1. Validates the project name (lowercase letters, numbers, dashes only).
2. Runs the discovery flow — the architect agent asks adaptive questions about project type, primary users, expected scale, auth requirements, data persistence, and any project-specific concerns. See [[spex-discovery]] for the full discovery model (gap detection, navigation commands, pause/resume).
3. Generates a structured **TechSpec** via Claude and shows it to the user for approval.
4. Scaffolds the chosen stack (currently Next.js).
5. Writes `.ai/tech-spec.yaml` + supporting files into the new project.
6. Initialises git in the new project with a first commit recording the `.ai/` folder.

## How to invoke

### Via the SPEX CLI

```bash
spex new <project-name>
```

The command runs from the parent directory of where the project should be created. SPEX creates `<project-name>/` and scaffolds inside it.

### Via the MCP server

The `spex_new` MCP tool exposes the same flow to Claude Code, Cursor, and other MCP-aware clients. Pass `{ "name": "<project-name>" }` as input.

## Prerequisites

- `ANTHROPIC_API_KEY` must be set in the environment (or in a `.env` file).
- The parent directory must not already contain a folder with the chosen project name.
- For the Next.js default stack, `pnpm` (or whatever package manager the CLI is configured to invoke) must be installed.

## Expected output

- A new directory `<project-name>/` containing the scaffolded application.
- `<project-name>/.ai/tech-spec.yaml` describing the project.
- A first git commit (`chore: add SPEX .ai/ folder`) recording the spec.

## Notes

- The user is shown the generated TechSpec before any scaffolding runs and must approve it. Reject → no files are written.
- All user-facing strings shown by the CLI are centralised in `packages/cli/src/strings.ts` and may be reworded for i18n in the future.
- The discovery flow used by `spex new` is the static 5-question flow. The adaptive architect-driven flow is available via the library API but is not yet wired into this command.
