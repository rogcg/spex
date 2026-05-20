---
name: spex-brainstorm
description: Run a structured brainstorm — divergent then convergent — to expand the option space before locking in a decision. Produces a ranked list of options with tradeoffs. No code is written.
---

# spex-brainstorm

This skill runs a deliberately structured brainstorm. Use it before committing to a direction when the option space is still wide open — e.g. early in project scoping, when picking between architectures, or when a user is stuck on "what should I build".

## When to use this skill

- The user is at the start of a project and unsure about scope, stack, or approach.
- The user is choosing between several options and wants help expanding the field, not narrowing it.
- The team is stuck — too few options, or all options feel weak.
- For a methodical decision *between* known options, use **`spex-architecture-decision`** instead — that one assumes the options are already on the table.
- For finding flaws in a chosen direction, use **`spex-adversarial-review`** instead.

## What this skill does

Follow these phases. Do not skip the divergent phase even when the user seems certain — premature convergence is the most common failure mode.

### Phase 1 — Frame the question (2-5 min)

Ask the user *one* clarifying question per turn until you understand:
- What is the underlying goal? (Not the proposed solution — the actual user / business outcome.)
- What constraints are real and non-negotiable? (Budget, deadline, team skills, regulatory.)
- What constraints are *assumed* but might be wrong?
- What does success look like in concrete terms?

Write a single-sentence problem statement and confirm with the user before continuing.

### Phase 2 — Diverge: generate at least 8 options (5-10 min)

Generate options aggressively. Bias towards quantity over quality.

Include at least:
- The obvious option(s)
- One "do nothing" or "buy instead of build" option
- One option that costs the user nothing
- One deliberately overengineered option
- One option that violates an assumed constraint

For each option, capture only:
- A name (3-7 words)
- One sentence of what it actually is

Do NOT evaluate yet. Resist the urge to filter.

### Phase 3 — Cluster (2-3 min)

Group the options into 2-4 clusters. Common axes:
- Build vs buy vs delegate
- Now vs later
- Centralised vs distributed
- Iterative vs one-shot

Show the clusters to the user and ask if any are missing.

### Phase 4 — Converge: evaluate and rank (5-10 min)

For each cluster, pick 1-2 representative options. For each, produce:
- **What it is** (one sentence)
- **Strongest argument for it** (one sentence)
- **Strongest argument against it** (one sentence)
- **Cost** (rough — hours/days/weeks; dollars if relevant)
- **Reversibility** (one-way vs two-way)

Rank the 3-5 finalists. Recommend a top choice with explicit rationale tied to the goal and constraints from Phase 1.

### Phase 5 — Recommend a next step (1-2 min)

Whatever the user agreed is the top option, propose the *smallest concrete next step* — a 1-day experiment, a draft spec, a single conversation. Brainstorms are wasted when they end without a next action.

## Expected output

A markdown brainstorm document (suggested location: `.ai/scratch/brainstorm-<topic>.md`) with these sections:

```markdown
# Brainstorm: <topic>

## Problem statement
<one sentence>

## Goal + constraints
- Goal: ...
- Hard constraints: ...
- Assumed constraints (verify): ...

## Options (divergent)
1. <Option name> — <one-sentence description>
2. ...
(at least 8)

## Clusters
- **<Cluster A>**: options 1, 3, 7
- **<Cluster B>**: options 2, 4
- ...

## Finalists (ranked)
### 1. <Top option>
- What: ...
- For: ...
- Against: ...
- Cost: ...
- Reversibility: one-way | two-way

### 2. ...

## Recommendation
<top option + one-paragraph rationale tied to goal + constraints>

## Next step
<smallest concrete action to validate the choice>
```

## Notes

- The single most valuable phase is Phase 2 (diverge). If you skip it or rush it, the brainstorm becomes a discussion about the user's first idea — which is the opposite of what they asked for.
- "One option that violates an assumed constraint" is the most counter-intuitive prompt but often produces the most useful insight: the user often discovers a constraint was self-imposed.
- Do NOT recommend writing code during a brainstorm. The deliverable is a *document*, not an implementation.
