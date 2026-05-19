# Changelog

All notable changes to SPEX are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

While SPEX is on `0.x`, any minor release may contain breaking changes to CLI
flags, `.ai/` artifact formats, MCP tool shapes, or schema definitions. Pin to
a specific version (or commit SHA, until npm publish) if you need stability.

## [0.7.0] — 2026-05-19

### Added — PostHog integration

- New workspace package `@spex/integrations-posthog` wrapping the official
  PostHog MCP server (`https://mcp.posthog.com/mcp`). Architecture mirrors
  `@spex/integrations-linear` shipped in 0.6.0: a pooled
  `createPostHogMcpClient` keyed by `(baseUrl, apiKey-SHA-256-fingerprint)`,
  HTTPS-or-localhost enforcement, secret hygiene tests, env-driven
  `POSTHOG_API_KEY` + optional `POSTHOG_PROJECT_ID` defaults.
- Core operations: `getErrorIssue`, `queryEvents` (HogQL via `query-run`),
  `getSessionRecording`. Domain types pared down to the fields a bug-fix
  pipeline actually needs (stack frames, occurrence count, affected users,
  first/last seen, session metadata).
- `buildPostHogBugSource` — single-shot helper that fetches an issue and the
  surrounding `$exception` events, returning a `{description, errorMessage,
  errorStack, sessionRecordingUrls, firstOccurrence}` bundle ready to drop
  into the `spex fix` pipeline. Recording URLs are deduplicated, capped to
  3 by default, and gracefully fall back to empty when the events query
  fails (e.g. PostHog hasn't ingested `$exception` yet).
- New `spex fix --from-error=posthog:<issue-id>` flag (bare `<issue-id>`
  defaults to posthog) that pulls the bug-context bundle from PostHog,
  threads `errorReference` through `runFixFlow`, and renders a `## PostHog`
  section in the auto-generated PR description with the issue link,
  telemetry counts, and session recording deep-links.
- New `spex posthog-webhook` command — parses a PostHog error-tracking
  webhook payload (the `new_issue` / `regression` destination shape, plus
  fallback to event-action webhooks carrying `$exception_issue_id`),
  applies the `.ai/config.yaml` filter, and on a trigger decision invokes
  `spex fix --from-error=posthog:<id> --auto`. Regressions are
  unconditionally skipped — re-firing of a resolved issue is too risky for
  an unattended AI fix. Includes HMAC-SHA256 signature verification with
  `timingSafeEqual` comparison.
- New `.ai/config.yaml` block: `integrations.posthog.auto_fix.{enabled,
  severity, min_occurrences}` with sensible defaults
  (`enabled=false` — opt in explicitly, `severity=['critical']`,
  `min_occurrences=5`).
- `collectBugContext` now formally accepts `errorReference.source =
  'posthog'` (previously thrown). `runFixFlow` accepts and threads an
  `errorReference` through to the collector.

### Verified

- 90 CLI tests + 45 PostHog package tests + 70 GitHub package tests pass.
  Live PostHog round-trip validation (real error-tracking issue + real
  webhook delivery) is gated behind a user-configured PostHog project and
  is tracked as a follow-up smoke test rather than CI scope.

### Known issues

- Unchanged from 0.5.0: `src/logger/logger.test.ts` and
  `src/implementation/safety.test.ts` flake on Windows due to pino file
  handle race + drive-letter resolution differences. Pass on Linux CI.

## [0.5.2] — 2026-05-19

### Fixed

- **CI lint.** v0.5.0 and v0.5.1 release commits failed CI because the
  version-bump rewrite reformatted `"files": ["dist"]` arrays in every
  workspace `package.json` to multi-line form, which biome's formatter
  rejected. `pnpm exec biome format --write .` collapsed them back.
  v0.5.0 and v0.5.1 tags still point at red commits; v0.5.2 is the
  first green release.

### Added

- **CI status badge** in the README. Future regressions are visible
  from the front door.

## [0.5.1] — 2026-05-19

### Fixed

- **`spex github setup` workflow templates / `implement-from-issue.yml`:**
  the SPEX source checkout into `.spex-source/` inside the target repo
  tripped SPEX's "clean working tree" pre-flight when running `spex
  implement`. The workflow now appends `.spex-source/` to
  `.git/info/exclude` after checkout, so `git status --porcelain` skips
  it without modifying the user's `.gitignore`.
- **Implementation plan validator** (`validatePlanIntegrity`) now detects
  two failure modes the LLM occasionally produces:
  - duplicate paths within `tests_to_add`
  - the same path appearing in both `plan.operations` and
    `plan.tests_to_add` — the executor writes source ops first, then
    tests, so this previously crashed mid-execution with "file already
    exists" after partial writes. Validator now rejects the plan up
    front with a clear message.

### Documented

- **`implement-from-issue.yml`** header now lists the repo-level setting
  "Allow GitHub Actions to create and approve pull requests" as a
  requirement. Without it the branch is pushed but PR creation fails
  with "GitHub Actions is not permitted to create or approve pull
  requests." Local commits are intact in that case; the PR can be
  opened manually.

### Verified

- Caught and fixed during a second-pass E2E validation of the workflow
  templates against a sandbox repo. `implement-from-issue.yml` now runs
  green end-to-end (59s cold start) and opens a PR with feat + test
  commits.

## [0.5.0] — 2026-05-19

### Added — GitHub integration

- New workspace package `@spex/integrations-github` wrapping Octokit with a
  retry-enabled client (`createGitHubClient`), token resolution from
  `process.env.GITHUB_TOKEN`, and configurable base URL for GitHub Enterprise.
- Branch operations: `createBranchOnGitHub`, `deleteBranchOnGitHub`, and
  `pushBranchToGitHub` — the latter uses an embedded HTTPS+token URL to push
  without touching the user's SSH config, with automatic redaction of the
  token from any error output.
- PR operations: `createPullRequest`, `commentOnPullRequest`,
  `readPullRequestDiff`, `readPullRequest`, `listPullRequests`.
- Issue operations: `readIssue`, `listIssues`, `commentOnIssue`.
- New `.ai/config.yaml` schema with `integrations.github.{owner, repo,
  auto_create_pr, pr_labels, base_branch, host, review_mode}` — read by
  `loadAiConfig`.
- `spex implement` and `spex fix` now optionally push the feature branch and
  open a PR after committing, gated by `integrations.github.auto_create_pr`
  in `.ai/config.yaml`. PR description is built deterministically from the
  feature spec / fix info and then polished by Claude (falling back to the
  template on any failure).
- New `spex review <pr-ref>` command (and `spex_review` MCP tool) that
  fetches a PR + its diff, locates the linked feature spec by branch
  convention (`feature/<slug>` → `.ai/specs/<slug>.yaml`), generates a
  structured review across four sections (spec compliance, conventions,
  performance/security, test coverage), and posts the rendered Markdown as
  a PR comment. Supports `--auto` (skip confirm) and `--dry-run` (preview).
  Two review modes: `single` (one LLM call) and `split` (four parallel calls,
  one per section).
- New `spex github setup` command installs two GitHub Actions workflow
  templates into the current project: `pr-review.yml` (auto-review on PR
  opened/reopened/ready_for_review) and `implement-from-issue.yml`
  (implement on issue label `spex:implement`). `--force` overwrites
  existing files.
- Workflow templates install SPEX from the public GitHub repo via
  `actions/checkout` + `pnpm install` + `pnpm -r build`. `SPEX_REPO` and
  `SPEX_REF` env vars at the top of each template let users pin a tag.
  Once SPEX is published to npm (deferred to a future release sprint),
  these will collapse to `npm install -g spex`.

### Verified

- End-to-end run against a real private GitHub repo: `spex implement`
  opened a PR, applied labels, and `spex review` posted a structured
  comment. Full results documented in SPX-46.

### Known issues

- `src/logger/logger.test.ts` and `src/implementation/audit.test.ts` fail on
  Windows due to pino holding file handles past test teardown
  (`ENOTEMPTY` rmdir race). Tests pass on Linux CI. Tracked for fix.
- PowerShell 5.1 writes UTF-8 with BOM by default; YAML / JSON files
  authored that way are rejected by the SPEX parsers. Not a SPEX bug —
  caller responsibility.

## [0.4.0] — 2026-05-18

### Added — `spex fix`

- New `spex fix [description]` command for bug investigation and
  correction, exposed both via CLI and as the `spex_fix` MCP tool.
- Six-phase pipeline: bug-context collection → ranked hypotheses → root
  cause analysis (with hypothesis fallback) → fix proposal (with
  trade-offs) → regression test generation → verify fail-then-pass +
  commit. Each phase has an approval gate by default.
- Flags: `--auto`, `--dry-run`, `--no-git`, `-a/--affected <path>`,
  `--error-message`, `--error-stack` for structured input.
- New schemas: `BugContext`, `HypothesisSet`, `RootCauseAnalysis`,
  `BugFixProposal`, `RegressionTest`.

## [0.3.0] — 2026-05-18

### Added — MCP server mode

- New workspace package `@spex/mcp-server` built on
  `@modelcontextprotocol/sdk`, exposing SPEX as MCP tools (`spex_new`,
  `spex_implement`) over stdio for consumption by Claude Code, Cursor,
  and other MCP-compatible IDEs.
- New `spex mcp-server` CLI command (`--transport stdio` default;
  `--port` placeholder for future HTTP transport). Automatically sets
  `SPEX_LOG_DEST=stderr` so stdout stays exclusively for MCP protocol
  traffic.
- Logger refactor: pino now writes to stderr or a file by default, never
  stdout. New `SPEX_LOG_DEST` env var controls destination.
  `console.log` audit guarantees only CLI entry points emit on stdout.
- IDE integration documentation: `docs/mcp-integration.md` covers
  Claude Code + Cursor configuration and common stdio issues.

## [0.2.0] — 2026-05-18

### Added — `spex implement`

- New `spex init` command — adds `.ai/` infrastructure to an existing
  project by detecting stack from `package.json` + filesystem, asking
  follow-up questions for context that can't be inferred, and generating
  a retroactive `tech-spec.yaml` with `inference` block flagging
  detected fields.
- New `spex implement "<description>"` command — full feature
  implementation pipeline:
  - Context discovery system (file reader with `.gitignore` awareness,
    pattern detector, tech-spec loader, token-budget aggregator).
  - Feature-spec generation (`FeatureSpecSchema` — mini-spec scoped to
    one feature, written to `.ai/specs/<slug>.yaml`).
  - Implementation planner producing a discriminated union of file
    operations (create / modify / delete) with diffs.
  - Code executor with dry-run, auto, and step-by-step modes; atomic
    backup/rollback on failure.
  - Git operations module: branch creation (`feature/<slug>`), dirty-tree
    detection, atomic structured commits, conventional-commits messages.
- Flags: `--auto`, `--dry-run`, `--no-git`.

## [0.1.0] — 2026-05-17

### Added — Foundation + `spex new`

- Initial monorepo bootstrap (pnpm workspaces, TypeScript strict, biome,
  GitHub Actions CI).
- `@spex/schemas` package with `TechSpecSchema` (zod).
- `@spex/core` package with:
  - LLM provider abstraction + Anthropic implementation via Vercel AI SDK
    (`generateObject` for structured output).
  - `SpexError` base class.
  - Discovery flow with 5 hardcoded questions via `@inquirer/prompts`.
  - Tech-spec generator (LLM-driven) + YAML writer.
  - Scaffold executor (Next.js via `create-next-app`) + `.ai/` folder
    injection.
  - Logger (pino).
- `@spex/cli` package — `spex new <name>` command running discovery →
  spec generation → scaffold → `.ai/` injection → `git init` + initial
  commit. Centralized user-facing strings in `packages/cli/src/strings.ts`.
- CI workflow (`.github/workflows/ci.yml`) running install, lint,
  typecheck, test on push + PR.

[0.7.0]: https://github.com/rogcg/spex/releases/tag/v0.7.0
[0.5.2]: https://github.com/rogcg/spex/releases/tag/v0.5.2
[0.5.1]: https://github.com/rogcg/spex/releases/tag/v0.5.1
[0.5.0]: https://github.com/rogcg/spex/releases/tag/v0.5.0
[0.4.0]: https://github.com/rogcg/spex/releases/tag/v0.4.0
[0.3.0]: https://github.com/rogcg/spex/releases/tag/v0.3.0
[0.2.0]: https://github.com/rogcg/spex/releases/tag/v0.2.0
[0.1.0]: https://github.com/rogcg/spex/releases/tag/v0.1.0
