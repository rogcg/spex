# GitHub Actions workflow templates

`spex github setup` installs three workflow templates into `.github/workflows/`. Each is a self-contained YAML file that clones SPEX from this repo, builds it, and runs the relevant subcommand against the event payload.

## Templates installed

| File | Trigger | Purpose |
|---|---|---|
| `pr-review.yml` | `pull_request` (opened / reopened / ready_for_review) | Runs `spex review` against every newly opened PR and posts a structured Markdown comment. |
| `implement-from-issue.yml` | `issues` (labeled) — only fires for label `spex:implement` | Implements the issue on a `feature/…` branch and opens a PR. |
| `linear-sync.yml` | `pull_request` (opened / reopened / closed) | Runs `spex linear-sync` to update the linked Linear issue's workflow state. |

The full source for each lives in [`packages/integrations/github/templates/`](../packages/integrations/github/templates/) and is read at install time. The CLI just copies them into `.github/workflows/`.

---

## Common pattern

Every template uses the same install-source pattern at the top:

```yaml
env:
  SPEX_REPO: rogcg/spex
  SPEX_REF: main
```

Override `SPEX_REF` to pin a tag (e.g. `v1.0.0`) for reproducibility, or `SPEX_REPO` to point at a fork. The "Install + build SPEX" step runs:

```yaml
- name: Checkout SPEX source
  uses: actions/checkout@v4
  with:
    repository: ${{ env.SPEX_REPO }}
    ref: ${{ env.SPEX_REF }}
    path: .spex-source

- name: Setup pnpm
  uses: pnpm/action-setup@v4
  with:
    version: 9

- name: Setup Node
  uses: actions/setup-node@v4
  with:
    node-version: '20'
    cache: 'pnpm'
    cache-dependency-path: .spex-source/pnpm-lock.yaml

- name: Install + build SPEX
  working-directory: .spex-source
  run: |
    pnpm install --frozen-lockfile
    pnpm -r build
```

Once SPEX is published to npm, this whole block collapses to a single `npm install -g spex@<version>` step. The flag `SPEX_REPO` / `SPEX_REF` will go away with it.

The runner invokes SPEX via `node "$GITHUB_WORKSPACE/.spex-source/packages/cli/dist/index.js" <subcommand> …` so the binary doesn't need to be on `PATH`.

---

## `pr-review.yml`

```yaml
on:
  pull_request:
    types: [opened, reopened, ready_for_review]
```

**Permissions**

```yaml
permissions:
  contents: read
  pull-requests: write
```

**Required secrets**

| Secret | Required | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Used by SPEX to call Claude. |
| `GITHUB_TOKEN` | provided automatically | Used to fetch the PR diff and post the review comment. |

**Run step**

```yaml
- name: Run review
  run: |
    node "$GITHUB_WORKSPACE/.spex-source/packages/cli/dist/index.js" \
      review "${{ github.event.pull_request.html_url }}" --auto
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

The `--auto` flag skips the confirm-before-post prompt — there is no human at the keyboard inside CI.

**Customisation ideas (commented inline in the template)**

- Drop `reopened` from `types` if reopens are common in your workflow.
- Add `if: github.actor != 'dependabot[bot]'` to skip bot PRs.
- Change `SPEX_REF` from `main` to a pinned tag for stability.

---

## `implement-from-issue.yml`

```yaml
on:
  issues:
    types: [labeled]

jobs:
  implement:
    if: github.event.label.name == 'spex:implement'
```

**Permissions**

```yaml
permissions:
  contents: write       # push the feature branch
  pull-requests: write  # open the PR
  issues: write         # comment on the issue
```

**Required secrets**

| Secret | Required | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Used by SPEX to call Claude. |
| `GITHUB_TOKEN` | provided automatically | Used to push the branch and open the PR. |

**Required `.ai/config.yaml`**

```yaml
integrations:
  github:
    owner: <owner>
    repo:  <repo>
    auto_create_pr: true
```

Without `auto_create_pr: true`, SPEX commits locally inside the runner and stops — no branch push, no PR.

**Required repo setting — must be enabled**

Settings → Actions → General → **"Allow GitHub Actions to create and approve pull requests"** must be ENABLED. Without it the branch is pushed but PR creation fails with:

```
GitHub Actions is not permitted to create or approve pull requests.
```

The local commits are intact in that case; the PR can be opened manually from the GitHub UI.

**Required GitHub label**

Create a label named `spex:implement` once in your repo's Labels page. The workflow only fires when that exact label is applied.

**Hidden caveat — `.spex-source/` exclusion**

The `Checkout SPEX source` step writes into `.spex-source/` inside the target repo's working directory. SPEX's `spex implement` pre-flight runs `git status --porcelain` to confirm a clean working tree, and the untracked `.spex-source/` directory would trip that check. The template handles this with:

```yaml
- name: Hide SPEX source from target repo git status
  run: echo ".spex-source/" >> .git/info/exclude
