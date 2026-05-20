---
title: Skills
layout: default
nav_order: 8
description: "The agent-facing skill bundle library — format, install routes, MCP list_skills / get_skill flow, authoring guide."
---

# SPEX Skills

SPEX ships a library of **agent-facing skills** — markdown bundles that tell an AI agent (Claude Code, Cursor, or any MCP-aware client) how to invoke SPEX's workflows and how to follow a few methodologies that aren't backed by code.

Skills are an additive distribution layer. They do not replace the SPEX CLI or the MCP server — they live on top of both. Skills authored against the SPEX library work today; the same skill bundle is consumable by any IDE that understands the Claude Code skill format.

---

## Why skills

SPEX began as code: a TypeScript orchestration engine with a CLI, an MCP server, and a library. That engine is unchanged. Skills add a thin **markdown** layer in front of it so that:

- Any MCP-aware agent can discover SPEX's capabilities at runtime (`list_skills`) without prior knowledge of the CLI flags.
- Any user with Claude Code can install the SPEX skill set into their `~/.claude/skills/` directory in one command (`spex skills install`).
- Pure-methodology skills (brainstorm, ADR, adversarial review) can ship alongside the routing skills without forcing them into the TypeScript codebase.

The library is editable — every skill is one `SKILL.md` file in `packages/skills/<name>/` and can be reworded without recompilation.

---

## The skill format

