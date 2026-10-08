import { existsSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, copyFile, writeFile, rm, lstat, rename, appendFile, readdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const BLOCKED = new Set([".git", ".updates", ".env", "data", ".runtime", "node_modules", ".juunibi-version"]);
const SHA = /^[0-9a-f]{40}$/;
export function safeUpdatePath(p) {
  return typeof p === "string" && p.length > 0 && p.length < 1024 &&
    !p.startsWith("/") && !p.includes("\\") && !p.includes(":") &&
    p.split("/").every(s => s && s !== "." && s !== ".." && !BLOCKED.has(s) &&
      !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(s) && !/[. ]$/.test(s));
}
function gitHash(bytes) {
  return createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
}
async function assertNoLinks(root, rel, leafAllowed = true) {
  let current = root;
  const parts = rel.split("/");
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    try {
      const st = await lstat(current);
      if (st.isSymbolicLink() || (i < parts.length - 1 && !st.isDirectory()) ||
        (i === parts.length - 1 && leafAllowed && !st.isFile()))
        throw new Error("Небезопасный путь обновления: " + rel);
    } catch (e) { if (e?.code !== "ENOENT") throw e; }
  }
}
async function atomicWrite(file, bytes) {
  const tmp = file + ".update-" + randomUUID();
  try { await writeFile(tmp, bytes, { flag: "wx" }); await rename(tmp, file); }
  finally { await rm(tmp, { force: true }).catch(() => {}); }
}
/** Post-install smoke test: every installed file matches its manifest hash, JS entry points parse, package.json is valid. */
export async function defaultHealthCheck(root, files) {
  for (const f of files) {
    const bytes = await readFile(path.join(root, f.path));
    if (gitHash(bytes) !== f.sha) throw new Error("Файл после установки не совпадает с манифестом: " + f.path);
    if (f.path === "package.json") JSON.parse(bytes.toString("utf8"));
    if (/^scripts\/[^/]+\.mjs$/.test(f.path)) {
      const r = spawnSync(process.execPath, ["--check", path.join(root, f.path)], { encoding: "utf8" });
      if (r.status !== 0) throw new Error("Синтаксическая ошибка после установки: " + f.path + " " + String(r.stderr).slice(0, 300));
    }
  }
}
/** Staged, hash-verified installer. No arbitrary deletions; user data remains untouched. */
export async function applyPreparedUpdate(root, { healthCheck = defaultHealthCheck } = {}) {
  const folder = path.join(root, ".updates");
  const manifestFile = path.join(folder, "ready.json");
  if (!existsSync(manifestFile)) return false;
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  if (!manifest || !SHA.test(manifest.sha) || !Array.isArray(manifest.files) ||
    manifest.files.length > 2500 ||
    !manifest.files.every(f => f && safeUpdatePath(f.path) && SHA.test(f.sha)) ||
    new Set(manifest.files.map(f => f.path.toLowerCase())).size !== manifest.files.length ||
    (manifest.removals !== undefined && (!Array.isArray(manifest.removals) || manifest.removals.length > 2500 ||
      !manifest.removals.every(p => safeUpdatePath(p) && !manifest.files.some(f => f.path.toLowerCase() === p.toLowerCase())))))
    throw new Error("Повреждён или небезопасен манифест обновления");
  // Removals are applied ONLY for files the user explicitly confirmed for THIS exact update.
  let removals = [];
  if (manifest.removals?.length) {
    const confirmed = await readFile(path.join(folder, "removals-confirmed.json"), "utf8").then(JSON.parse, () => null);
    if (confirmed?.sha === manifest.sha && Array.isArray(confirmed.paths)) {
      const ok = new Set(confirmed.paths);
      removals = manifest.removals.filter(p => ok.has(p));
    }
  }
  const staging = path.join(folder, "staging");
  const backup = path.join(folder, "backups", new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID().slice(0, 8));
  const operationId = "install-" + randomUUID();
  const event = async (type, relative_path = "", status = "", extra = {}) => {
    await appendFile(path.join(folder, "events.jsonl"), JSON.stringify({
      event_id: randomUUID(), type, timestamp: new Date().toISOString(), operation_id: operationId,
      relative_path, status, ...extra,
    }) + "\n");
  };
  const changes = [];
  const installedFile = path.join(folder, "installed.json");
  const oldInstalled = await readFile(installedFile).catch(() => null);
  const oldVersion = await readFile(path.join(root, ".juunibi-version")).catch(e => e?.code === "ENOENT" ? null : Promise.reject(e));
  try {
    // Verify the ENTIRE package before modifying any installed file.
    const prepared = [];
    for (const file of manifest.files) {
      await assertNoLinks(root, file.path);
      await assertNoLinks(staging, file.path);
      const src = path.join(staging, file.path);
      const srcStat = await lstat(src);
      if (!srcStat.isFile() || srcStat.isSymbolicLink()) throw new Error("Некорректный файл: " + file.path);
      const data = await readFile(src);
      if (gitHash(data) !== file.sha) throw new Error("Ошибка контроля целостности: " + file.path);
      prepared.push({ ...file, data });
      await event("file_verify_done", file.path, "verified");
    }
    await event("backup_started", "", "backing_up");
    // Back up all destination files BEFORE making any changes.
    for (const file of prepared) {
      const dst = path.join(root, file.path);
      let existed = false;
      try {
        const stat = await lstat(dst);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Небезопасный файл назначения: " + file.path);
        existed = true;
        const saved = path.join(backup, file.path);
        await mkdir(path.dirname(saved), { recursive: true });
        await copyFile(dst, saved);
      } catch (e) { if (e?.code !== "ENOENT") throw e; }
      changes.push({ name: file.path, existed });
    }
    const doomed = [];
    for (const name of removals) {
      await assertNoLinks(root, name);
      const dst = path.join(root, name);
      try {
        const stat = await lstat(dst);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Небезопасный файл для удаления: " + name);
        const saved = path.join(backup, name);
        await mkdir(path.dirname(saved), { recursive: true });
        await copyFile(dst, saved);
        changes.push({ name, existed: true });
        doomed.push(name);
      } catch (e) { if (e?.code !== "ENOENT") throw e; }
    }
    await event("backup_done", "", "backed_up", { backup_relative_path: path.relative(root, backup) });
    for (const file of prepared) {
      const dst = path.join(root, file.path);
      await assertNoLinks(root, file.path);
      await event("file_install_start", file.path, "installing", { target_relative_path: file.path });
      try {
        await mkdir(path.dirname(dst), { recursive: true });
        await atomicWrite(dst, file.data);
      } catch (e) {
        await event("file_install_failed", file.path, "failed", { target_relative_path: file.path, message: String(e?.message ?? e), error_code: e?.code ?? "EINSTALL" }).catch(() => {});
        throw e;
      }
      await event("file_install_done", file.path, "installed", { target_relative_path: file.path });
    }
    for (const name of doomed) {
      try { await rm(path.join(root, name)); }
      catch (e) {
        await event("file_install_failed", name, "failed", { message: String(e?.message ?? e), error_code: e?.code ?? "EREMOVE", change_type: "removed" }).catch(() => {});
        throw e;
      }
      await event("file_remove_done", name, "removed", { change_type: "removed" });
    }
    await event("health_check_started", "", "health_check");
    try { await healthCheck(root, manifest.files); }
    catch (e) {
      await event("health_check_done", "", "failed", { message: String(e?.message ?? e) }).catch(() => {});
      throw e;
    }
    await event("health_check_done", "", "healthy");
    await atomicWrite(path.join(root, ".juunibi-version"), Buffer.from(manifest.sha + "\n"));
    // Remember what this release installed so a later update can propose removals of files it dropped.
    await atomicWrite(path.join(folder, "installed.json"), Buffer.from(JSON.stringify({ sha: manifest.sha, paths: manifest.files.map(f => f.path) })));
    await rm(path.join(folder, "removals-confirmed.json"), { force: true });
    await rm(manifestFile);
    await event("update_completed", "", "completed", { sha: manifest.sha, backup_relative_path: path.relative(root, backup) });
    return true;
  } catch (error) {
    await event("update_failed", "", "failed", { message: String(error) }).catch(() => {});
    await event("rollback_started", "", "rolling_back").catch(() => {});
    const failures = [];
    for (const { name, existed } of changes.reverse()) {
      const dst = path.join(root, name);
      try {
        await assertNoLinks(root, name);
        if (existed) { await mkdir(path.dirname(dst), { recursive: true }); await atomicWrite(dst, await readFile(path.join(backup, name))); }
        else await rm(dst, { force: true });
      } catch (e) { failures.push(name + ": " + String(e)); }
    }
    try {
      const marker = path.join(root, ".juunibi-version");
      if (oldVersion === null) await rm(marker, { force: true });
      else await atomicWrite(marker, oldVersion);
      if (oldInstalled === null) await rm(installedFile, { force: true });
      else await atomicWrite(installedFile, oldInstalled);
    } catch (e) { failures.push("version marker: " + String(e)); }
    if (failures.length) {
      await event("rollback_failed", "", "failed", { message: failures.join("; ") }).catch(() => {});
      throw new AggregateError([error, ...failures], "Установка и откат завершились ошибками");
    }
    await event("rollback_done", "", "rolled_back").catch(() => {});
    throw error;
  }
}
