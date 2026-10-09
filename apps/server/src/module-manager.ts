import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export type ModuleStatus = "started" | "pending" | "failed" | "stopped";
export type ModuleAction = "start" | "stop" | "restart" | "enable" | "disable";
export type ToolRisk = "read" | "write" | "danger";

export interface ModuleDef {
  name: string; title: string; deps: string[]; description: string;
  /** Data files this module owns, relative to the project root (shown with their size). */
  files: string[];
  /** Part of the foundation: cannot be stopped or disabled. */
  core?: boolean;
  /** Current state as the component itself reports it (before stop/dependency overlays). */
  probe(): { status: "started" | "pending" | "failed"; note: string };
  /** (Re)initialise the component. Throwing marks the module as failed. */
  start?(): Promise<void>;
  /** Called after the module was stopped. */
  stop?(): Promise<void>;
  /** Return a reason to refuse stopping right now (for example while an update is running). */
  busy?(): string | null;
}
export interface ManifestModule { name: string; title: string; description: string; version: string; deps: string[]; permissions: string[] }
export interface ToolInfo { name: string; risk: ToolRisk; description: string }
export interface ToolOutcome { tool: string; status: "ok" | "error" | "denied"; at: string }

export interface ModuleItem {
  name: string; title: string; deps: string[]; status: ModuleStatus; note: string; kind: "builtin" | "manifest";
  error?: string; enabled: boolean; running: boolean; core: boolean; dependents: string[]; assistantBlocked: boolean;
  /** Short health summary for the tile; the full picture is in detail(). */
  uptimeSec: number; errors24h: number; lastMs: number | null;
}
interface Health { startedAt: number; errors: number[]; calls: number; lastError?: string; lastOkAt?: number; lastMs?: number; durations: number[] }
interface Persisted { enabled: Record<string, boolean>; toolsOff: string[]; blocked: string[] }
interface LogLine { at: number; level: "info" | "error"; text: string }

const DAY = 86_400_000;
const err = (message: string, status: number) => Object.assign(new Error(message), { status });

/** Which module owns an assistant tool. Names the server registers itself; unknown tools belong to the assistant. */
export function moduleOfTool(tool: string): string {
  if (tool.startsWith("brain_")) return "brain";
  if (tool === "search_memory" || tool === "remember" || tool === "propose_memory_revision") return "memory";
  return "assistant";
}

