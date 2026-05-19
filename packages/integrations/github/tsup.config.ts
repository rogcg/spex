import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  async onSuccess() {
    // Copy the workflow templates to `dist/templates/` so consumers can read
    // them at runtime via `getWorkflowTemplate()`.
    const src = resolve(here, 'templates');
    const dst = resolve(here, 'dist', 'templates');
    await mkdir(dst, { recursive: true });
    await cp(src, dst, { recursive: true });
  },
});
