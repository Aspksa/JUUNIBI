import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { StorageAdapter } from "@juunibi/assistant";

/** Preserve the previous valid snapshot and refuse to overwrite damaged data. */
export function durableMemoryStore(file: string): StorageAdapter {
  const backup = file + ".bak";
  const read = async (name: string): Promise<string | null> => {
    try { return await readFile(name, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  };
  const valid = (raw: string): boolean => {
    try { return Array.isArray(JSON.parse(raw)); } catch { return false; }
  };
  const atomicWrite = async (destination: string, raw: string) => {
    const tmp = destination + "." + randomUUID() + ".tmp";
    await writeFile(tmp, raw, { mode: 0o600 });
    await rename(tmp, destination);
  };
  return {
    async load() {
      const primary = await read(file);
      if (primary !== null && valid(primary)) return primary;
      const secondary = await read(backup);
      if (secondary !== null && valid(secondary)) {
        await mkdir(path.dirname(file), { recursive: true });
        await atomicWrite(file, secondary);
        return secondary;
      }
      if (primary === null && secondary === null) return null;
      throw new Error("Память повреждена: основной файл и резервная копия недоступны. Сохраните их для восстановления.");
    },
    async save(data) {
      if (!valid(data)) throw new Error("Запрещено сохранять некорректную память");
      await mkdir(path.dirname(file), { recursive: true });
      const previous = await read(file);
      if (previous !== null && !valid(previous)) throw new Error("Память повреждена: запись остановлена для предотвращения потери данных");
      if (previous !== null) await atomicWrite(backup, previous);
      await atomicWrite(file, data);
      if (previous === null && await read(backup) === null) await atomicWrite(backup, data);
    },
  };
}
