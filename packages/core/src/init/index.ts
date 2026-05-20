export {
  detectStack,
  ProjectInspectionError,
  UnsupportedStackError,
  type DetectedStack,
  type DetectionSignals,
} from './detect-stack.js';
export { INIT_DESCRIPTION_QUESTION } from './questions.js';
export {
  INIT_TECH_SPEC_SYSTEM_PROMPT,
  INIT_INFERRED_FIELDS,
  buildInitTechSpecUserPrompt,
} from './prompts.js';
export { generateInitTechSpec, type GenerateInitTechSpecOptions } from './generator.js';
export {
  assertAiFolderAbsent,
  AiFolderExistsError,
  type AssertAiFolderAbsentOptions,
} from './precheck.js';
