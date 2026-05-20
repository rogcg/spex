/**
 * Sensitive-data redaction for audit payloads.
 *
 * Defaults catch the common shapes: Anthropic, OpenAI, GitHub, Slack, generic
 * bearer tokens, and obvious "api_key"/"secret"/"password" key names. Callers
 * can extend with additional patterns.
 */
export interface RedactionOptions {
  /** Regex patterns applied to every string value. */
  valuePatterns?: readonly RegExp[];
  /** Substring matches applied to every object key (case-insensitive). */
  keyPatterns?: readonly string[];
}

const DEFAULT_VALUE_PATTERNS: readonly RegExp[] = [
  // Anthropic / OpenAI: sk-... and sk-ant-...
  /\bsk-(ant-)?[A-Za-z0-9_\-]{10,}\b/g,
  // GitHub PAT (classic + fine-grained)
  /\bgh[ps]_[A-Za-z0-9]{30,}\b/g,
  // Slack bot/user/app tokens
  /\bxox[abps]-[A-Za-z0-9\-]{10,}\b/g,
  // Linear / PostHog / generic bearer tokens
  /\bphx_[A-Za-z0-9]{10,}\b/g,
  /\blin_api_[A-Za-z0-9]{10,}\b/g,
  /\bBearer\s+[A-Za-z0-9._\-]{16,}\b/g,
];

const DEFAULT_KEY_PATTERNS: readonly string[] = [
  'api_key',
  'apikey',
  'api-key',
  'secret',
  'password',
  'token',
  'authorization',
  'auth_token',
  'access_token',
  'refresh_token',
  'signing_secret',
];

const REDACTED = '[REDACTED]';

export function redact<T = unknown>(value: T, opts: RedactionOptions = {}): T {
  const valuePatterns = opts.valuePatterns ?? DEFAULT_VALUE_PATTERNS;
  const keyPatterns = (opts.keyPatterns ?? DEFAULT_KEY_PATTERNS).map((p) => p.toLowerCase());
  return walk(value, keyPatterns, valuePatterns) as T;
}

function walk(node: unknown, keyPatterns: string[], valuePatterns: readonly RegExp[]): unknown {
  if (typeof node === 'string') {
    return redactString(node, valuePatterns);
  }
  if (Array.isArray(node)) {
    return node.map((item) => walk(item, keyPatterns, valuePatterns));
  }
  if (node !== null && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const matchKey = keyPatterns.some((p) => key.toLowerCase().includes(p));
      if (matchKey && typeof value === 'string') {
        out[key] = REDACTED;
      } else if (matchKey && value !== null && typeof value === 'object') {
        // Object under a sensitive key: redact wholesale.
        out[key] = REDACTED;
      } else {
        out[key] = walk(value, keyPatterns, valuePatterns);
      }
    }
    return out;
  }
  return node;
}

function redactString(s: string, patterns: readonly RegExp[]): string {
  let out = s;
  for (const p of patterns) {
    // Recreate regex with a fresh lastIndex; defensively clone to avoid sharing.
    const re = new RegExp(p.source, p.flags);
    out = out.replace(re, REDACTED);
  }
  return out;
}
