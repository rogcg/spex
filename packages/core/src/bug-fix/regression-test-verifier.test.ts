import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { RegressionTest } from '@spex/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PathOutsideProjectError } from '../implementation/safety.js';
import {
  RegressionTestDidNotFailError,
  RegressionTestDidNotPassError,
  verifyRegressionTest,
} from './regression-test-verifier.js';

// To exercise the real fail-then-pass cycle we use a tiny "test runner": a
// Node one-liner that reads `src/x.txt` (relative to cwd, which execa sets to
// `projectDir`) and exits 1 when it contains "BUG", 0 otherwise. The
// regression test file itself is just a marker we write to disk so the
// verifier's path-snapshot/restore plumbing is also covered.
const STUB_RUNNER_SCRIPT =
  "const fs=require('node:fs');const c=fs.readFileSync('src/x.txt','utf8');process.exit(c.includes('BUG')?1:0)";

let projectDir: string;

const regressionTest: RegressionTest = {
  path: 'src/x.regression.test.ts',
  content: '// regression test marker — runner reads src/x.txt directly\n',
  framework: 'vitest',
  rationale: 'Pins the bug-marker assertion that x.txt should not contain BUG.',
};

async function writeIn(rel: string, content: string): Promise<void> {
  const path = join(projectDir, rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
}

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), 'spex-regtest-'));
});
afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe('verifyRegressionTest', () => {
  it('completes the fail-then-pass cycle and leaves the test file in place', async () => {
    await writeIn('src/x.txt', 'BUG present\n');

    const applyFix = vi.fn().mockImplementation(async () => {
      await writeIn('src/x.txt', 'fixed\n');
    });
    const revertFix = vi.fn();

    const result = await verifyRegressionTest({
      projectDir,
      regressionTest,
      applyFix,
      revertFix,
      testCommand: {
        bin: 'node',
        args: ['-e', STUB_RUNNER_SCRIPT],
        appendTestPath: false,
      },
    });

    expect(result.failedBeforeFix).toBe(true);
    expect(result.passedAfterFix).toBe(true);
    expect(result.beforeRun.exitCode).toBe(1);
    expect(result.afterRun.exitCode).toBe(0);
    expect(applyFix).toHaveBeenCalledTimes(1);
    expect(revertFix).not.toHaveBeenCalled();

    // Test file remained on disk (default behavior).
    const testOnDisk = await readFile(join(projectDir, regressionTest.path), 'utf8');
    expect(testOnDisk).toContain('regression test marker');
  });

  it('removes the test file on success when removeTestOnSuccess=true', async () => {
    await writeIn('src/x.txt', 'BUG present\n');
    const applyFix = async (): Promise<void> => {
      await writeIn('src/x.txt', 'fixed\n');
    };
    const revertFix = vi.fn();

    await verifyRegressionTest({
      projectDir,
      regressionTest,
      applyFix,
      revertFix,
      removeTestOnSuccess: true,
      testCommand: {
        bin: 'node',
        args: ['-e', STUB_RUNNER_SCRIPT],
        appendTestPath: false,
      },
    });

    let stillThere = true;
    try {
      await readFile(join(projectDir, regressionTest.path), 'utf8');
    } catch {
      stillThere = false;
    }
    expect(stillThere).toBe(false);
  });

  it('throws RegressionTestDidNotFailError when the test passes against the buggy code', async () => {
    // src/x.txt does not contain "BUG" → runner exits 0 immediately, so the
    // test is asserting on something the bug does not actually break.
    await writeIn('src/x.txt', 'no marker here\n');
    const applyFix = vi.fn();
    const revertFix = vi.fn();

    await expect(
      verifyRegressionTest({
        projectDir,
        regressionTest,
        applyFix,
        revertFix,
        testCommand: {
          bin: 'node',
          args: ['-e', STUB_RUNNER_SCRIPT],
          appendTestPath: false,
        },
      }),
    ).rejects.toBeInstanceOf(RegressionTestDidNotFailError);

    expect(applyFix).not.toHaveBeenCalled();
    expect(revertFix).not.toHaveBeenCalled();
    // The (useless) test file was removed because the snapshot showed no pre-existing file.
    let stillThere = true;
    try {
      await readFile(join(projectDir, regressionTest.path), 'utf8');
    } catch {
      stillThere = false;
    }
    expect(stillThere).toBe(false);
  });

  it('throws RegressionTestDidNotPassError and reverts the fix when post-fix run still fails', async () => {
    await writeIn('src/x.txt', 'BUG present\n');
    // applyFix is buggy — it doesn't actually remove the BUG marker.
    const applyFix = vi.fn().mockImplementation(async () => {
      await writeIn('src/x.txt', 'BUG still here, badly applied fix\n');
    });
    const revertFix = vi.fn().mockImplementation(async () => {
      await writeIn('src/x.txt', 'BUG present\n');
    });

    await expect(
      verifyRegressionTest({
        projectDir,
        regressionTest,
        applyFix,
        revertFix,
        testCommand: {
          bin: 'node',
          args: ['-e', STUB_RUNNER_SCRIPT],
          appendTestPath: false,
        },
      }),
    ).rejects.toBeInstanceOf(RegressionTestDidNotPassError);

    expect(applyFix).toHaveBeenCalledTimes(1);
    expect(revertFix).toHaveBeenCalledTimes(1);
  });

  it('refuses a regression test path that escapes the project root', async () => {
    await writeIn('src/x.txt', 'BUG present\n');
    const applyFix = vi.fn();
    const revertFix = vi.fn();

    await expect(
      verifyRegressionTest({
        projectDir,
        regressionTest: { ...regressionTest, path: '../escape.test.ts' },
        applyFix,
        revertFix,
        testCommand: { bin: 'true', args: [], appendTestPath: false },
      }),
    ).rejects.toBeInstanceOf(PathOutsideProjectError);
    expect(applyFix).not.toHaveBeenCalled();
  });
});