Each skill is a directory under `packages/skills/` containing exactly one `SKILL.md` file. The file is the [Claude Code single-file skill format](https://docs.claude.com/en/docs/claude-code/skills): YAML frontmatter at the top, markdown body below.

```markdown
---
name: spex-discovery
description: Run SPEX's discovery flow to scope a new project or feature — an architect-driven Q&A that produces a structured TechSpec.
---

# spex-discovery

This skill drives the SPEX discovery flow. Use it when …
```

### Frontmatter fields

| Field | Required | Notes |
|---|---|---|
| `name` | yes | Kebab-case identifier (`^[a-z][a-z0-9-]*$`). The directory name must match. |
| `description` | yes | One-sentence summary shown to agents when listing skills. The agent uses this to decide whether to invoke the skill — be specific. |
| `allowed-tools` | no | Array of tool names the skill is permitted to call (e.g. `["Bash", "Read"]`). Honoured by Claude Code's safety layer. |

### Body

The body is rendered to the agent verbatim when the skill is invoked. There is no template language; the markdown is the contract. Conventional sections used by the SPEX skills:

- **When to use this skill** — disambiguates from neighbouring skills.
- **What this skill does** — the actual workflow / methodology.
- **How to invoke** — CLI command(s), library API(s), and MCP tool(s).
- **Prerequisites** — env vars, file system state, repo state.
- **Expected output** — what the user sees when the skill completes.
- **Notes** — gotchas, deferred features, related skills.

---

## The shipped library

SPEX ships **nine** skills out of the box. Six are *routing* skills (thin markdown that tells the agent which SPEX CLI command or MCP tool to invoke); three are *prompt-only* skills (pure methodology, no engine wiring).

### Routing skills

| Skill | Routes to |
|---|---|
| [`spex-new`](../packages/skills/spex-new/SKILL.md) | `spex new <name>` — scaffold a new project + write `.ai/`. |
| [`spex-init`](../packages/skills/spex-init/SKILL.md) | `spex init` — add `.ai/` to an existing project (detects stack). |
| [`spex-discovery`](../packages/skills/spex-discovery/SKILL.md) | The adaptive architect-driven discovery flow (CLI / library / MCP). |
| [`spex-implement`](../packages/skills/spex-implement/SKILL.md) | `spex implement` — feature pipeline with approval gates. |
| [`spex-fix`](../packages/skills/spex-fix/SKILL.md) | `spex fix` — 6-phase bug-fix pipeline with regression test. |
| [`spex-review`](../packages/skills/spex-review/SKILL.md) | `spex review` — PR review against linked feature spec. |

### Prompt-only skills

| Skill | Purpose |
|---|---|
| [`spex-brainstorm`](../packages/skills/spex-brainstorm/SKILL.md) | Structured divergent-then-convergent ideation. Produces a ranked options document. |
| [`spex-architecture-decision`](../packages/skills/spex-architecture-decision/SKILL.md) | ADR (Architecture Decision Record) generation: context, alternatives, evaluation table, decision with rationale, consequences, "when to revisit". |
| [`spex-adversarial-review`](../packages/skills/spex-adversarial-review/SKILL.md) | Red-team a spec / PR / plan through four lenses (missing context, hidden assumptions, adversarial inputs, hidden coupling). Ranked risks + mitigations. |

---

## Installing skills into Claude Code

The `spex skills install` CLI command copies the bundled skills into a Claude Code skills directory.

### User-wide install (default)

Installs to `~/.claude/skills/` so the skills are available across every project on your machine:

```bash
spex skills install
# or equivalently:
spex skills install --scope=user
```

### Project-local install

Installs to `./.claude/skills/` (relative to the current working directory) so the skills are versioned with the project:

```bash
cd my-project
spex skills install --scope=project
```

The install is **idempotent**. Re-running overwrites the existing skill files with the current `@spex/skills` contents — useful after a SPEX upgrade.

---

## Using skills via the MCP server

Any MCP-aware client (Claude Code, Cursor, others) can pull skills at runtime via the SPEX MCP server. No install step required.

The server exposes two skill tools alongside the five engine tools (`spex_new`, `spex_implement`, `spex_fix`, `spex_review`, `spex_resume`) for a total surface of seven tools:

| Tool | Input | Output |
|---|---|---|
| `list_skills` | `{}` (empty object) | `{ skills: [{ name, description, "allowed-tools" }, ...] }` |
| `get_skill` | `{ name: "<kebab-case-name>" }` | `{ manifest: {...}, body: "<full SKILL.md body>" }` |

Typical agent flow:

1. Agent calls `list_skills` → sees the nine skills with their one-line descriptions.
2. Agent matches the user's request to one of them by description.
3. Agent calls `get_skill({ name: "..." })` → receives the full markdown body, which it then follows.

The skill source is identical to the `spex skills install` source — both are `@spex/skills`. There is no drift.

---

## Authoring a new skill

1. Create a new directory under `packages/skills/<name>/` where `<name>` is kebab-case.
2. Write a `SKILL.md` file with the frontmatter + body described above.
3. Run `pnpm --filter @spex/skills test` — the loader's tests validate that every skill has correct frontmatter.
4. Run `pnpm --filter @spex/skills build` — rebuilds the package so consumers see the new skill.
5. Open a PR. The CI test suite will run loader validation across all skills.

The loader walks the package directory at runtime, so no manifest registration step is needed — adding the directory is enough.

### Routing vs prompt-only — which should I author?

**Routing** when:
- There is already a SPEX CLI command, library function, or MCP tool that does the work.
- The skill's job is to tell an agent *which* command to invoke with *what* arguments.
- The body is mostly "how to call" + "when to use" + "prerequisites".

**Prompt-only** when:
- The work is methodology, not code. Examples: brainstorming, decision-making, code review, retrospectives.
- There is no engine call to make — the agent itself does the work by following the instructions.
- The body is the actual process the agent should walk through, often phase-by-phase.

If a skill needs *both* — invoke an engine command **and** apply methodology around it — start as a routing skill and put the methodology inline.

---

## Where the loader lives

The loader is in `packages/skills/src/loader.ts` and exports:

```ts
export async function loadSkills(options?: { rootDir?: string }): Promise<LoadedSkill[]>;
export async function getSkill(name: string, options?: { rootDir?: string }): Promise<LoadedSkill | null>;
```

Each `LoadedSkill` contains:

- `manifest` — the validated frontmatter (zod-checked).
- `body` — the markdown body, verbatim.
- `dir` — the absolute path to the skill's directory.

The default `rootDir` resolves to `packages/skills/` (one level up from the built loader file). Tests override it to point at a temp directory with synthetic skills.

---

## Related docs

- [`docs/mcp-integration.md`](./mcp-integration.md) — connecting Claude Code / Cursor to the SPEX MCP server, including the skill tools.
- [`docs/cli-reference.md`](./cli-reference.md#spex-skills-install) — the `spex skills install` CLI surface.
- [`docs/discovery-and-techspec.md`](./discovery-and-techspec.md) — what the `spex-discovery` skill routes into.
- [`CHANGELOG.md`](../CHANGELOG.md) — release notes; the v0.9.0 entry introduces the Skills foundation.
- [`packages/skills/spex-discovery/SKILL.md`](../packages/skills/spex-discovery/SKILL.md) — the first end-to-end skill.
