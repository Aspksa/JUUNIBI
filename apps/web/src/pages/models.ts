/** Pure helpers behind the Modules and Memory pages (tested in test/page-models.test.ts). */
import type { MemoryItem, ModuleInfo } from "../api";

// ---------- modules ----------
export type ModStatus = "started" | "pending" | "failed" | "stopped";
export interface ModView {
  name: string; title: string; note: string; deps: string[]; status: ModStatus; depth: number;
  kind: "builtin" | "manifest"; error: string; enabled: boolean; running: boolean; core: boolean; dependents: string[]; assistantBlocked: boolean;
}
const norm = (s: string): ModStatus => (s === "started" || s === "failed" || s === "stopped" ? s : "pending");

/** Orders modules so dependencies come first and records the depth (for indentation). Unknown deps and cycles never crash. */
export function buildModules(list: ModuleInfo[]): { items: ModView[]; counts: Record<ModStatus, number> } {
  const byName = new Map(list.map((m) => [m.name, m]));
  const depth = new Map<string, number>();
  const walk = (name: string, seen: Set<string>): number => {
    const known = depth.get(name);
    if (known !== undefined) return known;
    if (seen.has(name)) return 0; // cycle guard
    seen.add(name);
    const m = byName.get(name);
    const d = m ? 1 + Math.max(-1, ...m.deps.filter((x) => byName.has(x)).map((x) => walk(x, seen))) : 0;
    seen.delete(name);
    depth.set(name, Math.max(0, d));
    return Math.max(0, d);
  };
  const items = list.map((m, i) => ({ view: {
    name: m.name, title: m.title || m.name, note: m.note ?? "", deps: m.deps, status: norm(m.status), depth: walk(m.name, new Set()),
    kind: m.kind === "manifest" ? "manifest" : "builtin", error: m.error ?? "", enabled: m.enabled !== false, running: m.running !== false,
    core: !!m.core, dependents: m.dependents ?? [], assistantBlocked: !!m.assistantBlocked,
  } as ModView, i }))
    .sort((a, b) => a.view.depth - b.view.depth || a.i - b.i).map((x) => x.view);
  const counts = { started: 0, pending: 0, failed: 0, stopped: 0 };
  for (const m of items) counts[m.status]++;
  return { items, counts };
}

export type ModFilter = "all" | ModStatus;
/** Case-insensitive search over name, title, note and dependencies, combined with a status filter. */
export function filterModules(items: ModView[], query: string, status: ModFilter): ModView[] {
  const q = query.trim().toLowerCase();
  return items.filter((m) => (status === "all" || m.status === status) &&
    (!q || [m.name, m.title, m.note, ...m.deps].some((t) => t.toLowerCase().includes(q))));
}

/** Everything that (transitively) depends on `name` — what stops working when it fails. */
export function impactOf(items: ModView[], name: string): string[] {
  const out = new Set<string>();
  const walk = (n: string) => { for (const m of items) if (m.deps.includes(n) && !out.has(m.name) && m.name !== name) { out.add(m.name); walk(m.name); } };
  walk(name);
  return [...out];
}
/** What `name` needs to work (transitive dependencies). */
export function needsOf(items: ModView[], name: string): string[] {
  const byName = new Map(items.map((m) => [m.name, m]));
  const out = new Set<string>();
  const walk = (n: string) => { for (const d of byName.get(n)?.deps ?? []) if (byName.has(d) && !out.has(d) && d !== name) { out.add(d); walk(d); } };
  walk(name);
  return [...out];
}

export interface GraphNode { name: string; title: string; status: ModStatus; x: number; y: number; w: number; h: number }
export interface GraphEdge { from: string; to: string }
/** Column per depth, rows in server order; edges only between known modules. Pure, so it is tested without a DOM. */
export function layoutGraph(items: ModView[], opts = { w: 176, h: 48, gapX: 64, gapY: 18, pad: 16 }): { nodes: GraphNode[]; edges: GraphEdge[]; width: number; height: number } {
  const rows = new Map<number, number>();
  const nodes = items.map((m) => {
    const row = rows.get(m.depth) ?? 0;
    rows.set(m.depth, row + 1);
    return { name: m.name, title: m.title, status: m.status, w: opts.w, h: opts.h,
      x: opts.pad + m.depth * (opts.w + opts.gapX), y: opts.pad + row * (opts.h + opts.gapY) };
  });
  const known = new Set(items.map((m) => m.name));
  const edges = items.flatMap((m) => m.deps.filter((d) => known.has(d)).map((d) => ({ from: d, to: m.name })));
  const cols = items.length ? Math.max(...items.map((m) => m.depth)) + 1 : 0;
  const tallest = Math.max(0, ...rows.values());
  return { nodes, edges, width: opts.pad * 2 + cols * opts.w + Math.max(0, cols - 1) * opts.gapX, height: opts.pad * 2 + tallest * opts.h + Math.max(0, tallest - 1) * opts.gapY };
}

// ---------- memory ----------
export type MemFilter = "all" | "pending" | "fact" | "preference" | "lesson";
export const KIND_LABEL: Record<string, string> = { fact: "Факт", preference: "Предпочтение", lesson: "Урок" };
export function memoryCounts(items: MemoryItem[]): Record<MemFilter, number> & { active: number } {
  const c = { all: items.length, pending: 0, fact: 0, preference: 0, lesson: 0, active: 0 };
  for (const m of items) {
    if (m.status === "pending") c.pending++; else c.active++;
    if (m.kind === "fact" || m.kind === "preference" || m.kind === "lesson") c[m.kind]++;
  }
  return c;
}
/** Pending proposals first, then newest first; text search is case-insensitive. */
export function filterMemory(items: MemoryItem[], filter: MemFilter, query: string): MemoryItem[] {
  const q = query.trim().toLowerCase();
  return items
    .filter((m) => (filter === "all" ? true : filter === "pending" ? m.status === "pending" : m.kind === filter))
    .filter((m) => !q || m.text.toLowerCase().includes(q))
    .sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending") || (b.createdAt ?? 0) - (a.createdAt ?? 0));
}
