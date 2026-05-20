---
title: Discovery & tech spec
layout: default
nav_order: 4
description: "The adaptive discovery flow, decision-gate engine, stack recommendation, and scaffold planner / verifier / self-correction."
---

# Discovery, decision gates, stack selection, scaffold

This page is the in-depth reference for the front half of `spex new` and `spex init` — everything between "I want a project called X" and the moment the scaffolder starts running commands.

If you just want the user-facing flow, the README's `spex new` section covers it. This page goes deeper: the architect agent, the gap classifier, the decision schema, the stack recommendation engine, and the scaffold planner / verifier / self-correction loop.

---

## Adaptive discovery (the architect agent)

SPEX ships a single discovery flow: an LLM-driven architect agent that interviews the user adaptively. There is no fixed question script — every question is generated based on the prior answers.

Four question types are supported:

| Type | UX |
|---|---|
| `input` | Free-form text. |
| `select` | Single-choice list. |
| `multi-select` | Multi-choice list. |
| `confirm` | Yes / No. |

The system prompt asks the model to use five canonical concept keys (`project_type`, `primary_users`, `expected_scale`, `auth_requirements`, `data_persistence`) for the well-known concepts so the downstream TechSpec generator can locate the answers. Beyond those, the architect is free to ask whatever it deems relevant — for example `realtime_features`, `integrations_needed`, `compliance_constraints`.

Implemented by `runAdaptiveDiscovery({ agent, confirmCriticalGap?, nav? })` from `@spex/core`. Returns `{ answers, gap, override? }` where:

- `answers: DiscoveryAnswers` — keyed by question id.
- `gap: GapAssessment` — classification of how complete the answers are.
- `override?: { acceptedAt }` — populated only when the user accepted a `critical_missing` interview.

Library entry point:

```ts
import {
  AnthropicProvider,
  createArchitectAgent,
  runAdaptiveDiscovery,
} from '@spex/core';

const llm = new AnthropicProvider();
const agent = createArchitectAgent({ llm });
const result = await runAdaptiveDiscovery({
  agent,
  nav: { scratchPath: '.ai/scratch/discovery.yaml' },
});
```

For `spex init`, the agent is seeded with an `INIT_DESCRIPTION_QUESTION` so the architect starts with a one-sentence project description before continuing into the standard concept keys.

### Gap detection

At the end of an interview the architect emits a `GapAssessment`:

| Classification | Meaning | Behaviour |
|---|---|---|
| `complete` | Every critical concept is filled. | Continue to spec generation. |
| `nice_to_have_missing` | Some optional details are missing; the answers are sufficient to proceed. | Continue with a logged note. |
| `critical_missing` | At least one critical concept is unanswered. | Prompt the user via the `confirmCriticalGap` hook. Accept → proceeds with `override.acceptedAt` set. Reject → throws `SpexError`. |

### Universal navigation commands

For `input` questions, commands are typed inline; for `select` they appear as choices after a separator; `multi-select` and `confirm` get a small pre-step menu.

| Command | Effect |
|---|---|
| `/why` | Show the rationale for the current question. |
| `/skip` | Skip the current question (excluded from final answers). |
| `/back` | Return to the previous question; can re-answer. |
| `/pause` | Save state to `.ai/scratch/discovery.yaml` and exit (throws `DiscoveryPausedError`). |
| `/?` (alias `/help`) | Show available commands. |

### State persistence

`saveDiscoveryState` / `loadDiscoveryState` round-trip the answer history + skipped ids via a `DiscoveryStateSchema` zod schema. Pause writes the state file and throws `DiscoveryPausedError` so the caller can exit cleanly.

---

## Stack recommendation

After discovery, `spex new` runs the stack recommendation engine.

`recommendStack({ llm, projectName, answers, explicitConstraints? })` returns a `StackRecommendations` set:

```ts
{
  recommendations: StackRecommendation[];   // primary + alternatives, ranked
  unmappedRequirements: string[];           // requirements no recommendation addressed
}
```

Each `StackRecommendation` carries:

- `label` — short human-readable name.
- `components` — per-component decisions (framework, db, ORM, styling, hosting, …) with rationale tied to specific requirements.
- `tradeoffs` — explicit downsides.
- `confidence` — `high` / `medium` / `low`.
- `requirementsCovered` / `requirementsUnaddressed`.

The engine reasons per-profile — there is **no hardcoded catalog**. Recommendations are generated fresh from each discovery profile and ranked.

### Entry modes

`runStackSelection` (CLI) handles four states:

