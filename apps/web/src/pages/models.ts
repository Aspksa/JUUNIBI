/** Pure helpers behind the Modules and Memory pages (tested in test/page-models.test.ts). */
import type { MemoryItem, ModuleInfo } from "../api";

// ---------- modules ----------
export interface ModView { name: string; title: string; note: string; deps: string[]; status: "started" | "pending" | "failed"; depth: number }
const norm = (s: string): ModView["status"] => (s === "started" || s === "failed" ? s : "pending");

/** Orders modules so dependencies come first and records the depth (for indentation). Unknown deps and cycles never crash. */
export function buildModules(list: ModuleInfo[]): { items: ModView[]; counts: Record<ModView["status"], number> } {
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
  const items = list.map((m, i) => ({ view: { name: m.name, title: m.title || m.name, note: m.note ?? "", deps: m.deps, status: norm(m.status), depth: walk(m.name, new Set()) } as ModView, i }))
    .sort((a, b) => a.view.depth - b.view.depth || a.i - b.i).map((x) => x.view);
  const counts = { started: 0, pending: 0, failed: 0 };
  for (const m of items) counts[m.status]++;
  return { items, counts };
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
