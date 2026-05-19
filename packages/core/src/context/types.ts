import type { TechSpec } from '@spex/schemas';

export interface PackageJsonInfo {
  name: string | null;
  version: string | null;
  scripts: Readonly<Record<string, string>>;
  dependencies: Readonly<Record<string, string>>;
  devDependencies: Readonly<Record<string, string>>;
  peerDependencies: Readonly<Record<string, string>>;
}

export interface ContextFile {
  path: string;
  content: string;
  bytes: number;
  estimatedTokens: number;
}

export type FileNamingConvention = 'kebab-case' | 'camelCase' | 'PascalCase' | 'mixed' | 'unknown';

export type ComponentStructure = 'components-folder' | 'colocated' | 'unknown';

export type TestingPattern = 'colocated' | 'tests-folder' | '__tests__-folder' | 'none' | 'unknown';

export interface DetectedPatterns {
  fileNamingConvention: FileNamingConvention;
  componentStructure: ComponentStructure;
  testingPattern: TestingPattern;
}

export interface ContextBudgetReport {
  limitTokens: number;
  usedTokens: number;
  truncated: boolean;
  excludedFiles: number;
}

export interface CodebaseContext {
  projectDir: string;
  techSpec: TechSpec | null;
  packageInfo: PackageJsonInfo;
  relevantFiles: ContextFile[];
  detectedPatterns: DetectedPatterns;
  budget: ContextBudgetReport;
}
