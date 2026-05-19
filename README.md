# SPEX

**Spec-driven Programming EXecutor**

> AI agent orchestration framework for software development, based on versioned specs and human approval gates.

> ⚠️ **Work in progress — do NOT use for real projects.** SPEX is under active development and is **not production-ready**. CLI flags, package APIs, `.ai/` artifact formats, and MCP tool shapes may change without notice and without migration paths. Expect breakages, partial features, and undocumented behavior. Use it on throwaway sandboxes for evaluation only. Not yet published to npm — install from a checkout (see below).

See [`CLAUDE.md`](./CLAUDE.md) for the architectural decisions and code conventions.

## Requirements

- Node.js 20 LTS or newer
- pnpm 9 or newer
- An `ANTHROPIC_API_KEY` set in your environment (see `.env.example`)

## Quick start (from a checkout)

```bash
pnpm install
pnpm -r run build
```

### Create a new project — `spex new`

```bash
ANTHROPIC_API_KEY=sk-... node packages/cli/dist/index.js new my-saas
```

1. Ask 5 discovery questions about the project.
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

### Run as an MCP server — `spex mcp-server`

Expose SPEX as tools to Claude Code, Cursor, and other MCP-compatible IDEs.
The server speaks the [Model Context Protocol](https://modelcontextprotocol.io/)
over stdio and registers tools (`spex_new`, `spex_implement`, `spex_fix`, …)
that the IDE's LLM can call directly.

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
  core/          — LLM, discovery, tech-spec, scaffold, init, context, feature-spec,
                   implementation (planner/executor), bug-fix, git, logger (@spex/core)
  cli/           — spex binary with new, init, implement, fix, review, mcp-server commands (@spex/cli)
  mcp-server/    — MCP server (stdio) exposing SPEX tools (@spex/mcp-server)
  integrations/
    github/      — GitHub PR/branch/review operations (@spex/integrations-github)
```

## License

[MIT](./LICENSE)
