import type { FeatureSpec } from '@spex/schemas';

const STRIPPED_TOP_LEVELS = new Set(['src', 'packages', 'app']);

/**
 * Infer a Conventional-Commit scope from the feature spec's first affected
 * file. Prefers the directory that contains it, skipping the generic
 * top-level "src" / "packages" / "app" wrappers. Falls back to the feature
 * slug when nothing more specific can be derived.
 */
export function inferCommitScope(spec: FeatureSpec): string {
  const first = spec.files_affected[0]?.path;
  if (first) {
    const parts = first.split('/').filter((p) => p.length > 0 && p !== '.');
    // Drop generic wrapper directories
    while (parts.length > 1 && STRIPPED_TOP_LEVELS.has(parts[0] ?? '')) {
      parts.shift();
    }
    // The scope is the directory that contains the file, or the file stem when at root.
    if (parts.length >= 2) {
      const scope = parts[parts.length - 2];
      if (scope) {
        return scope;
      }
    }
    if (parts.length === 1) {
      const only = parts[0];
      if (only) {
        return stripExtension(only);
      }
    }
  }
  return spec.feature.slug;
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

export function buildFeatureCommitMessage(spec: FeatureSpec): string {
  const scope = inferCommitScope(spec);
  const body = spec.feature.description.trim();
  const ref = `Feature spec: .ai/specs/${spec.feature.slug}.yaml`;
  return `feat(${scope}): ${spec.feature.title}\n\n${body}\n\n${ref}`;
}

export function buildTestsCommitMessage(spec: FeatureSpec): string {
  const scope = inferCommitScope(spec);
  const ref = `Feature spec: .ai/specs/${spec.feature.slug}.yaml`;
  return `test(${scope}): add tests for ${spec.feature.slug}\n\n${ref}`;
}
