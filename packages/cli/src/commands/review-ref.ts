import { SpexError } from '@spex/core';

export class InvalidPrRefError extends SpexError {
  constructor(ref: string) {
    super(
      `Invalid PR reference "${ref}". Use a number (e.g. 42) or a full URL (https://github.com/owner/repo/pull/42).`,
    );
  }
}

export interface ParsedPrRef {
  number: number;
  /** Set when the ref was a URL; otherwise null (caller falls back to config). */
  owner: string | null;
  /** Set when the ref was a URL; otherwise null (caller falls back to config). */
  repo: string | null;
}

const PR_NUMBER_RE = /^\d+$/;
const PR_URL_RE = /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/.*)?$/;

export function parsePrRef(ref: string): ParsedPrRef {
  const trimmed = ref.trim();
  if (trimmed.length === 0) {
    throw new InvalidPrRefError(ref);
  }
  if (PR_NUMBER_RE.test(trimmed)) {
    const n = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(n) || n <= 0) throw new InvalidPrRefError(ref);
    return { number: n, owner: null, repo: null };
  }
  const match = trimmed.match(PR_URL_RE);
  if (!match) throw new InvalidPrRefError(ref);
  const [, , owner, repo, numberStr] = match;
  if (!owner || !repo || !numberStr) throw new InvalidPrRefError(ref);
  const n = Number.parseInt(numberStr, 10);
  if (!Number.isFinite(n) || n <= 0) throw new InvalidPrRefError(ref);
  return { number: n, owner, repo };
}

const FEATURE_BRANCH_RE = /^feature\/([a-z0-9][a-z0-9-]*)$/;

/**
 * Infer the feature spec path from a branch name. Returns `null` when the
 * branch does not follow the `feature/<slug>` convention.
 *
 * Path matches `writeFeatureSpec` from @spex/core: `.ai/specs/<slug>.yaml`.
 */
export function featureSpecPathFromBranch(branch: string): string | null {
  const match = branch.match(FEATURE_BRANCH_RE);
  if (!match) return null;
  return `.ai/specs/${match[1]}.yaml`;
}
