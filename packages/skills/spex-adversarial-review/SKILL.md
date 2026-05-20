---
name: spex-adversarial-review
description: Red-team a spec, PR, or plan — find what's missing, what's wrong, and what will fail. Produces a ranked list of risks with concrete examples and proposed mitigations. No code is written.
---

# spex-adversarial-review

This skill plays the role of a hostile reviewer whose only job is to find what's wrong with a proposed direction *before* it ships. Use it to stress-test a spec, an implementation plan, an ADR, or a PR description — not to write code.

## When to use this skill

- A spec / plan / ADR is about to be approved and the user wants one last "what could break?" pass.
- The user notices the work has been going well *too easily* — a smell that something has been overlooked.
- A previous incident or near-miss came from a missed edge case, and the team wants to harden the next decision against the same pattern.
- For *constructive* review against project conventions and spec, use **`spex-review`** (PR review) instead — that one assumes the work is mostly good.
- For *generating* options, use **`spex-brainstorm`** first.

## How to use this skill — the four lenses

Read the target document carefully, then walk through the four lenses below. Surface at least 2-3 risks under each lens. Do not skip lenses even if you think they don't apply — the lenses you assume don't apply are where the worst risks usually hide.

### Lens 1 — Missing context

Look for what *isn't* in the document.

Ask:
- What is the user / customer experience the moment something goes wrong here? Is it covered?
- What happens on the rollback path? Is one specified?
- What are the *upstream* dependencies (other teams, external services, env vars, secrets)? Is each one named?
- What are the *downstream* consumers? Will any of them break?
- What is the testing story for the failure modes — not just the happy path?
- What does the on-call runbook for this look like? Does it exist?

Each missing thing → a risk. Concrete example: "No rollback plan if the migration partially applies — we'd be stuck in a half-migrated state."

### Lens 2 — Hidden assumptions

Find the load-bearing assumptions and challenge each one.

Ask:
- "This assumes <X> is true. Under what realistic conditions would <X> be false?"
- For every "always" or "never" — find a counter-example.
- For every performance claim — what's it based on? Measured or guessed?
- For every "the user will" — what fraction of users won't?
- For every default value — what's the worst case for users who hit the default?

Each broken assumption → a risk. Concrete example: "Plan assumes auth tokens are short-lived (<1h). Our enterprise customers configure 7-day tokens, which means our cleanup logic never fires for them."

### Lens 3 — Adversarial inputs

Imagine the most hostile environment you can.

Ask:
- What happens if the input is empty / null / max-size / contains nulls / contains the marker characters in our own protocol?
- What happens if a downstream service returns 500 / times out / returns malformed data / returns subtly wrong data?
- What happens if two requests race? Two writes to the same row? Two simultaneous migrations?
- What happens at exactly midnight UTC? On a leap day? Across a DST transition?
- What happens if a malicious user supplies the input deliberately to break us?
- What happens at the limits — 1 record, 10M records, 0-byte file, 10GB file?

Each broken case → a risk with a concrete reproduction.

### Lens 4 — Hidden coupling

Find dependencies the document doesn't acknowledge.

Ask:
- What other features rely on the data structure being changed?
- What dashboards / alerts / SLO calculations break if this lands?
- What downstream tools or scripts parse the format being changed?
- What documentation references the behaviour being changed and would now lie?
- What's the impact on `git blame` / debug-ability if the file gets reorganised?
- What does this break for engineers who are *on vacation* during the rollout and come back to find their workflows changed?

Each coupling → a risk with the affected surface listed.

## Phase — rank and propose mitigations

After the four lenses, collect all risks and rank them on two axes:

- **Likelihood** (low / medium / high)
- **Severity if it occurs** (cosmetic / degraded UX / data loss / security incident)

For each high-likelihood OR high-severity risk, propose at least one concrete mitigation:
- A test that would catch it
- A check that would block it from shipping
- A monitoring signal that would surface it early
- A specific section to add to the document

Don't sandbag — risks that are low/low can be acknowledged in one line and moved past.

## Expected output

A markdown document (suggested location: `.ai/scratch/adversarial-review-<topic>.md`):

```markdown
# Adversarial review: <document title>

Reviewed: <doc path / PR URL / spec id>
Date: <YYYY-MM-DD>

## Top 3 must-address risks
1. **<title>** (likelihood: <L>, severity: <S>) — <one-sentence statement>.
   - Mitigation: <concrete action>.
2. ...
3. ...

## Risks by lens

### Missing context
- <risk 1> (L/S) — mitigation: ...
- <risk 2> (L/S) — mitigation: ...

### Hidden assumptions
- <risk 1> (L/S) — mitigation: ...

### Adversarial inputs
- <risk 1> (L/S) — example reproduction: ... — mitigation: ...

### Hidden coupling
- <risk 1> (L/S) — affected surfaces: ... — mitigation: ...

## What I could not assess
<things the reviewer didn't have visibility into — e.g. "I don't know what tests already exist; recommend confirming the boundary cases listed above are covered.">

## Recommendation
- **Proceed as written:** yes | no | only after addressing risks 1-N
- **Highest leverage action:** <one specific change to the document>
```

## Notes

- The job is to find what's wrong, not to be nice. Be specific and direct. Vague critiques like "needs more thought" are useless.
- Anchor each risk in a concrete example or scenario. "Could break under load" → "Falls over at >50 concurrent writes because the in-memory cache is not per-process".
- If you cannot find risks under a lens, that's a finding in itself — say so. ("Adversarial inputs: I could not surface a credible failure mode given the input validation in section 3.")
- Don't propose to *write* the mitigation here — that's the next round's work. The deliverable is the *list*, ranked.
- A great adversarial review surfaces 1-2 risks the original author could not have spotted themselves. If your review just restates what's already acknowledged, run another lens — you're not done.
