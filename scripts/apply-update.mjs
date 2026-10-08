import { existsSync } from "node:fs";
import { readFile, mkdir, copyFile, writeFile, rm, lstat } from "node:fs/promises";
import path from "node:path";

function safe(p) {
  return !!p && !p.startsWith("/") && !p.includes("\\") && p.split("/").every(s => !!s && s !== "." && s !== ".." && ![".git", ".updates", ".env", "data", ".runtime", "node_modules"].includes(s));
}

/** Called before loading the application. Pending updates were built and tested in staging. */
export async function applyPreparedUpdate(root) {
  const folder = path.join(root, ".updates");
  const manifestFile = path.join(folder, "ready.json");
  if (!existsSync(manifestFile)) return false;
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  if (!/^[0-9a-f]{40}$/.test(manifest.sha) || !Array.isArray(manifest.files) || !manifest.files.every(safe)) throw new Error("Повреждён манифест обновления");
  const staging = path.join(folder, "staging");
  const backup = path.join(folder, "backups", new Date().toISOString().replace(/[:.]/g, "-"));
  const changed = [];
  console.log("Установка проверенного обновления JUUNIBI. Резервная копия: " + backup);
  try {
    for (const name of manifest.files) {
      const src = path.join(staging, name);
      const dst = path.join(root, name);
      const source = await lstat(src);
      if (!source.isFile() || source.isSymbolicLink()) throw new Error("Некорректный файл в пакете: " + name);
      let existed = false;
      try {
        const old = await lstat(dst);
        if (!old.isFile() || old.isSymbolicLink()) throw new Error("Нельзя заменять специальный файл: " + name);
        existed = true;
        const saved = path.join(backup, name);
        await mkdir(path.dirname(saved), { recursive: true });
        await copyFile(dst, saved);
      } catch (e) {
        if (e?.code !== "ENOENT") throw e;
      }
      changed.push({ name, existed });
      await mkdir(path.dirname(dst), { recursive: true });
      await copyFile(src, dst);
    }
    await writeFile(path.join(root, ".juunibi-version"), manifest.sha + "\n");
    await rm(manifestFile);
    console.log("Обновление установлено. Версия: " + manifest.sha.slice(0, 8));
    return true;
  } catch (e) {
    console.error("Ошибка обновления, восстановление предыдущих файлов…", e);
    for (const { name, existed } of changed.reverse()) {
      const dst = path.join(root, name);
      if (existed) await copyFile(path.join(backup, name), dst);
      else await rm(dst, { force: true });
    }
    throw e;
  }
}
