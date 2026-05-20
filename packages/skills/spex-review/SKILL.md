---
name: spex-review
description: Review a GitHub PR against its linked feature spec, project conventions, and security/performance concerns. Returns a structured review + a renderable Markdown comment. Optionally posts to the PR.
---

# spex-review

This skill drives the SPEX PR review pipeline. Use it when the user wants an AI review of a GitHub PR — either a preview or an actual posted comment.

## When to use this skill

- The user references a PR by number or URL and wants it reviewed against the project's SPEX spec.
- The user wants a structured review across multiple sections (spec compliance, conventions, performance/security, test coverage) rather than a free-form summary.
- The user wants the review automated in CI — the `pr-review.yml` workflow installed by `spex github setup` calls this same flow.

## What this skill does

1. **Fetches the PR** + its diff via Octokit. Aborts cleanly if the diff is empty.
2. **Locates the linked feature spec** by branch convention: `feature/<slug>` → `.ai/specs/<slug>.yaml`. If absent, reviews against the project-level TechSpec + diff only.
3. **Reads codebase context** for conventions detection (framework, patterns, file layout).
4. **Generates a structured review** via Claude. Two modes:
   - `single` — one LLM call returns all four sections.
   - `split` — four parallel LLM calls, one per section (more thorough, costs more tokens).
5. **Renders the Markdown comment** combining all sections plus a final recommendation (`approve` / `request_changes` / `comment`).
6. **Posts to the PR** when `auto_post: true` (or `--auto` from CLI). Otherwise prints the preview and asks for confirmation.

## How to invoke

### Via the SPEX CLI

```bash
spex review 42
spex review https://github.com/owner/repo/pull/42
```

Common flags:
- `--auto` — skip the confirm-before-post prompt and post immediately.
- `--dry-run` — generate the review and print it without posting.

### Via the MCP server

Use the `spex_review` MCP tool. Required input: `{ "pr_ref": "42" | "<full URL>" }`. Optional: `owner`, `repo`, `review_mode`, `auto_post`.

## Prerequisites

- `ANTHROPIC_API_KEY` must be set.
- `GITHUB_TOKEN` must be set with read access to the repo and (for posting) PR comment write access.
- For a bare PR number, either pass `--owner` + `--repo` or have `integrations.github.{owner, repo}` configured in `.ai/config.yaml`.

## Expected output

- A `ReviewResult` JSON object with `overall_summary`, `recommendation`, and four sections: `spec_compliance`, `conventions`, `performance_security`, `test_coverage`.
- A rendered Markdown comment string ready to post.
- When `auto_post: true`: a posted comment on the PR with the rendered Markdown, plus the comment URL returned.

## Notes

- For very large PRs, `split` mode is preferred — each section gets focused attention rather than competing for tokens in one call.
- The reviewer is **not** allowed to approve a PR programmatically — only post a comment with a recommendation. The human approver remains in the loop.
- If a linked feature spec is found, "spec compliance" gets weighted heavily. If not found, the review falls back to project-level conventions only.
