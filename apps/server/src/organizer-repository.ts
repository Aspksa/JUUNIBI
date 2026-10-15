import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

/**
 * Windows antivirus, OneDrive or an editor can hold a file briefly.
 * Retry only transient rename errors; all other failures stay fail-closed.
 */
async function renameRetry(from: string, to: string, tries = 6): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (i >= tries || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 40 * i));
    }
  }
}

/**
 * Durable JSON snapshot store for Organizer.
 *
 * Domain validation deliberately remains in Organizer. This class only guarantees:
 * - a syntactically valid snapshot is loaded;
 * - a valid .bak can recover a missing/corrupt main file;
 * - writes are serialized;
 * - the old valid main becomes .bak before replacement;
 * - the new main is installed with temp-file + rename.
 */
export class OrganizerRepository {
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {}

  async load<T extends object>(): Promise<T> {
    return JSON.parse(await this.readRecoverable()) as T;
  }

  save(snapshot: unknown): Promise<void> {
    // Serialize now, not later in the queue, so each save represents the exact state at call time.
    const data = JSON.stringify(snapshot);
    this.writes = this.writes.catch(() => {}).then(() => this.writeSnapshot(data));
    return this.writes;
  }

  flush(): Promise<void> {
    return this.writes;
  }

  private async readRecoverable(): Promise<string> {
    try {
      const value = await readFile(this.file, "utf8");
      JSON.parse(value);
      return value;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        // A missing main file may still have a valid snapshot after interrupted recovery.
        try {
          const backup = await readFile(this.file + ".bak", "utf8");
          JSON.parse(backup);
          return backup;
        } catch {
          throw error;
        }
      }

      if (!(error instanceof SyntaxError)) throw error;
      try {
        const backup = await readFile(this.file + ".bak", "utf8");
        JSON.parse(backup);
        return backup;
      } catch {
        // Preserve the original parse error: absent/corrupt backup is not a clean first launch.
        throw error;
      }
    }
  }

  private async writeSnapshot(data: string): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });

    const tmp = this.file + "." + randomUUID() + ".tmp";
    await writeFile(tmp, data, { mode: 0o600 });

    // Never replace a known-good backup with corrupt data.
    try {
      const previous = await readFile(this.file, "utf8");
      JSON.parse(previous);
      const backupTmp = this.file + "." + randomUUID() + ".bak.tmp";
      await writeFile(backupTmp, previous, { mode: 0o600 });
      await renameRetry(backupTmp, this.file + ".bak");
    } catch (error) {
      if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    await renameRetry(tmp, this.file);
  }
}
