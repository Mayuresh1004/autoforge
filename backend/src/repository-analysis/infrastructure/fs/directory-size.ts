import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Recursively computes the total size (in bytes) of a directory tree.
 *
 * Symlinks are skipped to avoid escaping the workspace or double counting.
 * Unreadable entries are skipped defensively so a single broken file does
 * not abort an analysis.
 */
export async function getDirectorySizeBytes(dir: string): Promise<number> {
  let total = 0;

  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;

      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      try {
        const stat = await fs.stat(fullPath);
        total += stat.size;
      } catch {
        // Skip unreadable files.
      }
    }
  }

  await walk(dir);
  return total;
}