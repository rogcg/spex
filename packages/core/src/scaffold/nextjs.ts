import { type RunCommandOptions, runCommand } from './executor.js';

export interface ScaffoldNextJsAppOptions {
  projectName: string;
  parentDir: string;
  /**
   * stdio mode for the `create-next-app` child process. Defaults to
   * `'inherit'` for CLI use. Callers running inside the MCP stdio transport
   * MUST pass `'pipe'` or `'ignore'` — `inherit` would relay child stdout
   * into our protocol stream.
   */
  stdio?: RunCommandOptions['stdio'];
}

export async function scaffoldNextJsApp(options: ScaffoldNextJsAppOptions): Promise<void> {
  await runCommand(
    'pnpm',
    [
      'create',
      'next-app@latest',
      options.projectName,
      '--typescript',
      '--tailwind',
      '--app',
      '--src-dir',
      '--import-alias',
      '@/*',
      '--use-pnpm',
    ],
    {
      cwd: options.parentDir,
      ...(options.stdio !== undefined ? { stdio: options.stdio } : {}),
    },
  );
}
