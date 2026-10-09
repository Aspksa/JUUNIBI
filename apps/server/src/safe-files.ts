import { copyFile, lstat, mkdir, open, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

/**
 * File access for the assistant, confined to ONE folder chosen by the owner.
 * Everything here fails closed: unknown paths, links leaving the folder, secrets, binaries and big files are refused.
 */
export class FileAccessError extends Error {
  constructor(message: string, readonly status = 400) { super(message); this.name = "FileAccessError"; }
}
export const MAX_READ_BYTES = 200_000;
export const MAX_WRITE_BYTES = 200_000;
const MAX_LIST = 200;
const MAX_SEARCH_FILES = 2000;
const MAX_SEARCH_HITS = 30;
const SEARCH_BUDGET_MS = 2500;
/** Directories and files that never leave this module, whatever the owner's folder contains. */
const DENY_DIRS = new Set([".git", ".ssh", ".gnupg", "node_modules", ".updates", ".runtime", "data", ".aws", ".kube"]);
const DENY_FILE = /^(\.env(\..*)?|\.npmrc|\.netrc|\.pypirc|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|credentials(\..*)?|.*\.(pem|key|pfx|p12|kdbx|keystore)|cloudru-settings\.json|agent-audit\.jsonl)$/i;
/** Only plain-text document types may be written: no scripts, no executables. */
export const WRITE_EXT = new Set(["txt", "md", "markdown", "csv", "tsv", "json", "yml", "yaml", "log", "ini", "toml"]);

const isDenied = (segments: string[]) => segments.some((s, i) => DENY_DIRS.has(s.toLowerCase()) || (i === segments.length - 1 && DENY_FILE.test(s)) || DENY_FILE.test(s));
export function deniedPath(rel: string): boolean { return isDenied(rel.split("/").filter(Boolean)); }

async function rootReal(root: string): Promise<string> {
  if (!root) throw new FileAccessError("Доступ к файлам не настроен: владелец может указать папку в «Настройках»", 403);
  try { const r = await realpath(root); if (!(await stat(r)).isDirectory()) throw new Error(); return r; }
  catch { throw new FileAccessError("Папка недоступна", 403); }
}
const inside = (root: string, p: string) => p === root || p.startsWith(root + path.sep);

/** Cleans a model-supplied relative path. Absolute paths, `..`, NUL and secrets are refused before touching the disk. */
export function cleanRelative(input: unknown): string {
  if (typeof input !== "string" || input.length > 400 || input.includes("\0")) throw new FileAccessError("Некорректный путь");
  const rel = input.trim().replace(/\\/g, "/");
  if (/^([a-zA-Z]:|\/|~)/.test(rel)) throw new FileAccessError("Укажите путь внутри разрешённой папки, без начального «/»");
  const segments = rel.split("/").filter((s) => s && s !== ".");
  if (segments.some((s) => s === "..")) throw new FileAccessError("Выход за пределы папки запрещён");
  if (isDenied(segments)) throw new FileAccessError("Этот файл или папка закрыты для помощницы", 403);
  return segments.join("/");
}

/** Resolves an EXISTING path and re-checks it after following links. */
async function resolveExisting(root: string, relInput: unknown): Promise<{ real: string; base: string; rel: string }> {
  const base = await rootReal(root);
  const rel = cleanRelative(relInput);
  let real: string;
  try { real = await realpath(path.join(base, rel)); } catch { throw new FileAccessError("Не найдено", 404); }
  if (!inside(base, real)) throw new FileAccessError("Ссылка ведёт за пределы разрешённой папки", 403);
  const relReal = path.relative(base, real).split(path.sep).join("/");
  if (relReal && isDenied(relReal.split("/"))) throw new FileAccessError("Этот файл или папка закрыты для помощницы", 403);
  return { real, base, rel: relReal };
}

export async function listDir(root: string, rel: unknown = ""): Promise<{ path: string; entries: { name: string; type: "file" | "dir"; size?: number }[]; truncated: boolean }> {
  const { real, rel: at } = await resolveExisting(root, rel ?? "");
  if (!(await stat(real)).isDirectory()) throw new FileAccessError("Это не папка");
  const names = (await readdir(real)).filter((n) => !isDenied([n])).sort((a, b) => a.localeCompare(b));
  const entries: { name: string; type: "file" | "dir"; size?: number }[] = [];
  for (const name of names.slice(0, MAX_LIST)) {
    try {
      const st = await lstat(path.join(real, name));
      if (st.isSymbolicLink()) continue; // links are never advertised
      entries.push(st.isDirectory() ? { name, type: "dir" } : { name, type: "file", size: st.size });
    } catch { /* vanished */ }
  }
  return { path: at || ".", entries, truncated: names.length > MAX_LIST };
}

async function looksBinary(file: string): Promise<boolean> {
  const fh = await open(file, "r");
  try { const buf = Buffer.alloc(4096); const { bytesRead } = await fh.read(buf, 0, 4096, 0); return buf.subarray(0, bytesRead).includes(0); }
  finally { await fh.close(); }
}

export async function readText(root: string, rel: unknown): Promise<{ path: string; text: string; truncated: boolean; bytes: number }> {
  const { real, rel: at } = await resolveExisting(root, rel);
  const st = await stat(real);
  if (!st.isFile()) throw new FileAccessError("Это не файл");
  if (await looksBinary(real)) throw new FileAccessError("Бинарные файлы не читаются");
  const fh = await open(real, "r");
  try {
    const len = Math.min(st.size, MAX_READ_BYTES);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, 0);
    return { path: at, text: buf.toString("utf8"), truncated: st.size > MAX_READ_BYTES, bytes: st.size };
  } finally { await fh.close(); }
}

