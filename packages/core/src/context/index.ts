export type {
  CodebaseContext,
  ContextBudgetReport,
  ContextFile,
  ComponentStructure,
  DetectedPatterns,
  FileNamingConvention,
  PackageJsonInfo,
  TestingPattern,
} from './types.js';
export { buildCodebaseContext, type BuildCodebaseContextOptions } from './aggregator.js';
export {
  readProjectFiles,
  type ReadProjectFilesOptions,
  type ReadProjectFilesResult,
} from './file-reader.js';
export { detectPatterns } from './pattern-detector.js';
export { loadTechSpec, InvalidTechSpecError } from './tech-spec-loader.js';
export {
  loadPackageInfo,
  PackageJsonMissingError,
  PackageJsonInvalidError,
} from './package-loader.js';
export { estimateTokens, DEFAULT_BUDGET_TOKENS } from './token-budget.js';
