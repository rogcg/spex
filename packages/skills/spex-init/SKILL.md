---
name: spex-init
description: Add SPEX's .ai/ infrastructure to an existing project — detects the stack, asks follow-up questions, and writes a retroactive TechSpec. Requires ANTHROPIC_API_KEY.
---

# spex-init

This skill initialises SPEX inside an existing codebase. Use it when the project already exists and the user wants to bring it under SPEX management without scaffolding from scratch.

## When to use this skill

- The user has an existing project and says "initialise SPEX here", "add the .ai/ folder", "spex init", or similar.
- The user wants SPEX to *detect* the stack (framework, language, styling, etc.) rather than ask about every aspect from scratch.
- For a brand-new project, use **`spex-new`** instead.

## What this skill does

1. Verifies that `.ai/` does not already exist in the project (or honours `--force` to overwrite).
2. **Detects the stack** by reading `package.json` and the filesystem: package name, framework + version, language, styling, app-router status, src layout.
3. Shows the detected stack to the user for confirmation.
4. Runs a *follow-up* discovery focused only on context that cannot be detected from code (intended users, scale, auth model, data needs).
5. Generates a retroactive **TechSpec** via Claude. Fields that were inferred from the existing project are flagged in an `inference` block so the user can review them carefully.
6. Shows the TechSpec to the user for approval.
7. Writes `.ai/tech-spec.yaml` + supporting files into the project.

## How to invoke

### Via the SPEX CLI

From the project root:

```bash
spex init
```

To overwrite an existing `.ai/`:

```bash
spex init --force
```

## Prerequisites

- `ANTHROPIC_API_KEY` must be set in the environment (or in a `.env` file).
- The current working directory must be a valid project root (contains `package.json` or equivalent).
- For a fresh `init`, the `.ai/` folder must not already exist (or you must pass `--force`).

## Expected output

- `.ai/tech-spec.yaml` with both detected fields (in `inference`) and discovery-supplied fields.
- The user is shown the spec before it is written and must approve.

## Notes

- Stack detection currently covers TypeScript + Next.js cleanly; other stacks may produce a less complete `inference` block — read `tech-spec.yaml` and adjust the inferred fields after the run.
- This command does **not** scaffold any source code. It only writes `.ai/`.
- See [[spex-discovery]] for the discovery model behind the follow-up questions.