export async function searchText(root: string, query: unknown, rel: unknown = ""): Promise<{ query: string; hits: { path: string; line: number; text: string }[]; scanned: number; complete: boolean }> {
  if (typeof query !== "string" || query.trim().length < 2 || query.length > 100) throw new FileAccessError("Запрос: от 2 до 100 символов");
  const { real, base } = await resolveExisting(root, rel ?? "");
  const q = query.trim().toLowerCase();
  const hits: { path: string; line: number; text: string }[] = [];
  const t0 = Date.now();
  let scanned = 0, complete = true;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 6 || hits.length >= MAX_SEARCH_HITS || !complete) return;
    let names: string[];
    try { names = (await readdir(dir)).sort(); } catch { return; }
    for (const name of names) {
      if (hits.length >= MAX_SEARCH_HITS) return;
      if (scanned >= MAX_SEARCH_FILES || Date.now() - t0 > SEARCH_BUDGET_MS) { complete = false; return; }
      if (isDenied([name])) continue;
      const abs = path.join(dir, name);
      let st; try { st = await lstat(abs); } catch { continue; }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) { await walk(abs, depth + 1); continue; }
      if (!st.isFile() || st.size > MAX_READ_BYTES || st.size === 0) continue;
      scanned++;
      try {
        if (await looksBinary(abs)) continue;
        const lines = (await readFile(abs, "utf8")).split(/\r?\n/);
        for (let i = 0; i < lines.length && hits.length < MAX_SEARCH_HITS; i++)
          if (lines[i]!.toLowerCase().includes(q)) hits.push({ path: path.relative(base, abs).split(path.sep).join("/"), line: i + 1, text: lines[i]!.trim().slice(0, 200) });
      } catch { /* unreadable */ }
    }
  };
  await walk(real, 0);
  return { query: query.trim(), hits, scanned, complete };
}

/** Creates or replaces a text file inside the folder. An existing file is copied to `backupDir` first. */
export async function writeText(root: string, relInput: unknown, content: unknown, backupDir: string): Promise<{ path: string; bytes: number; created: boolean; backup?: string }> {
  const base = await rootReal(root);
  const rel = cleanRelative(relInput);
  if (!rel) throw new FileAccessError("Укажите имя файла");
  if (typeof content !== "string") throw new FileAccessError("Содержимое должно быть текстом");
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_WRITE_BYTES) throw new FileAccessError(`Файл больше ${MAX_WRITE_BYTES / 1000} КБ`);
  if (content.includes("\0")) throw new FileAccessError("Бинарное содержимое запрещено");
  const ext = path.extname(rel).slice(1).toLowerCase();
  if (!WRITE_EXT.has(ext)) throw new FileAccessError(`Записывать можно только текстовые документы: ${[...WRITE_EXT].join(", ")}`);
  const target = path.join(base, rel);
  const parent = path.dirname(target);
  // Create missing folders one by one, each time confirming we are still inside the folder.
  const missing: string[] = [];
  for (let d = parent; ;) {
    try {
      if (!inside(base, await realpath(d))) throw new FileAccessError("Ссылка ведёт за пределы разрешённой папки", 403);
      break;
    } catch (e) {
      if (e instanceof FileAccessError) throw e;
      if (d === base || !inside(base, d)) throw new FileAccessError("Папка недоступна", 403);
      missing.unshift(d);
      d = path.dirname(d);
    }
  }
  for (const d of missing) await mkdir(d);
  const parentReal = await realpath(parent);
  if (!inside(base, parentReal)) throw new FileAccessError("Ссылка ведёт за пределы разрешённой папки", 403);
  const finalPath = path.join(parentReal, path.basename(target));
  let existed = false, backup: string | undefined;
  try {
    const st = await lstat(finalPath);
    if (st.isSymbolicLink()) throw new FileAccessError("Запись через ссылку запрещена", 403);
    if (!st.isFile()) throw new FileAccessError("Это не файл");
    existed = true;
    await mkdir(backupDir, { recursive: true, mode: 0o700 });
    backup = path.join(backupDir, new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID().slice(0, 6) + "-" + path.basename(finalPath));
    await copyFile(finalPath, backup);
  } catch (e) { if (e instanceof FileAccessError) throw e; if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  const tmp = finalPath + "." + randomUUID().slice(0, 8) + ".tmp";
  try { await writeFile(tmp, content, { flag: "wx" }); await rename(tmp, finalPath); }
  catch (e) { await rm(tmp, { force: true }).catch(() => {}); throw e; }
  return { path: path.relative(base, finalPath).split(path.sep).join("/"), bytes, created: !existed, ...(backup ? { backup } : {}) };
}
