---
name: spex-fix
description: Diagnose a bug and propose + verify a fix — six-phase pipeline with ranked hypotheses, root cause analysis, fix options, and regression test. Optionally sources the bug from a PostHog error issue.
---

# spex-fix

This skill drives the SPEX bug-fix pipeline. Use it when the user reports a bug (with or without a stack trace) in a SPEX-managed project, or when an error from a monitoring tool needs an automated investigation.

## When to use this skill

- The user describes a bug ("pagination resets when I change a filter", "login fails for users with apostrophes in their email").
- The user references a PostHog error issue and wants its details treated as the bug source.
- The user wants the fix verified with a regression test — i.e. fail-then-pass cycle, not just "trust the model".
- For new feature work, use **`spex-implement`** instead.

## What this skill does

Six phases, each with an approval gate unless `--auto` is set.

1. **Read codebase + bug context.** Walks the project, reads any `--affected <path>` files explicitly, collects recent commits and the `errorReference` source (e.g. PostHog).
2. **Generate ranked hypotheses** for the cause. The user picks which one to investigate first.
3. **Root cause analysis** for the picked hypothesis. If refuted, falls back to the next-ranked hypothesis. User approves the confirmed root cause.
4. **Generate a fix proposal** — typically with multiple options (e.g. "narrow fix" vs "more invasive fix") and explicit tradeoffs. User picks an option.
5. **Generate a regression test** that fails on the buggy code, then passes after the fix.
6. **Verify fail-then-pass**: run the test (should fail) → apply the fix → run the test again (should pass) → commit on a `fix/<slug>` branch.

## How to invoke

### Via the SPEX CLI

```bash
spex fix "<bug description>"
```

Common flags:
- `-a, --affected <path>` — project-relative file path the bug appears in (repeatable).
- `--error-message <text>` — paste an error message for additional context.
- `--error-stack <text>` — paste a stack trace.
- `--auto` — skip per-phase approval gates (uses the top-ranked hypothesis + recommended fix option).
- `--dry-run` — diagnose without writing or running git.
- `--no-git` — skip branch creation + commit.
- `--from-error posthog:<issue-id>` — pull the bug context from a PostHog issue (requires `POSTHOG_API_KEY`).

### Via the MCP server

Use the `spex_fix` MCP tool. Pass `{ "description": "..." }` and optional flags.

## Prerequisites

- `ANTHROPIC_API_KEY` must be set.
- The project must have a `.ai/tech-spec.yaml`.
- Working tree must be clean (or pass `--no-git`).
- For `--from-error=posthog:<id>`: `POSTHOG_API_KEY` must be set with a key that includes the *MCP Server* preset scopes.

## Expected output

- A new branch `fix/<slug>` with one or two commits (fix + regression test).
- `.ai/audit/` entries logging every phase.
- If the PostHog integration is configured: the generated PR description includes a `## PostHog` section linking back to the issue and any session recording deep-links.
- If GitHub integration auto-create-pr is on: a PR opens automatically.

## Notes

- The verify step is what distinguishes `spex-fix` from a naive "apply patch" — if the regression test does not fail before the fix, the pipeline aborts because the test does not actually cover the bug.
- Use `--dry-run` first when the bug description is vague. The hypotheses output is itself useful even without applying anything.
- PostHog regressions are unconditionally skipped by the webhook auto-trigger — re-firing a fix on a resolved issue is too risky for an unattended flow.
