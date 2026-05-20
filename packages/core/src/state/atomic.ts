import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Write `content` to `path` atomically: write to `path.tmp`, then rename.
 * On POSIX + Windows, `rename` is atomic on the same filesystem, so readers
 * always see either the previous file or the fully-written new one — never
 * a partial write.
 */
export async function atomicWriteFile(path: string, content: string): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(tmp, content, 'utf8');
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {
      // ignore best-effort cleanup
    });
    throw error;
  }
}
