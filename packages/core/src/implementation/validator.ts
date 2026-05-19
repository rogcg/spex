import type { FeatureSpec, ImplementationPlan } from '@spex/schemas';
import { SpexError } from '../errors.js';

export class InvalidPlanError extends SpexError {
  readonly violations: readonly string[];

  constructor(violations: readonly string[]) {
    super(`Implementation plan failed integrity checks:\n- ${violations.join('\n- ')}`);
    this.violations = violations;
  }
}

export interface ValidatePlanOptions {
  featureSpec?: FeatureSpec;
}

export function validatePlanIntegrity(
  plan: ImplementationPlan,
  options: ValidatePlanOptions = {},
): void {
  const violations: string[] = [];

  // Order numbers must form the sequence 1..N exactly (no gaps, no duplicates).
  const orders = plan.operations.map((op) => op.order);
  const expected = Array.from({ length: orders.length }, (_, i) => i + 1);
  const sortedOrders = [...orders].sort((a, b) => a - b);
  if (sortedOrders.join(',') !== expected.join(',')) {
    violations.push(
      `operation order numbers must be the contiguous sequence 1..${orders.length}, got [${sortedOrders.join(', ')}]`,
    );
  }

  // No duplicate (path, operation) pairs.
  const pairs = new Set<string>();
  for (const op of plan.operations) {
    const key = `${op.operation}:${op.path}`;
    if (pairs.has(key)) {
      violations.push(`duplicate operation: ${op.operation} ${op.path}`);
    }
    pairs.add(key);
  }

  // No duplicate paths within tests_to_add.
  const testPaths = new Set<string>();
  for (const test of plan.tests_to_add) {
    if (testPaths.has(test.path)) {
      violations.push(`duplicate test file in tests_to_add: ${test.path}`);
    }
    testPaths.add(test.path);
  }

  // Tests must not collide with source-op paths. The executor creates test
  // files via plan.tests_to_add after plan.operations, so a path that's
  // already written by a source op would fail with "file already exists".
  // This catches the LLM hallucination of listing the same file twice
  // (e.g. once in operations with create, once in tests_to_add).
  const sourcePaths = new Set(plan.operations.map((op) => op.path));
  for (const test of plan.tests_to_add) {
    if (sourcePaths.has(test.path)) {
      violations.push(
        `path collision: ${test.path} appears in both plan.operations and plan.tests_to_add`,
      );
    }
  }

  // Optional cross-check against an approved feature spec.
  if (options.featureSpec) {
    if (plan.feature_slug !== options.featureSpec.feature.slug) {
      violations.push(
        `plan.feature_slug "${plan.feature_slug}" does not match feature spec slug "${options.featureSpec.feature.slug}"`,
      );
    }
  }

  if (violations.length > 0) {
    throw new InvalidPlanError(violations);
  }
}
