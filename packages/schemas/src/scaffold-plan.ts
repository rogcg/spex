import { z } from 'zod';

export const ScaffoldCommandStepSchema = z.object({
  kind: z.literal('command'),
  cmd: z.string().min(1),
  args: z.array(z.string()),
  rationale: z.string().min(1),
});
export type ScaffoldCommandStep = z.infer<typeof ScaffoldCommandStepSchema>;

export const ScaffoldFileStepSchema = z.object({
  kind: z.literal('file'),
  path: z.string().min(1),
  content: z.string(),
  rationale: z.string().min(1),
});
export type ScaffoldFileStep = z.infer<typeof ScaffoldFileStepSchema>;

export const ScaffoldStepSchema = z.discriminatedUnion('kind', [
  ScaffoldCommandStepSchema,
  ScaffoldFileStepSchema,
]);
export type ScaffoldStep = z.infer<typeof ScaffoldStepSchema>;

export const ScaffoldPlanSchema = z.object({
  stackLabel: z.string().min(1),
  steps: z.array(ScaffoldStepSchema).min(1),
  postConditions: z.array(z.string().min(1)).min(1),
});
export type ScaffoldPlan = z.infer<typeof ScaffoldPlanSchema>;
