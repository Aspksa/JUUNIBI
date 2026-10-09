/** Pure model behind the Brain hub tiles (tested in test/brain-model.test.ts). */
import type { BrainPlan, MemoryItem, Note, QualityReport, Reminder } from "../api";
import type { IconName } from "../dom";

export type TileId = "memory" | "notes" | "reminders" | "plans" | "learning" | "knowledge" | "graph" | "gaps" | "quality";
export interface BrainData {
  memory: MemoryItem[];
  plans: BrainPlan[] | null;
  learning: { enabled: boolean; used: number; limit: number } | null;
  knowledge: number | null;
  graph: { nodes: number; edges: number } | null;
  gaps: number | null;
  organizer?: { notes: Note[]; reminders: Reminder[] } | null;
  quality?: QualityReport | null;
  evalLast?: { passed: number; total: number } | null;
}
export interface BrainTile { id: TileId; title: string; icon: IconName; value: string; sub: string; tone: "ok" | "warn" | "off"; badge?: string }
export const TILE_ORDER: TileId[] = ["memory", "notes", "reminders", "plans", "learning", "knowledge", "graph", "gaps", "quality"];
/** 1 узел, 2 узла, 5 узлов. */
export function plural(n: number, forms: [string, string, string]): string {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? forms[0] : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? forms[1] : forms[2];
}
/** "сегодня 18:00", "завтра 09:00", "12 окт." — short, human wording for the next reminder. */
export function whenShort(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86_400_000);
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return diff === 0 ? `сегодня ${time}` : diff === 1 ? `завтра ${time}` : d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}
const NA = { value: "—", sub: "недоступно", tone: "off" as const };

export function buildBrainTiles(d: BrainData): BrainTile[] {
  const active = d.memory.filter((m) => m.status === "active").length;
  const pending = d.memory.length - active;
  const running = d.plans?.filter((p) => p.status === "running").length ?? 0;
  const make = (id: TileId, title: string, icon: IconName, body: { value: string; sub: string; tone: BrainTile["tone"]; badge?: string }): BrainTile => ({ id, title, icon, ...body });
  const org = d.organizer ?? null;
  const openTodos = org ? org.notes.filter((n) => n.kind === "todo" && !n.done).length : 0;
  const active_ = org ? org.reminders.filter((r) => r.status !== "done") : [];
  const due = active_.filter((r) => r.status === "due").length;
  const next = active_.filter((r) => r.status === "scheduled").sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
  const q = d.quality ?? null;
  const tiles: BrainTile[] = [
    make("memory", "Память", "memory", { value: String(active), sub: "в памяти", tone: pending ? "warn" : "ok", ...(pending ? { badge: `${pending} ждут` } : {}) }),
    make("notes", "Заметки", "edit", org ? { value: String(openTodos), sub: openTodos ? plural(openTodos, ["дело", "дела", "дел"]) + " в списке" : org.notes.length ? "дел нет" : "пока пусто", tone: openTodos ? "ok" : "off" } : NA),
    make("reminders", "Напоминания", "clock", org ? { value: String(active_.length), sub: due ? `сработали: ${due}` : next ? "ближайшее " + whenShort(next.at) : "нет", tone: due ? "warn" : active_.length ? "ok" : "off", ...(due ? { badge: `${due} сейчас` } : {}) } : NA),
    make("plans", "Планы", "list", d.plans ? { value: String(d.plans.length), sub: running ? `${running} в работе` : d.plans.length ? "нет активных" : "пока нет", tone: running ? "ok" : "off" } : NA),
    make("learning", "Обучение", "spark", d.learning ? { value: `${d.learning.used}/${d.learning.limit}`, sub: d.learning.enabled ? "запросов сегодня" : "приостановлено", tone: d.learning.enabled ? "ok" : "off" } : NA),
    make("knowledge", "Знания", "book", d.knowledge === null ? NA : { value: String(d.knowledge), sub: "проверенных фактов", tone: "ok" }),
    make("graph", "Связи", "link", d.graph ? { value: String(d.graph.edges), sub: `${d.graph.nodes} ${plural(d.graph.nodes, ["узел", "узла", "узлов"])} в графе`, tone: "ok" } : NA),
    make("quality", "Качество", "circleCheck", q ? { value: q.totals.satisfaction === null ? "—" : q.totals.satisfaction + "%", sub: d.evalLast ? `проверка ${d.evalLast.passed} из ${d.evalLast.total}` : q.totals.rated ? `${q.totals.rated} ${plural(q.totals.rated, ["оценка", "оценки", "оценок"])}` : "нет оценок", tone: q.totals.satisfaction !== null && q.totals.satisfaction < 60 ? "warn" : q.totals.rated || d.evalLast ? "ok" : "off" } : NA),
    make("gaps", "Пробелы", "target", d.gaps === null ? NA : { value: String(d.gaps), sub: d.gaps ? "что изучить" : "пробелов нет", tone: d.gaps ? "warn" : "ok" }),
  ];
  return tiles.sort((a, b) => TILE_ORDER.indexOf(a.id) - TILE_ORDER.indexOf(b.id));
}
export function isTileId(v: unknown): v is TileId { return typeof v === "string" && (TILE_ORDER as string[]).includes(v); }
