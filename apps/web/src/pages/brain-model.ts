/** Pure model behind the Brain hub tiles (tested in test/brain-model.test.ts). */
import type { BrainPlan, MemoryItem } from "../api";
import type { IconName } from "../dom";

export type TileId = "memory" | "plans" | "learning" | "knowledge" | "graph" | "gaps";
export interface BrainData {
  memory: MemoryItem[];
  plans: BrainPlan[] | null;
  learning: { enabled: boolean; used: number; limit: number } | null;
  knowledge: number | null;
  graph: { nodes: number; edges: number } | null;
  gaps: number | null;
}
export interface BrainTile { id: TileId; title: string; icon: IconName; value: string; sub: string; tone: "ok" | "warn" | "off"; badge?: string }
export const TILE_ORDER: TileId[] = ["memory", "plans", "learning", "knowledge", "graph", "gaps"];
/** 1 узел, 2 узла, 5 узлов. */
export function plural(n: number, forms: [string, string, string]): string {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? forms[0] : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? forms[1] : forms[2];
}
const NA = { value: "—", sub: "недоступно", tone: "off" as const };

export function buildBrainTiles(d: BrainData): BrainTile[] {
  const active = d.memory.filter((m) => m.status === "active").length;
  const pending = d.memory.length - active;
  const running = d.plans?.filter((p) => p.status === "running").length ?? 0;
  const make = (id: TileId, title: string, icon: IconName, body: { value: string; sub: string; tone: BrainTile["tone"]; badge?: string }): BrainTile => ({ id, title, icon, ...body });
  return [
    make("memory", "Память", "memory", { value: String(active), sub: "в памяти", tone: pending ? "warn" : "ok", ...(pending ? { badge: `${pending} ждут` } : {}) }),
    make("plans", "Планы", "list", d.plans ? { value: String(d.plans.length), sub: running ? `${running} в работе` : d.plans.length ? "нет активных" : "пока нет", tone: running ? "ok" : "off" } : NA),
    make("learning", "Обучение", "spark", d.learning ? { value: `${d.learning.used}/${d.learning.limit}`, sub: d.learning.enabled ? "запросов сегодня" : "приостановлено", tone: d.learning.enabled ? "ok" : "off" } : NA),
    make("knowledge", "Знания", "book", d.knowledge === null ? NA : { value: String(d.knowledge), sub: "проверенных фактов", tone: "ok" }),
    make("graph", "Связи", "link", d.graph ? { value: String(d.graph.edges), sub: `${d.graph.nodes} ${plural(d.graph.nodes, ["узел", "узла", "узлов"])} в графе`, tone: "ok" } : NA),
    make("gaps", "Пробелы", "target", d.gaps === null ? NA : { value: String(d.gaps), sub: d.gaps ? "что изучить" : "пробелов нет", tone: d.gaps ? "warn" : "ok" }),
  ];
}
export function isTileId(v: unknown): v is TileId { return typeof v === "string" && (TILE_ORDER as string[]).includes(v); }