| Input | Behaviour |
|---|---|
| No flags | Recommend → user picks (or jumps to brainstorm). |
| `--constraints "must use Postgres"` | Constraint forwarded to the engine and embedded in the rationale. |
| `--stack "Next.js + Supabase"` | Validated against the profile. Warnings surface but the choice is permitted with explicit user override (recorded in `stack.validation_warnings`). |
| `--brainstorm` | Bounded multi-round loop (default 5 rounds) where prior proposals + feedback feed the next recommendation. Aborts cleanly if it does not converge. |

The committed choice is captured as a `StackDecision`:

```ts
{
  label: string;
  source: 'recommended' | 'user' | 'brainstormed';
  components: StackComponent[];
  rationale: string;
  tradeoffs: string[];
  validationWarnings: string[];
}
```

`source` round-trips into the final tech-spec, so a reviewer can see how the stack was chosen.

---

## Decision gates (proposal phase)

Once the stack is decided, `spex new` does NOT emit a single monolithic tech-spec. Instead, the LLM breaks the tech-spec into **10–14 ordered decisions** via `generateProposalDecisions`. Each decision is an individually-approvable field with:

| Field | Type | Notes |
|---|---|---|
| `id` | string | Kebab-case (`^[a-z][a-z0-9-]*$`). |
| `order` | integer ≥ 1 | Position in the gate sequence. |
| `category` | string | Typically `project` / `context` / `stack` / `rationale`. |
| `question` | string | Plain English. |
| `proposal` | string | The AI's recommended value. |
| `rationale` | string | Why the AI chose this proposal. |
| `techSpecPath` | string | Where in the tech-spec this decision lands. |
| `confidence` | `high` \| `medium` \| `low` | Used by `--strict` to abort low-confidence runs. |
| `alternatives?` | `{ label, tradeoffs }[]` | Populated when the user runs `[e]xplore`. |
| `status` | `pending` → `presented` → `accepted` \| `rejected` \| `modified` | Lifecycle. |
| `resolvedValue?` | string | The final value after user action (when different from `proposal`). |
| `userNote?` | string | Optional comment captured for the audit trail. |

Coverage:

- **Project identity** (name, description, type).
- **Context fields** — re-affirmed verbatim from the discovery answers so the user sees them once in the proposal flow.
- **Per-component stack rationale** — one decision per component carrying the committed `StackDecision` as locked context.
- **Overall rationale** (≥ 50 chars).

The committed `StackDecision` itself is never re-questioned — it was settled in the recommendation phase.

### Actions

`runProposalApproval` drives each decision through one of these actions via a pluggable `DecisionPrompter`:

| Key | Action | Effect |
|---|---|---|
| `[a]` | Accept | `status = accepted`, `resolvedValue = proposal`. |
| `[r]` | Reject | AI rewrites the proposal using the user's feedback; `status = modified`. |
| `[d]` | Debate | AI defends or refines as free-form prose; `status` unchanged. |
| `[e]` | Explore | AI returns 2–3 concrete alternatives; the user can `[pick]` one (`status = modified`, `resolvedValue = alternative label`). |
| `[m]` | Modify | User enters the value directly; `status = modified`. |
| `[p]` | Pause | Serialise decisions + current index + paused-at timestamp to YAML; exit cleanly with `ProposalPausedError`. |

The engine itself is UI-free. The CLI ships the default inquirer-based prompter; tests stub it.

### Auto / strict mode

- `--auto` skips the gates and auto-accepts every proposal. The audit trail is still written, and a `WARNING` is logged at start so the operator never loses track.
- `--auto --strict` aborts on the first decision flagged `confidence: low` instead of accepting it.

### Pause / resume

The `[p]ause` action writes `<parentDir>/.<projectName>-spex-proposal.yaml`:

```yaml
version: 1
pausedAt: 2026-05-20T12:34:56Z
projectName: my-saas
currentIndex: 7
decisions:
  - id: stack-framework
    order: 1
    status: accepted
    resolvedValue: Next.js 15 (App Router)
    ...
  - id: ...
```

`spex new <name> --resume` reloads this file and continues at the same decision id. On a successful end-to-end run, the file is removed.

### Decision audit trail

Each decision is appended as one JSONL line to `.ai/audit/decisions-<ISO-timestamp>.jsonl` with:

- decision id, order, category, target tech-spec path, status, confidence
- AI's original proposal + rationale
- user-resolved value (when different)
- optional user note
- ISO timestamp

Append-only by design — easy to diff with `git diff` style tools across multiple runs.