```

`git/info/exclude` is the per-clone exclude file — it doesn't modify the user's `.gitignore`. This is unique to the install-from-source pattern; once SPEX ships on npm, the workaround can go away.

**Git identity**

```yaml
- name: Configure git identity
  run: |
    git config user.name "spex-bot"
    git config user.email "spex-bot@users.noreply.github.com"
```

The commits SPEX makes will be attributed to this identity. Adjust if you want a different bot persona.

**Run step**

```yaml
- name: Run implement
  run: |
    node "$GITHUB_WORKSPACE/.spex-source/packages/cli/dist/index.js" \
      implement "${{ github.event.issue.title }}" --auto
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

**Current limitation**

The workflow uses `${{ github.event.issue.title }}` only. Full title+body parsing arrives with `spex implement --from-issue=<id>` — that pathway exists in the CLI but isn't yet wired into this template by default. To use it, change the run step to `--from-issue=${{ github.event.issue.number }}` and add `LINEAR_API_KEY: ${{ secrets.LINEAR_API_KEY }}` to `env`.

`--auto` skips the per-step approval gates. Review the resulting PR before merging.

---

## `linear-sync.yml`

```yaml
on:
  pull_request:
    types: [opened, reopened, closed]
```

**Permissions**

```yaml
permissions:
  contents: read
  pull-requests: read
```

**Required secrets**

| Secret | Required | Notes |
|---|---|---|
| `LINEAR_API_KEY` | yes | Generate at https://linear.app/settings/api. |

**Required `.ai/config.yaml`**

```yaml
integrations:
  linear:
    team: <TEAM-KEY>            # e.g. SPX
    status_mapping:             # optional, defaults shown
      in_progress: "In Progress"
      in_review:   "In Review"
      done:        "Done"
      todo:        "Todo"
    comment_on_unmerged_close: true
```

**What it does**

| PR event | Linear issue transition |
|---|---|
| `opened` / `reopened` | → `In Review` |
| `closed` (merged) | → `Done` |
| `closed` (NOT merged) | → `Todo` (+ optional comment if `comment_on_unmerged_close: true`) |

**Linear-id resolution**

1. `Closes <ID>` reference in the PR body (auto-emitted by SPEX's PR template when the PR was generated via `spex implement --from-issue=<ID>`).
2. Linear id extracted from the PR head branch name (e.g. `feature/SPX-47-…`).
3. None → workflow skips silently.

**Run step**

```yaml
- name: Run linear-sync
  run: |
    node "$GITHUB_WORKSPACE/.spex-source/packages/cli/dist/index.js" \
      linear-sync --event-path "$GITHUB_EVENT_PATH"
  env:
    LINEAR_API_KEY: ${{ secrets.LINEAR_API_KEY }}
```

**Customisation ideas (commented inline in the template)**

- Add a job-level `if:` guard to limit the sync to SPEX-generated PRs (e.g. `if: contains(github.event.pull_request.labels.*.name, 'spex-generated')`).
- Pin `SPEX_REF` to a tag for stability.

---

## Installation

```bash
cd my-saas
spex github setup
```

Use `--force` to overwrite existing workflow files:

```bash
spex github setup --force
```

The command prints what was written / skipped and a summary block listing the required repo secrets:

```
Installing SPEX workflow templates into:
  /path/to/my-saas/.github/workflows
  ✓ wrote .github/workflows/pr-review.yml
  ✓ wrote .github/workflows/implement-from-issue.yml
  ✓ wrote .github/workflows/linear-sync.yml

Done. 3 written, 0 skipped.

Required repo secrets:
  - ANTHROPIC_API_KEY  (used by SPEX to call Claude)
  - GITHUB_TOKEN       (provided automatically by GitHub Actions)
```

---

## Related docs

- [`docs/cli-reference.md`](./cli-reference.md#spex-github-setup) — the `spex github setup` CLI surface.
- [`docs/configuration.md`](./configuration.md#integrationsgithub) — the `integrations.github.*` block consumed by `pr-review.yml` and `implement-from-issue.yml`.
- [`docs/configuration.md`](./configuration.md#integrationslinear) — the `integrations.linear.*` block consumed by `linear-sync.yml`.
- [`docs/audit-and-resume.md`](./audit-and-resume.md) — what gets written to `.ai/audit/` when these workflows run inside CI.
