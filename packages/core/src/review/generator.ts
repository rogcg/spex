import {
  type ReviewFinding,
  type ReviewRecommendation,
  type ReviewResult,
  ReviewResultSchema,
  type ReviewSection,
  ReviewSectionSchema,
} from '@spex/schemas';
import type { LLMProvider } from '../llm/provider.js';
import {
  REVIEW_SYSTEM_PROMPT_SECTION,
  REVIEW_SYSTEM_PROMPT_SINGLE,
  type ReviewPromptContext,
  type ReviewSectionId,
  buildReviewUserPrompt,
} from './prompts.js';

export interface GenerateReviewOptions {
  llm: LLMProvider;
  context: ReviewPromptContext;
  /** "single" issues one LLM call; "split" issues one call per concern. Default: "single". */
  mode?: 'single' | 'split';
}

export async function generateReview(options: GenerateReviewOptions): Promise<ReviewResult> {
  const mode = options.mode ?? 'single';
  if (mode === 'split') {
    return generateReviewSplit(options.llm, options.context);
  }
  return generateReviewSingle(options.llm, options.context);
}

async function generateReviewSingle(
  llm: LLMProvider,
  context: ReviewPromptContext,
): Promise<ReviewResult> {
  return llm.generateStructured({
    systemPrompt: REVIEW_SYSTEM_PROMPT_SINGLE,
    userPrompt: buildReviewUserPrompt(context),
    schema: ReviewResultSchema,
  });
}

async function generateReviewSplit(
  llm: LLMProvider,
  context: ReviewPromptContext,
): Promise<ReviewResult> {
  const userPrompt = buildReviewUserPrompt(context);
  const sectionIds: readonly ReviewSectionId[] = [
    'spec_compliance',
    'conventions',
    'performance_security',
    'test_coverage',
  ];

  const sections = await Promise.all(
    sectionIds.map(async (id) => {
      const section = await llm.generateStructured({
        systemPrompt: REVIEW_SYSTEM_PROMPT_SECTION(id),
        userPrompt,
        schema: ReviewSectionSchema,
      });
      return [id, section] as const;
    }),
  );

  const map = Object.fromEntries(sections) as Record<ReviewSectionId, ReviewSection>;
  const allFindings: ReviewFinding[] = sectionIds.flatMap((id) => map[id].findings);
  const recommendation = deriveRecommendation(allFindings);
  const overallSummary = buildOverallSummary(allFindings, recommendation);

  return ReviewResultSchema.parse({
    spec_compliance: map.spec_compliance,
    conventions: map.conventions,
    performance_security: map.performance_security,
    test_coverage: map.test_coverage,
    overall_summary: overallSummary,
    recommendation,
  });
}

/**
 * Deterministic recommendation derivation from finding severities. Used in
 * split mode so we don't need a 5th LLM call just to pick the recommendation.
 */
export function deriveRecommendation(findings: readonly ReviewFinding[]): ReviewRecommendation {
  let hasBlocker = false;
  let hasMajor = false;
  for (const finding of findings) {
    if (finding.severity === 'blocker') hasBlocker = true;
    if (finding.severity === 'major') hasMajor = true;
  }
  if (hasBlocker) return 'request_changes';
  if (hasMajor) return 'comment';
  return 'approve';
}

function buildOverallSummary(
  findings: readonly ReviewFinding[],
  recommendation: ReviewRecommendation,
): string {
  const counts = countSeverities(findings);
  const parts: string[] = [];
  parts.push(
    `Reviewed in split mode. ${findings.length} finding${findings.length === 1 ? '' : 's'} total: ${counts.blocker} blocker, ${counts.major} major, ${counts.minor} minor, ${counts.info} info.`,
  );
  if (recommendation === 'request_changes') {
    parts.push('Request changes — blockers must be addressed before merge.');
  } else if (recommendation === 'comment') {
    parts.push('Comment-only — no blockers, but major findings warrant attention.');
  } else {
    parts.push('Approve — no blockers or majors detected.');
  }
  return parts.join(' ');
}

function countSeverities(findings: readonly ReviewFinding[]): {
  info: number;
  minor: number;
  major: number;
  blocker: number;
} {
  const counts = { info: 0, minor: 0, major: 0, blocker: 0 };
  for (const finding of findings) {
    counts[finding.severity] += 1;
  }
  return counts;
}
