import { z } from 'zod';

export const ReviewSeveritySchema = z.enum(['info', 'minor', 'major', 'blocker']);
export type ReviewSeverity = z.infer<typeof ReviewSeveritySchema>;

export const ReviewRecommendationSchema = z.enum(['approve', 'comment', 'request_changes']);
export type ReviewRecommendation = z.infer<typeof ReviewRecommendationSchema>;

export const ReviewFindingSchema = z.object({
  severity: ReviewSeveritySchema,
  message: z.string().min(5, 'finding message must be at least 5 characters'),
  file: z.string().optional(),
  lines: z.string().optional(),
});
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;

export const ReviewSectionSchema = z.object({
  findings: z.array(ReviewFindingSchema),
  summary: z.string().min(5, 'section summary must be at least 5 characters'),
});
export type ReviewSection = z.infer<typeof ReviewSectionSchema>;

export const ReviewResultSchema = z.object({
  spec_compliance: ReviewSectionSchema,
  conventions: ReviewSectionSchema,
  performance_security: ReviewSectionSchema,
  test_coverage: ReviewSectionSchema,
  overall_summary: z.string().min(10, 'overall summary must be at least 10 characters'),
  recommendation: ReviewRecommendationSchema,
});
export type ReviewResult = z.infer<typeof ReviewResultSchema>;
