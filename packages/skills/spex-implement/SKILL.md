---
name: spex-implement
description: Implement a feature in a SPEX-managed project — reads the codebase, generates a feature spec + implementation plan, then applies file ops with approval gates. Optionally sources the description from a Linear issue.
---

# spex-implement

This skill drives the SPEX feature-implementation pipeline. Use it when the user wants to add a feature, refactor, or otherwise change code in an existing SPEX-managed project.

## When to use this skill

- The user describes a feature ("add pagination to the user list", "support OAuth login", etc.) in a project that has a `.ai/` folder.
- The user references a Linear issue and wants its title + description treated as the feature spec source.
- The user wants approval gates between each phase — *not* a fire-and-forget code-write.
- For bug fixes, use **`spex-fix`** instead.
- For PR review, use **`spex-review`** instead.

## What this skill does

The pipeline runs in five phases. Each phase ends in an approval gate unless `--auto` is set.

1. **Read codebase context.** Walks the project (gitignore-aware), detects framework + patterns, loads the project-level TechSpec.
2. **Generate a feature spec** (`FeatureSpec` — a mini-spec scoped to one feature). User reviews it.
3. **Generate an implementation plan** — a discriminated union of file operations (`create` / `modify` / `delete`) plus a list of tests to add. User reviews it.
4. **Execute the plan** — write files, run tests. Supports `--auto` (no per-op confirm), `--dry-run` (preview, write nothing), and step-by-step mode (default — confirm each op).
5. **Commit changes** — atomic feat commit + separate test commit on a `feature/<slug>` branch (or skip git ops with `--no-git`).

If the project's `.ai/config.yaml` has `integrations.github.auto_create_pr: true` and `GITHUB_TOKEN` is set, the branch is pushed and a PR is opened with a Claude-polished description.

## How to invoke

### Via the SPEX CLI

```bash
spex implement "<feature description>"
```

Common flags:
- `--auto` — skip all per-phase approval gates (dangerous; applies everything).
- `--dry-run` — preview the spec, plan, and ops without writing files or touching git.
- `--no-git` — skip branch creation + commits.
- `--from-issue <SPX-NN>` — read the description from a Linear issue (requires `LINEAR_API_KEY`).

### Via the MCP server

Use the `spex_implement` MCP tool. Pass `{ "description": "..." }` and optional flags.

## Prerequisites

- `ANTHROPIC_API_KEY` must be set.
- The project must have a `.ai/tech-spec.yaml` (run **`spex-init`** or **`spex-new`** first).
- Working tree must be clean (or pass `--no-git`).
- For `--from-issue`: `LINEAR_API_KEY` must be set and the issue id must follow the team-key pattern (e.g. `SPX-47`).

## Expected output

- A new branch `feature/<slug>` with two commits: a `feat:` commit for source changes and a `test:` commit for added tests.
- `.ai/specs/<slug>.yaml` recording the feature spec.
- `.ai/audit/` entries logging every LLM call and decision.
- Optionally: a GitHub PR with a polished description.

## Notes

- The approval gates protect production. Use `--dry-run` first if you are not sure what the change will look like.
- The implementation plan is validated for integrity (no duplicate paths, no overlap between `operations` and `tests_to_add`) before executing.
- The audit log under `.ai/audit/` is the source of truth for "what did the AI do" — it captures every LLM exchange.
