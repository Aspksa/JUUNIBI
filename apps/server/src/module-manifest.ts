import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Declarative module manifests. A manifest only DESCRIBES a module and the permissions it asks for.
 * It contains no code and nothing in it is ever executed: installing one cannot add tools or run anything.
 */
export const PERMISSIONS: Record<string, { label: string; risk: "low" | "medium" | "high" }> = {
  "read:modules": { label: "Читать список модулей", risk: "low" },
  "read:memory": { label: "Читать память", risk: "low" },
  "write:memory": { label: "Предлагать записи в память", risk: "medium" },
  "write:plans": { label: "Создавать планы", risk: "medium" },
  network: { label: "Доступ в интернет", risk: "high" },
};
export interface ModuleManifest { name: string; title: string; description: string; version: string; deps: string[]; permissions: string[]; source?: string }
export const MANIFEST_SOURCE_PREFIX = "https://raw.githubusercontent.com/Aspksa/JUUNIBI/";
const MAX_MANIFESTS = 20;
const bad = (message: string, status = 400) => Object.assign(new Error(message), { status });

/** Validates untrusted input and returns a clean manifest; unknown keys are dropped, never copied. */
export function parseManifest(input: unknown, reserved: string[]): ModuleManifest {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw bad("Манифест должен быть JSON-объектом");
  const m = input as Record<string, unknown>;
  if (m.code !== undefined || m.script !== undefined || m.run !== undefined || m.main !== undefined || m.entry !== undefined)
    throw bad("Манифест не может содержать код: исполнение модулей не поддерживается");
  const text = (v: unknown, label: string, min: number, max: number) => {
    if (typeof v !== "string" || v.trim().length < min || v.length > max) throw bad(`Поле «${label}»: от ${min} до ${max} символов`);
    return v.trim();
  };
  const name = text(m.name, "name", 2, 41);
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(name)) throw bad("Имя: строчные латинские буквы, цифры и дефис, начинается с буквы");
  const version = text(m.version, "version", 1, 20);
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw bad("Версия должна быть вида 1.2.3");
  const deps = m.deps === undefined ? [] : m.deps;
  if (!Array.isArray(deps) || deps.length > 10 || !deps.every(x => typeof x === "string" && /^[a-z][a-z0-9-]{1,40}$/.test(x))) throw bad("Поле «deps»: до 10 имён модулей");
  const permissions = m.permissions === undefined ? [] : m.permissions;
  if (!Array.isArray(permissions) || permissions.length > 10 || !permissions.every(x => typeof x === "string" && Object.hasOwn(PERMISSIONS, x))) throw bad("Неизвестное право. Допустимы: " + Object.keys(PERMISSIONS).join(", "));
  let source: string | undefined;
  if (m.source !== undefined) { source = text(m.source, "source", 1, 300); if (!source.startsWith(MANIFEST_SOURCE_PREFIX)) throw bad("Источник разрешён только из репозитория JUUNIBI"); }
  if (reserved.includes(name)) throw bad(`Имя «${name}» уже занято`, 409);
  return { name, title: text(m.title, "title", 2, 80), description: text(m.description, "description", 8, 300), version,
    deps: [...new Set(deps as string[])], permissions: [...new Set(permissions as string[])], ...(source ? { source } : {}) };
}

/** SHA-256 over canonical JSON (sorted keys): the user sees this value and confirms exactly it. */
export function manifestHash(m: ModuleManifest): string {
  const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canon(x)])) : v;
  return createHash("sha256").update(JSON.stringify(canon(m))).digest("hex");
}

export async function fetchManifest(url: unknown, fetcher: typeof fetch = fetch): Promise<unknown> {
  if (typeof url !== "string" || !url.startsWith(MANIFEST_SOURCE_PREFIX) || url.length > 300 || /[\s#?]/.test(url) || url.includes(".."))
    throw bad("Адрес должен начинаться с " + MANIFEST_SOURCE_PREFIX);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 7000);
  try {
    const r = await fetcher(url, { redirect: "error", signal: ac.signal, headers: { Accept: "application/json, text/plain" } }).catch(() => { throw bad("Источник не ответил", 502); });
    if (!r.ok) throw bad("Источник недоступен: HTTP " + r.status, 502);
    const reader = r.body?.getReader();
    if (!reader) throw bad("Пустой ответ источника", 502);
    const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const p = await reader.read(); if (p.done) break; size += p.value.byteLength; if (size > 65_536) throw bad("Манифест слишком большой", 502); chunks.push(p.value); } }
    finally { await reader.cancel().catch(() => {}); }
    try { return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks))); } catch { throw bad("Источник вернул не JSON", 502); }
  } finally { clearTimeout(timer); }
}

export class ManifestStore {
  private items: ModuleManifest[] = [];
  private writes: Promise<void> = Promise.resolve();
  constructor(private readonly file: string, private readonly reservedNames: () => string[]) {}
  async load() {
    try {
      const raw: unknown = JSON.parse(await readFile(this.file, "utf8"));
      if (!Array.isArray(raw)) throw new Error("Повреждён список манифестов");
      this.items = raw.slice(0, MAX_MANIFESTS).flatMap(x => { try { return [parseManifest(x, [])]; } catch { return []; } });
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
  list() { return this.items.map(m => ({ ...m })); }
  private taken() { return [...this.reservedNames(), ...this.items.map(m => m.name)]; }
  preview(input: unknown) {
    const manifest = parseManifest(input, this.taken());
    const missing = manifest.deps.filter(d => !this.reservedNames().includes(d) && !this.items.some(m => m.name === d));
    const permissions = manifest.permissions.map(id => ({ id, ...PERMISSIONS[id]! }));
    const warnings = [
      ...(permissions.some(p => p.risk === "high") ? ["Запрашивает доступ в интернет."] : []),
      ...(missing.length ? ["Зависит от модулей, которых нет: " + missing.join(", ") + "."] : []),
    ];
    return { manifest, sha256: manifestHash(manifest), permissions, warnings, executable: false as const,
      note: "Манифест не содержит кода и ничего не выполняет. Он только фиксирует, какие права запрашивает модуль." };
  }
  async install(input: unknown, sha256: unknown) {
    const p = this.preview(input);
    if (typeof sha256 !== "string" || sha256.toLowerCase() !== p.sha256) throw bad("Контрольная сумма не совпала: подтвердите именно то, что показано");
    if (this.items.length >= MAX_MANIFESTS) throw bad("Достигнут предел манифестов (" + MAX_MANIFESTS + ")", 409);
    this.items.push(p.manifest);
    await this.save();
    return p;
  }
  async remove(name: string) {
    const n = this.items.length;
    this.items = this.items.filter(m => m.name !== name);
    if (this.items.length === n) throw bad("Манифест не найден", 404);
    await this.save();
  }
  flush() { return this.writes; }
  private save() {
    const data = JSON.stringify(this.items);
    this.writes = this.writes.catch(() => {}).then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const tmp = this.file + "." + randomUUID() + ".tmp";
      await writeFile(tmp, data, { mode: 0o600 });
      await rename(tmp, this.file);
    });
    return this.writes;
  }
}
