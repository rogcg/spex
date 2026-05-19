import type { FixOption, FixProposal, Hypothesis, RootCauseAnalysis } from '@spex/schemas';

const STRIPPED_TOP_LEVELS = new Set(['src', 'packages', 'app']);
const SLUG_CHAR = /[^a-z0-9]+/g;

/**
 * Derive a Conventional-Commit-style scope from the fix's primary affected
 * file. Mirrors the feature-spec scope inference but tuned for the fix flow:
 * looks at the FIRST file referenced by the recommended option's diff.
 */
export function inferFixCommitScope(opts: {
  rootCause: RootCauseAnalysis;
  recommendedOption: FixOption;
}): string {
  const firstFromEvidence = opts.rootCause.evidence[0]?.file;
  const firstFromDiff = extractFirstPath(opts.recommendedOption.diff);
  const primaryPath = firstFromDiff ?? firstFromEvidence;
  if (!primaryPath) return 'core';

  const parts = primaryPath.split('/').filter((p) => p.length > 0 && p !== '.');
  while (parts.length > 1 && STRIPPED_TOP_LEVELS.has(parts[0] ?? '')) {
    parts.shift();
  }
  if (parts.length >= 2) return parts[parts.length - 2] ?? 'core';
  if (parts.length === 1) {
    const only = parts[0];
    if (only) return stripExtension(only);
  }
  return 'core';
}

/**
 * Build the commit message for a `spex fix` commit. Format:
 *
 *     fix(<scope>): <recommended option label>
 *
 *     Root cause: <rootCause>
 *
 *     Investigated hypothesis: <hypothesis id> — <hypothesis description>
 *     Chosen option: <label> (scope=<scope>, risk=<risk>)
 *     Rationale: <recommendationRationale>
 */
export function buildFixCommitMessage(opts: {
  hypothesis: Hypothesis;
  rootCause: RootCauseAnalysis;
  fixProposal: FixProposal;
}): string {
  const recommended = opts.fixProposal.options.find((o) => o.id === opts.fixProposal.recommended);
  if (!recommended) {
    // Defensive: schema guarantees this matches, but bail safely.
    throw new Error('buildFixCommitMessage: fixProposal.recommended does not match any option id');
  }
  const scope = inferFixCommitScope({ rootCause: opts.rootCause, recommendedOption: recommended });
  const subject = `fix(${scope}): ${recommended.label}`;
  const body = [
    `Root cause: ${oneLine(opts.rootCause.rootCause)}`,
    '',
    `Investigated hypothesis: ${opts.hypothesis.id} — ${oneLine(opts.hypothesis.description)}`,
    `Chosen option: ${recommended.label} (scope=${recommended.scope}, risk=${recommended.risk})`,
    `Rationale: ${oneLine(opts.fixProposal.recommendationRationale)}`,
  ].join('\n');
  return `${subject}\n\n${body}`;
}

/**
 * Build a branch slug for a fix from the recommended option label. Used by
 * the CLI's `fix/<slug>` branch convention.
 */
export function buildFixBranchSlug(opts: {
  rootCause: RootCauseAnalysis;
  recommendedOption: FixOption;
}): string {
  const base = opts.recommendedOption.label.toLowerCase();
  const slug = base.replace(SLUG_CHAR, '-').replace(/^-+|-+$/g, '');
  if (slug.length > 0) return slug;
  // Fall back to a hash of the root cause if the label degenerates to empty.
  return `fix-${oneLine(opts.rootCause.rootCause)
    .toLowerCase()
    .replace(SLUG_CHAR, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)}`;
}

function extractFirstPath(diff: string): string | undefined {
  // Look for the first `+++ b/<path>` line; fall back to `--- a/<path>`.
  const lines = diff.split('\n');
  for (const line of lines) {
    if (line.startsWith('+++ ')) {
      const path = stripDiffPrefix(line.slice(4).trim());
      if (path && path !== '/dev/null') return path;
    }
  }
  for (const line of lines) {
    if (line.startsWith('--- ')) {
      const path = stripDiffPrefix(line.slice(4).trim());
      if (path && path !== '/dev/null') return path;
    }
  }
  return undefined;
}

function stripDiffPrefix(name: string): string {
  if (name.startsWith('a/') || name.startsWith('b/')) return name.slice(2);
  return name;
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
