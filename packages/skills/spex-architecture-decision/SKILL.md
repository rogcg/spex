---
name: spex-architecture-decision
description: Walk the user through an Architecture Decision Record — frame the context, lay out the alternatives, evaluate tradeoffs, and produce a written ADR with explicit rationale. No code is written.
---

# spex-architecture-decision

This skill produces an Architecture Decision Record (ADR) — a written, dated artifact that captures *why* a non-obvious decision was made, so that future maintainers (or future-you) can understand the reasoning when the context has faded.

## When to use this skill

- The user is choosing between known options for a structural decision (database, deployment topology, auth model, monorepo vs polyrepo, etc.).
- The decision will be hard to reverse and the rationale matters in 6+ months.
- A choice has *already been made informally* but the user wants it documented so the team can challenge it or the next maintainer can find it.
- For *generating* options when the field is wide open, use **`spex-brainstorm`** first, then come back here.
- For *attacking* an already-written ADR, use **`spex-adversarial-review`** on it.

## What this skill does

Follow the ADR pattern below. Keep the document short — ADRs that read like essays don't get read; ADRs that fit on one screen do.

### Phase 1 — Frame the context (3-5 min)

Ask the user:
- What forces are pushing this decision *now*? (A pain, a deadline, a new requirement.) If the answer is "nothing in particular", suggest deferring the ADR.
- What concrete constraints must any chosen option satisfy? Budget, runtime, team skills, compliance.
- Which adjacent decisions does this one couple to? (E.g. "if we pick Postgres, our deploy story changes.")
- Who are the stakeholders? Who will live with the consequences?

### Phase 2 — Enumerate alternatives (5 min)

Capture **at least three** options:
- Option A: the leading candidate
- Option B: at least one credible alternative
- Option C: status quo / do nothing

For each, one sentence of *what it actually is*. No evaluation yet.

If the user only has one option, push back: "What's the credible alternative?" — pursuing a decision without alternatives produces fragile ADRs.

### Phase 3 — Evaluate (10 min)

For each option, produce a short table:

| | Option A | Option B | Option C (status quo) |
|---|---|---|---|
| Effort to adopt | ... | ... | none |
| Operational cost / year | $X | $Y | $Z |
| Reversibility | one-way / two-way | ... | n/a |
| Team familiarity | high / medium / low | ... | ... |
| Risk if it goes wrong | ... | ... | ... |
| Aligned with project values? | yes / partial / no | ... | ... |

For each row, **cite a reason** when the answer is non-obvious. "Reversibility: one-way (data migration off Postgres requires a full backfill)" — not just "one-way".

### Phase 4 — Decide (5 min)

State the chosen option in one sentence. Then write 2-4 sentences of rationale that:
- Refer to specific cells in the evaluation table (not new arguments).
- Acknowledge the strongest argument *against* the choice — and why it does not outweigh the case for.
- Identify the conditions under which this decision should be revisited.

### Phase 5 — Capture consequences (3 min)

List 3-7 consequences. Mix positive and negative.

- Positive: "Frees the team from managing X infrastructure."
- Negative: "Locks us into vendor Y; switching later costs ~$Z + N person-weeks."
- Operational: "On-call playbook needs a new section on Z."

Consequences are the part future maintainers actually search for.

## Expected output

A markdown ADR (suggested location: `.ai/adr/<NNNN>-<slug>.md` where `NNNN` is a 4-digit zero-padded sequence):

```markdown
# ADR-<NNNN>: <decision-title>

- **Status:** Proposed | Accepted | Superseded by ADR-<NNNN>
- **Date:** <YYYY-MM-DD>
- **Deciders:** <stakeholders>

## Context

<2-4 sentences. The forces, the constraints, what triggered the decision.>

## Considered options

- **Option A:** <one sentence>
- **Option B:** <one sentence>
- **Option C (status quo):** <one sentence>

## Evaluation

<comparison table — see Phase 3>

## Decision

<chosen option + 2-4 sentences of rationale referring to the table>

### When to revisit this decision

<conditions under which the decision should be re-opened — e.g. "If our request volume exceeds 10x current, the operational cost calculus changes.">

## Consequences

- Positive: ...
- Negative: ...
- Operational: ...
```

## Notes

- ADRs are not RFCs. Keep them short. If the document is longer than two screens, the rationale is buried.
- Mark the ADR `Proposed` until the team has signed off. Then mark it `Accepted` with the date. Never edit an `Accepted` ADR's body — write a new one that supersedes it.
- The "When to revisit" section is the single most useful one in practice. Future maintainers come to ADRs to ask "is this still true?" — answer that question explicitly.
- Don't treat an ADR as a decision-making tool. Use **`spex-brainstorm`** to generate options, then come here to record the chosen one.
