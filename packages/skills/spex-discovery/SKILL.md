---
name: spex-discovery
description: Run SPEX's discovery flow to scope a new project or feature — an architect-driven Q&A that produces a structured TechSpec.
---

# spex-discovery

This skill drives the SPEX **discovery** flow. Use it when the user wants to scope a new software project or define a feature in enough detail that SPEX can scaffold or implement it.

## When to use this skill

- The user is starting a new project from scratch (`spex new <name>` flow).
- The user is initializing SPEX inside an existing project (`spex init` flow).
- The user is scoping a new feature for implementation in an existing SPEX project.

## What this skill does

1. Runs an architect-driven Q&A. The architect asks one question at a time, with each question informed by previous answers. No fixed script.
2. Supports four question types: free-form input, single-select, multi-select, and yes/no confirm.
3. **Gap detection** — at the end of the interview, the architect classifies the discovery as `complete`, `nice_to_have_missing`, or `critical_missing`. On critical, the user is asked to confirm before proceeding.
4. **Universal navigation** — at any question the user can type:
   - `/why` to see the rationale for the current question
   - `/skip` to skip the current question
   - `/back` to return to the previous question
   - `/pause` to save state and exit
   - `/?` or `/help` to see available commands
5. **Pause + resume** — `/pause` writes the discovery state to `.ai/scratch/discovery.yaml` so the user can resume later.

## How to invoke

### Via the SPEX CLI

For a new project:

```bash
spex new <project-name>
```

For an existing project:

```bash
spex init
```

(Both commands use a static question set by default. The adaptive architect-driven flow is exposed via the library API and is not yet wired into the CLI commands above.)

### Via the importable library

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

### Via the SPEX MCP server

Connect any MCP-aware client (Claude Code, Cursor, others) to the SPEX MCP server, then invoke whichever discovery tool the server exposes for your workflow (e.g. `spex_new`, `spex_implement`).

## Expected output

A structured **TechSpec** describing the project (or feature), plus an optional gap assessment if any answers were missing or skipped. The TechSpec is written to `.ai/specs/` in the project directory.

## Prerequisites

- `ANTHROPIC_API_KEY` must be set in the environment — the architect agent uses the Anthropic API via the Vercel AI SDK.
- The current working directory should be the project root (for `spex init`) or its parent (for `spex new <name>`).
