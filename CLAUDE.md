# SPEX

**Spec-driven Programming EXecutor**

> AI agent orchestration framework for software development, based on versioned specs and human approval gates.

---

## Project Identity

| Attribute | Value |
|---|---|
| Name | SPEX |
| Acronym | Spec-driven Programming EXecutor |
| CLI binary | `spex` |
| npm package | `spex` (root) + `@spex/*` (sub-packages) |
| License | MIT |
| User-facing language | English |

---

## Mission

SPEX orchestrates AI agents to create, maintain, and operate codebases through:

1. **Interactive discovery** — understands the problem before executing
2. **Versioned specs** — every change produces an auditable artifact in `.ai/`
3. **Human approval gates** — AI proposes, human approves, AI executes
4. **Multi-mode runtime** — CLI + MCP server + Library

---

## Runtime Modes

| Mode | Usage |
|---|---|
| CLI standalone | `spex new`, `spex implement`, `spex fix`, etc. |
| MCP server | Consumable by Claude Code, Cursor, and other MCP-compatible IDEs |
| Importable library | `import { TechSpecGenerator } from "@spex/core"` |

---

## Language Policy

All artifacts produced by SPEX are in English:

- Source code (identifiers, comments, file names)
- Documentation (CLAUDE.md, READMEs, ADRs)
- Git commits
- CLI user-facing strings
- LLM-generated content (rationale, descriptions)

**Architectural note:** all user-facing strings shown by the CLI should be defined as exported constants in dedicated files (e.g., `packages/cli/src/strings.ts`), not inlined throughout the code. This is a code organization rule that also enables clean i18n introduction later without a sweeping refactor.

---

## Locked Architectural Decisions

These decisions MUST NOT be questioned during implementation. Changes require explicit maintainer approval before coding.

| Decision | Choice |
|---|---|
| Language | TypeScript 5+ strict |
| Minimum runtime | Node.js 20 LTS |
| Package manager | pnpm + workspaces |
| Build tool | tsup |
| CLI framework | commander |
| Schema validation | zod |
| Config format | YAML (`yaml` package) |
| Interactive prompts | `@inquirer/prompts` |
| LLM SDK | Vercel AI SDK (`ai` + `@ai-sdk/anthropic`) |
| Shell execution | `execa` (never raw `child_process.exec`) |
| Logger | pino |
| Tests | vitest |
| Lint + format | biome |

---

## Repository Structure

```
spex/
├── packages/
│   ├── cli/                    — spex binary (commander-based)
│   ├── core/                   — discovery (static + adaptive architect agent + gap detection + universal navigation + state persistence), tech-spec, scaffold, context, feature-spec, implementation, bug-fix, git, logger
│   ├── schemas/                — zod schemas (TechSpec, FeatureSpec, ImplementationPlan, …)
│   ├── mcp-server/             — MCP server exposing SPEX tools over stdio (spex_*, list_skills, get_skill)
│   ├── skills/                 — markdown skill bundles + loader (@spex/skills)
│   └── integrations/
│       └── github/             — GitHub integration (PR creation, review, …)
├── .github/
│   └── workflows/
│       └── ci.yml
├── docs/
├── package.json                — root with aggregator scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── biome.json
├── .gitignore
├── .env.example
├── LICENSE
├── README.md
└── CLAUDE.md
```

---

## Code Conventions

| Aspect | Convention |
|---|---|
| TypeScript | `strict: true`, `noUncheckedIndexedAccess: true` |
| `any` | Forbidden. Use `unknown` + narrowing |
| Files | kebab-case (`tech-spec.ts`) |
| Types | PascalCase |
| Functions | camelCase |
| Constants | UPPER_SNAKE_CASE at top level |
| Internal imports | Workspace protocol (`@spex/schemas`) |
| Errors | Classes extending `SpexError` (in `packages/core/src/errors.ts`) |
| Tests | Colocated (`foo.ts` + `foo.test.ts`) |
| Logging | `pino` in libraries. `console.log` permitted only in CLI entry for UX |
| Async | Always `async/await`. Never `.then()` |
| Commits | Conventional Commits, English |
| Source language | English only (identifiers, comments, docs) |
| User-facing strings | Centralized in `packages/cli/src/strings.ts`, not inlined |

---

## LLM Layer

### Interface

```typescript
// packages/core/src/llm/provider.ts
import { z } from 'zod';

export interface LLMProvider {
  generateStructured<T>(opts: {
    systemPrompt: string;
    userPrompt: string;
    schema: z.ZodSchema<T>;
  }): Promise<T>;
}
```

### Implementation

Anthropic via Vercel AI SDK using `generateObject` (not `generateText`) to guarantee structured output validated against the zod schema.

- API key: `process.env.ANTHROPIC_API_KEY`
- If absent, CLI aborts with a clear message before any LLM call

---

## Anti-Patterns (Do Not Do)

- ❌ Create generic abstractions without 3 concrete use cases justifying them
- ❌ Use `console.log` in library code
- ❌ Silently swallow errors (`catch {}` empty)
- ❌ Skip tests
- ❌ Commit real secrets or API keys
- ❌ Introduce decisions outside the Locked Architectural Decisions table without consultation
- ❌ Use `child_process.exec` with user input (use `execa`)
- ❌ Use `any`
- ❌ Premature optimization
- ❌ Inline user-facing strings throughout the code (centralize in `packages/cli/src/strings.ts`)
- ❌ Write non-English code identifiers, comments, or commit messages

---

## When You Encounter Ambiguity

**Stop. Ask. Do not invent.**

When the spec is incomplete or ambiguous on details not covered:

1. State the ambiguity explicitly in chat
2. Propose 2-3 options with trade-offs
3. Wait for human decision before proceeding

Inventing decisions creates technical debt.