export class ModuleManager {
  private readonly defs = new Map<string, ModuleDef>();
  private persisted: Persisted = { enabled: {}, toolsOff: [], blocked: [] };
  private readonly running = new Map<string, boolean>();
  private readonly failed = new Map<string, string>();
  private readonly health = new Map<string, Health>();
  private readonly logs = new Map<string, LogLine[]>();
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly root: string, defs: ModuleDef[], private readonly file: string,
    private readonly extra: {
      manifests?: () => ManifestModule[];
      tools?: () => ToolInfo[];
      outcomes?: () => ToolOutcome[];
      now?: () => number;
    } = {}) {
    for (const d of defs) this.defs.set(d.name, d);
  }
  private now() { return this.extra.now?.() ?? Date.now(); }

  async load() {
    try {
      const raw: unknown = JSON.parse(await readFile(this.file, "utf8"));
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        const r = raw as Partial<Persisted>;
        const enabled: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(r.enabled ?? {})) if (typeof v === "boolean") enabled[k] = v;
        const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 200) : []);
        this.persisted = { enabled, toolsOff: strings(r.toolsOff), blocked: strings(r.blocked) };
      }
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") this.log("brain", "Настройки модулей не прочитаны: " + (e as Error).message, "error"); }
    for (const d of this.defs.values()) {
      this.running.set(d.name, d.core ? true : this.persisted.enabled[d.name] !== false);
      this.health.set(d.name, this.freshHealth());
    }
  }
  private freshHealth(): Health { return { startedAt: this.now(), errors: [], calls: 0, durations: [] }; }
  flush() { return this.writes; }
  private save() {
    const data = JSON.stringify(this.persisted);
    this.writes = this.writes.catch(() => {}).then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const tmp = this.file + "." + randomUUID() + ".tmp";
      await writeFile(tmp, data, { mode: 0o600 });
      await rename(tmp, this.file);
    });
    return this.writes;
  }

  // ---------- journal and health ----------
  log(name: string, text: string, level: "info" | "error" = "info") {
    const list = this.logs.get(name) ?? [];
    list.push({ at: this.now(), level, text: text.slice(0, 400) });
    this.logs.set(name, list.slice(-50));
  }
  ok(name: string, ms?: number) {
    const h = this.health.get(name); if (!h) return;
    h.calls++; h.lastOkAt = this.now();
    if (ms !== undefined) { h.lastMs = ms; h.durations = [...h.durations, ms].slice(-20); }
  }
  fail(name: string, message: string) {
    const h = this.health.get(name); if (!h) return;
    h.calls++; h.lastError = message.slice(0, 300);
    h.errors = [...h.errors.filter(t => this.now() - t < DAY), this.now()].slice(-200);
    this.log(name, message, "error");
  }
  /** Run a unit of work for a module, recording its duration and any failure. Errors are re-thrown unchanged. */
  async track<T>(name: string, work: () => Promise<T>): Promise<T> {
    const t0 = this.now();
    try { const r = await work(); this.ok(name, this.now() - t0); return r; }
    catch (e) { this.fail(name, (e as Error).message ?? String(e)); throw e; }
  }

  // ---------- state ----------
  has(name: string) { return this.defs.has(name); }
  isActive(name: string): boolean { return this.defs.has(name) ? this.running.get(name) === true : true; }
  /** Active modules that (transitively) depend on `name`. */
  dependents(name: string): string[] {
    const out = new Set<string>();
    const walk = (n: string) => { for (const d of this.defs.values()) if (d.deps.includes(n) && !out.has(d.name)) { out.add(d.name); walk(d.name); } };
    walk(name);
    return [...out];
  }
  private statusOf(d: ModuleDef): { status: ModuleStatus; note: string } {
    if (this.running.get(d.name) !== true) {
      const off = this.persisted.enabled[d.name] === false;
      return { status: "stopped", note: off ? "Выключен: не запускается при старте." : "Остановлен до перезапуска сервера." };
    }
    const reason = this.failed.get(d.name);
    if (reason) return { status: "failed", note: reason };
    const base = d.probe();
    const down = d.deps.filter(x => this.defs.has(x) && !this.isActive(x));
    if (base.status === "started" && down.length) return { status: "pending", note: "Зависит от остановленного: " + down.join(", ") + "." };
    return base;
  }
  private item(d: ModuleDef): ModuleItem {
    const s = this.statusOf(d);
    const h = this.health.get(d.name);
    return {
      name: d.name, title: d.title, deps: d.deps, status: s.status, note: s.note, kind: "builtin",
      ...(s.status === "failed" ? { error: h?.lastError ?? s.note } : {}),
      enabled: this.persisted.enabled[d.name] !== false, running: this.running.get(d.name) === true,
      core: !!d.core, dependents: this.dependents(d.name),
      assistantBlocked: this.persisted.blocked.includes(d.name),
      uptimeSec: this.running.get(d.name) ? Math.max(0, Math.round((this.now() - (h?.startedAt ?? this.now())) / 1000)) : 0,
      errors24h: (h?.errors ?? []).filter(t => this.now() - t < DAY).length, lastMs: h?.lastMs ?? null,
    };
  }
  list(): ModuleItem[] {
    const manifests = (this.extra.manifests?.() ?? []).map((m): ModuleItem => ({
      name: m.name, title: m.title, deps: m.deps, status: "pending",
      note: "Манифест без кода: описывает права, ничего не выполняет.", kind: "manifest",
      enabled: true, running: false, core: false, dependents: [], assistantBlocked: false, uptimeSec: 0, errors24h: 0, lastMs: null,
    }));
    return [...[...this.defs.values()].map(d => this.item(d)), ...manifests];
  }
  /** Exactly what the assistant receives in its system prompt and through the list_modules tool. */
  promptView() { return this.list().map(({ name, title, deps, status, note }) => ({ name, title, deps, status, note })); }

  // ---------- control ----------
  async act(name: string, action: ModuleAction) {
    const d = this.defs.get(name);
    if (!d) throw err("Модуль не найден", 404);
    if (d.core && action !== "start") throw err(`«${d.title}» — основа системы: её нельзя остановить или выключить.`, 409);
    if (d.core) return this.item(d);
    if (action === "stop" || action === "restart" || action === "disable") {
      const reason = this.running.get(name) ? d.busy?.() : null;
      if (reason) throw err(reason, 409);
    }
    if (action === "enable" || action === "disable") {
      this.persisted.enabled[name] = action === "enable";
      await this.save();
    }
    if (action === "stop" || action === "disable") await this.halt(d);
    else if (action === "start" || action === "enable") await this.launch(d);
    else if (action === "restart") { await this.halt(d); await this.launch(d); }
    return this.item(d);
  }
  private async halt(d: ModuleDef) {
    if (this.running.get(d.name) !== true) return;
    this.running.set(d.name, false);
    this.log(d.name, "Остановлен");
    try { await d.stop?.(); } catch (e) { this.fail(d.name, "Ошибка при остановке: " + (e as Error).message); }
  }
  private async launch(d: ModuleDef) {
    this.running.set(d.name, true);
    this.failed.delete(d.name);
    const h = this.health.get(d.name) ?? this.freshHealth();
    h.startedAt = this.now(); this.health.set(d.name, h);
    try {
      await d.start?.();
      this.log(d.name, "Запущен"); this.ok(d.name);
    } catch (e) {
      const message = (e as Error).message ?? String(e);
      this.failed.set(d.name, message);
      this.fail(d.name, message);
    }
  }
  // ---------- assistant permissions (only ever narrow what the assistant may do) ----------
  toolAllowed(tool: string): boolean {
    const owner = moduleOfTool(tool);
    return this.isActive(owner) && !this.persisted.blocked.includes(owner) && !this.persisted.toolsOff.includes(tool);
  }
  async setToolAllowed(tool: string, allowed: boolean) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tool)) throw err("Некорректное имя инструмента", 400);
    const off = new Set(this.persisted.toolsOff);
    if (allowed) off.delete(tool); else off.add(tool);
    this.persisted.toolsOff = [...off].slice(0, 200);
    await this.save();
    this.log(moduleOfTool(tool), `Инструмент ${tool}: ${allowed ? "разрешён" : "запрещён"} помощнице`);
  }
  async setAssistantAccess(name: string, allowed: boolean) {
    if (!this.defs.has(name)) throw err("Модуль не найден", 404);
    const set = new Set(this.persisted.blocked);
    if (allowed) set.delete(name); else set.add(name);
    this.persisted.blocked = [...set];
    await this.save();
    this.log(name, `Доступ помощницы: ${allowed ? "открыт" : "закрыт"}`);
    return this.item(this.defs.get(name)!);
  }
  tools() {
    const outcomes = (this.extra.outcomes?.() ?? []).filter(o => this.now() - Date.parse(o.at) < DAY);
    return (this.extra.tools?.() ?? []).map(t => {
      const mine = outcomes.filter(o => o.tool === t.name);
      return { ...t, module: moduleOfTool(t.name), allowed: this.toolAllowed(t.name),
        calls24h: mine.length, errors24h: mine.filter(o => o.status === "error").length, denied24h: mine.filter(o => o.status === "denied").length };
    });
  }

  // ---------- details ----------
  async detail(name: string) {
    const d = this.defs.get(name);
    if (!d) {
      const m = this.extra.manifests?.().find(x => x.name === name);
      if (!m) throw err("Модуль не найден", 404);
      const item = this.list().find(x => x.name === name)!;
      return { ...item, description: m.description, version: m.version, permissions: m.permissions, files: [], tools: [], health: null, log: [] };
    }
    const files = await Promise.all(d.files.map(async rel => {
      try { return { path: rel, size: (await stat(path.join(this.root, rel))).size as number | null }; }
      catch { return { path: rel, size: null as number | null }; }
    }));
    const h = this.health.get(name) ?? this.freshHealth();
    const recent = h.errors.filter(t => this.now() - t < DAY);
    const avg = h.durations.length ? Math.round(h.durations.reduce((a, b) => a + b, 0) / h.durations.length) : null;
    return {
      ...this.item(d), description: d.description, files,
      tools: this.tools().filter(t => t.module === name),
      health: {
        uptimeSec: this.running.get(name) ? Math.max(0, Math.round((this.now() - h.startedAt) / 1000)) : 0,
        errors24h: recent.length, calls: h.calls, lastError: h.lastError ?? null,
        lastOkAt: h.lastOkAt ? new Date(h.lastOkAt).toISOString() : null, lastMs: h.lastMs ?? null, avgMs: avg,
      },
      log: (this.logs.get(name) ?? []).slice(-10).map(l => ({ at: new Date(l.at).toISOString(), level: l.level, text: l.text })),
    };
  }
}