Audit entries staged during the proposal phase (before the project directory exists) are flushed once `.ai/` is written. See [`docs/audit-and-resume.md`](./audit-and-resume.md#decision-audit-legacy-stream) for more.

---

## Tech-spec assembly

After the gates, `assembleTechSpec` builds the final `TechSpec` from the accepted/modified decisions. The schema:

- `TechSpec.stack` is `{ label, source, components: StackComponent[], tradeoffs, validation_warnings }`. No language/framework is hardcoded.
- `source` is `recommended` | `user` | `brainstormed`.
- `TechSpec.scaffolding_plan` does **not** exist on the tech-spec — scaffolding is described by a separate `ScaffoldPlan` produced just-in-time.

For `spex init`, `INIT_INFERRED_FIELDS` collapses to `stack.label` + `stack.components` — the field is no longer Next.js-specific.

---

## Scaffold planner / executor / verifier / self-correction

`planScaffold(decision)` turns the committed `StackDecision` into a reviewable `ScaffoldPlan`:

```ts
{
  stackLabel: string;
  steps: ScaffoldStep[];        // discriminated union: 'command' | 'file'
  postConditions: string[];     // empirical checks (see below)
}
```

A `command` step (`{ kind: 'command', cmd, args, rationale }`) is executed via execa. A `file` step (`{ kind: 'file', path, content, rationale }`) writes a path under the project directory.

### Path safety

The executor runs the first command in the parent directory, subsequent commands inside the project directory. File paths that escape the project root throw `UnsafeScaffoldPathError`. Stops at the first failing step and returns a failure record (does not throw on command-level failures so callers can drive self-correction).

### Verifier (`verifyScaffold`)

Each `postCondition` is a short string matched against a small catalog of empirical checks:

| Pattern | Check |
|---|---|
| `<path> exists` | File existence. |
| `package.json declares '<name>' dependency` | Reads package.json and checks `dependencies` / `devDependencies`. |
| `typecheck passes` | Runs `pnpm exec tsc --noEmit`. |
| `build passes` | Runs `pnpm run build`. |
| `install passes` | Runs `pnpm install`. |
| anything else | Treated as informational (does not fail). |

### Self-correction (`runScaffold`)

Drives `planScaffold → executeScaffoldPlan → verifyScaffold` in a bounded loop (default 3 attempts). Between failed attempts:

1. `repairScaffoldPlan(previousPlan, failureContext)` regenerates the plan. The repair prompt forbids verbatim re-runs of the failing step.
2. The project directory is cleaned between attempts so each retry starts from a clean state.

A structured event stream (`planning`, `attempt-start`, `attempt-failed`, `repairing`, `attempt-ok`, `aborting`) is emitted for the CLI to render progress. Throws `ScaffoldFailedError` on final failure; the CLI rolls back the project directory.

### `spex new` end-to-end

```
discovery
  → recommendStack
  → user selection (or brainstorm / explicit / constraints)
  → generateProposalDecisions
  → runProposalApproval         ← pause / resume / auto / strict
  → assembleTechSpec
  → planScaffold
  → runScaffold (execute + verify + self-correct, ≤ 3 attempts)
  → injectAiFolder              ← writes .ai/ tech-spec + audit
  → git init (if scaffold template didn't already)
```

A `ScaffoldFailedError` removes the project directory rather than leaving a half-scaffolded tree.

---

## `spex_new` MCP tool

The MCP tool is non-interactive. It accepts every discovery answer up front plus an optional `stack` argument:

| Input | Required | Default |
|---|---|---|
| `name` | yes | — |
| `project_type` | yes | — |
| `primary_users` | no | `"Internal team"` |
| `expected_scale` | no | `"Less than 100 users"` |
| `auth_requirements` | no | `"None"` |
| `data_persistence` | no | `"Simple key-value"` |
| `stack` | no | top-ranked recommendation |
| `parent_dir` | no | server `cwd` |

When `stack` is omitted, the recommender's top-ranked recommendation is selected automatically. The chosen decision's source (`recommended` vs `user`) round-trips into the tech-spec.

---

## Related schemas

| Schema | Module |
|---|---|
| `DecisionSchema`, `DecisionListSchema`, `ProposalStateSchema` | [`packages/schemas/src/decision.ts`](../packages/schemas/src/decision.ts) |
| `StackRecommendationSchema`, `StackDecisionSchema`, `StackComponentSchema` | [`packages/schemas/src/stack-recommendation.ts`](../packages/schemas/src/stack-recommendation.ts) |
| `ScaffoldPlanSchema`, `ScaffoldCommandStepSchema`, `ScaffoldFileStepSchema` | [`packages/schemas/src/scaffold-plan.ts`](../packages/schemas/src/scaffold-plan.ts) |
| `TechSpecSchema`, `TechSpecStackSchema` | [`packages/schemas/src/tech-spec.ts`](../packages/schemas/src/tech-spec.ts) |

## Related docs

- [`docs/cli-reference.md`](./cli-reference.md#spex-new-name) — the `spex new` CLI surface.
- [`docs/audit-and-resume.md`](./audit-and-resume.md) — scratch state for paused proposals, audit log for every decision.
- [`docs/skills.md`](./skills.md) — the `spex-discovery` and `spex-new` skills route agents into these flows.
