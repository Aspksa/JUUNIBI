/**
 * «Дела и достижения»: 60 figures about the owner's own to-dos, notes, goals and the automation, the awards they bring,
 * the twelve tails, the records book, the surprise of the day, small discoveries and the time machine.
 * Everything is computed from the organizer (organizer.ts) on this computer; what was won is kept in
 * data/achievements.json, which updates never touch, so medals survive them.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AutoLogEntry, Mission, Note, Reminder, TaskEvent } from "./organizer";
import { ALL_TAILS_AWARD, EFFECTS, GROUPS, MEDALS, METRICS, REACTIONS, TAILS, TAIL_AWARD_TIER, TAIL_LEVELS, TAIL_PATTERNS, TIERS, TITLES, type MetricDef } from "./achievements-catalog";

const DAY = 86_400_000;
const p2 = (n: number) => String(n).padStart(2, "0");
/** The local calendar day of a moment, YYYY-MM-DD. */
export const dayKey = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const startOf = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
const ms = (iso?: string | null) => (iso ? Date.parse(iso) : NaN);
const days = (a: number) => Math.floor(a / DAY);
const ruDate = (t: number) => new Date(t).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
const ruShort = (t: number) => new Date(t).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
const hm = (t: number) => { const d = new Date(t); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const cut = (s: string, n = 48) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const q = (s: string) => `«${cut(s)}»`;
/** «5 дней», «1 день», «22 дня». */
export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100, b = a % 10;
  return forms[a > 10 && a < 20 ? 2 : b === 1 ? 0 : b >= 2 && b <= 4 ? 1 : 2]!;
}
const dn = (n: number) => `${n} ${plural(n, ["день", "дня", "дней"])}`;
const tn = (n: number) => `${n} ${plural(n, ["раз", "раза", "раз"])}`;
const dl = (n: number) => `${n} ${plural(n, ["дело", "дела", "дел"])}`;
const hoursText = (min: number) => min < 60 ? `${min} мин` : `${(Math.round(min / 6) / 10).toLocaleString("ru-RU")} ч`;
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const WEEKDAY_ON = ["по понедельникам", "по вторникам", "по средам", "по четвергам", "по пятницам", "по субботам", "по воскресеньям"];
const WEEKDAY_ACC = ["понедельник", "вторник", "среду", "четверг", "пятницу", "субботу", "воскресенье"];
const wd = (t: number) => (new Date(t).getDay() + 6) % 7;
const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const isDateOnly = (iso: string) => { const d = new Date(iso); return d.getHours() === 23 && d.getMinutes() === 59; };

/** One figure, ready for a tile: value, a line about it, the data of its small chart, and the score its award looks at. */
export interface MetricResult {
  id: string; n: number; group: string; emoji: string; title: string; hint: string;
  value: string; detail: string;
  kind?: "spark" | "line" | "split" | "dots" | "list"; series?: number[]; labels?: string[]; list?: string[]; ring?: number | undefined;
  /** Not enough data yet: the tile says «копим данные» and why. */
  ready: boolean;
  score: number;
  /** A number for the records book (higher is better), when this figure keeps records. */
  record?: number;
  /** For `repeat` awards: earned in this period now. */
  earned?: boolean;
}
export interface Input {
  now: number; notes: Note[]; reminders: Reminder[]; missions: Mission[]; history: TaskEvent[];
  autoCount: Partial<Record<AutoLogEntry["kind"], number>>;
  /** From the store: records set in the last seven days, awards in the book, and the very first done to-do. */
  recordsThisWeek: number; awardsInBook: { title: string; at: string }[]; first?: { text: string; at: string };
}

/** The direction (tail) of a to-do by its words, project and repeat; "" when none fits. */
export function directionOf(n: Pick<Note, "text" | "project" | "repeat">, missionTitles: Map<string, string> = new Map()): string {
  const text = n.text + " " + (n.project ? missionTitles.get(n.project) ?? n.project : "");
  for (const t of TAILS) if (t.words?.test(text)) return t.id;
  if (n.repeat) return "discipline";
  if (n.project) return "projects";
  return "";
}
/** Every direction a to-do counts for: its words, a repeat, a project, planning ahead. */
function directionsOf(n: Note, missionTitles: Map<string, string>): Set<string> {
  const text = n.text + " " + (n.project ? missionTitles.get(n.project) ?? n.project : "");
  const out = new Set<string>();
  for (const t of TAILS) if (t.words?.test(text)) out.add(t.id);
  if (n.repeat || (n.streak ?? 0) > 0) out.add("discipline");
  if (n.project || n.parentId) out.add("projects");
  if (n.dueAt && ms(n.dueAt) - ms(n.createdAt) >= DAY) out.add("planning");
  return out;
}

/** Shared views of the data that many figures need. */
function prepare(input: Input) {
  const { now } = input;
  const todos = input.notes.filter((n) => n.kind === "todo" && !n.auto);
  const notes = input.notes.filter((n) => n.kind === "note" && !n.auto);
  const done = todos.filter((n) => n.done && n.completedAt && Number.isFinite(ms(n.completedAt))).sort((a, b) => ms(a.completedAt) - ms(b.completedAt));
  const open = todos.filter((n) => !n.done);
  const ev = new Map<string, TaskEvent[]>();
  for (const e of input.history) (ev.get(e.id) ?? ev.set(e.id, []).get(e.id)!).push(e);
  const moves = (id: string) => (ev.get(id) ?? []).filter((e) => e.kind === "move" && e.from && e.to && ms(e.to) > ms(e.from)).length;
  const movesOf = (n: Note) => Math.max(moves(n.id), n.rolled ?? 0);
  /** Every moment something happened to a to-do or note, oldest first. */
  const activity = (n: Note) => [ms(n.createdAt), ...(ev.get(n.id) ?? []).map((e) => ms(e.at)), ...(n.completedAt ? [ms(n.completedAt)] : [])].filter(Number.isFinite).sort((a, b) => a - b);
  const children = new Map<string, Note[]>();
  for (const n of todos) if (n.parentId) (children.get(n.parentId) ?? children.set(n.parentId, []).get(n.parentId)!).push(n);
  const missionTitles = new Map(input.missions.map((m) => [m.id, m.title]));
  const goalSteps = new Map<string, Note[]>();
  for (const n of todos) if (n.project && missionTitles.has(n.project)) (goalSteps.get(n.project) ?? goalSteps.set(n.project, []).get(n.project)!).push(n);
  /** Projects: goals by id, and #tags of to-dos without a goal. */
  const projects = new Map<string, { name: string; items: Note[]; goal?: Mission }>();
  for (const g of input.missions) projects.set(g.id, { name: g.title, items: goalSteps.get(g.id) ?? [], goal: g });
  for (const n of todos) if (n.project && !missionTitles.has(n.project)) {
    const k = "#" + n.project.toLowerCase();
    (projects.get(k) ?? projects.set(k, { name: "#" + n.project, items: [] }).get(k)!).items.push(n);
  }
  const doneByDay = new Map<string, Note[]>();
  for (const n of done) { const k = dayKey(ms(n.completedAt)); (doneByDay.get(k) ?? doneByDay.set(k, []).get(k)!).push(n); }
  /** The day series ending today, oldest first. */
  const lastDays = (count: number) => Array.from({ length: count }, (_, i) => startOf(now) - (count - 1 - i) * DAY);
  const onTime = (n: Note) => !!n.dueAt && !!n.completedAt && ms(n.completedAt) < startOf(ms(n.dueAt)) + DAY;
  /** Overdue to-dos at the end of a past day, from the due dates as they were then (moves taken back). */
  const dueAt = (n: Note, t: number): number => {
    let due = ms(n.dueAt);
    for (const e of [...(ev.get(n.id) ?? [])].reverse()) if (e.kind === "move" && ms(e.at) > t) due = e.from ? ms(e.from) : NaN;
    return due;
  };
  const removedAt = new Map<string, number>();
  for (const e of input.history) if (e.kind === "remove") removedAt.set(e.id, ms(e.at));
  /** To-dos that were open at moment `t` (created, not yet done or removed). */
  const openAt = (t: number) => todos.filter((n) => ms(n.createdAt) <= t && (!n.done || !n.completedAt || ms(n.completedAt) > t))
    .length + input.history.filter((e) => e.kind === "remove" && e.todo && !e.from && ms(e.at) > t && firstSeen(e.id) <= t).length;
  const added = new Map<string, number>();
  for (const e of input.history) if (e.kind === "add" && !added.has(e.id)) added.set(e.id, ms(e.at));
  const firstSeen = (id: string) => added.get(id) ?? Infinity;
  const overdueAt = (t: number) => todos.filter((n) => ms(n.createdAt) <= t && (!n.done || !n.completedAt || ms(n.completedAt) > t) && dueAt(n, t) < t).length;
  return { ...input, todos, notes, done, open, ev, movesOf, activity, children, missionTitles, goalSteps, projects, doneByDay, lastDays, onTime, overdueAt, openAt, removedAt };
}
type Ctx = ReturnType<typeof prepare>;

const empty = (def: MetricDef, why: string): Partial<MetricResult> => ({ value: "—", detail: "Копим данные: " + why, ready: false, score: 0 });
const top = <T>(xs: T[], by: (x: T) => number, n = 5) => [...xs].sort((a, b) => by(b) - by(a)).slice(0, n);

/** The 60 figures. Each returns its tile; the award's score comes with it. */
const COMPUTE: Record<string, (c: Ctx, def: MetricDef) => Partial<MetricResult>> = {
  resurrect(c, d) {
    const gaps = c.todos.map((n) => { const a = c.activity(n); let g = 0; for (let i = 1; i < a.length; i++) g = Math.max(g, a[i]! - a[i - 1]!); return { n, g: days(g) }; }).filter((x) => x.g >= 1);
    if (!gaps.length) return empty(d, "нужно дело, к которому вернулись хотя бы через день");
    const best = top(gaps, (x) => x.g);
    return { value: dn(best[0]!.g), detail: q(best[0]!.n.text) + " ждало и вернулось", kind: "spark", series: best.map((x) => x.g), labels: best.map((x) => cut(x.n.text, 30)), ready: true, score: best[0]!.g, record: best[0]!.g };
  },
  blackhole(c, d) {
    const w = c.todos.filter((n) => n.estimateMinutes).map((n) => ({ n, w: n.estimateMinutes! * (1 + c.movesOf(n)) }));
    if (!w.length) return empty(d, "укажите оценку времени у дел (в редакторе дела)");
    const best = top(w, (x) => x.w);
    const doneBest = Math.max(0, ...w.filter((x) => x.n.done).map((x) => x.w));
    return { value: hoursText(best[0]!.w), detail: q(best[0]!.n.text) + ` · оценка ${hoursText(best[0]!.n.estimateMinutes!)}, переносов ${c.movesOf(best[0]!.n)}`, kind: "spark", series: best.map((x) => x.w), labels: best.map((x) => cut(x.n.text, 30)), ready: true, score: doneBest };
  },
  boomerang(c, d) {
    const r = c.todos.map((n) => ({ n, k: c.movesOf(n) + (c.ev.get(n.id) ?? []).filter((e) => e.kind === "undone").length })).filter((x) => x.k > 0);
    if (!r.length) return { value: "0", detail: "Ни одно дело ещё не возвращалось — всё делается с первого раза", ready: true, score: 0, kind: "spark", series: [0] };
    const best = top(r, (x) => x.k);
    return { value: tn(best[0]!.k), detail: q(best[0]!.n.text), kind: "spark", series: best.map((x) => x.k), labels: best.map((x) => cut(x.n.text, 30)), ready: true, score: best[0]!.k, record: best[0]!.k };
  },
  metamorph(c, d) {
    const ps = [...c.projects.values()].filter((p) => p.items.length);
    if (!ps.length) return empty(d, "добавьте цель или #проект к делам");
    const best = top(ps, (p) => p.items.length);
    return { value: dl(best[0]!.items.length), detail: best[0]!.name + ": столько дел выросло из одной мысли", kind: "spark", series: best.map((p) => p.items.length), labels: best.map((p) => p.name), ready: true, score: best[0]!.items.length };
  },
  magnet(c, d) {
    const r = c.todos.map((n) => ({ n, k: (c.ev.get(n.id) ?? []).filter((e) => e.kind !== "add").length })).filter((x) => x.k > 1);
    if (!r.length) return empty(d, "история действий ведётся с этого обновления");
    const best = top(r, (x) => x.k);
    return { value: tn(best[0]!.k), detail: q(best[0]!.n.text), kind: "spark", series: best.map((x) => x.k), labels: best.map((x) => cut(x.n.text, 30)), ready: true, score: best[0]!.k };
  },
  glacier(c, d) {
    const all = [...c.todos, ...c.notes].flatMap((n) => c.activity(n)).sort((a, b) => a - b);
    if (all.length < 2) return empty(d, "нужно хотя бы два действия в разные дни");
    let g = 0, at = 0;
    for (let i = 1; i < all.length; i++) if (all[i]! - all[i - 1]! > g) { g = all[i]! - all[i - 1]!; at = all[i - 1]!; }
    const gd = days(g);
    return { value: gd ? dn(gd) : "меньше дня", detail: gd ? `С ${ruDate(at)} по ${ruDate(at + g)}` : "Вы ни разу не пропадали надолго", ready: true, score: gd, kind: "dots", series: [gd] };
  },
  hardfoe(c, d) {
    const r = [
      ...c.todos.filter((n) => n.done && (c.children.get(n.id)?.length ?? 0) > 0).map((n) => ({ name: n.text, k: c.children.get(n.id)!.length })),
      ...c.missions.filter((m) => m.status === "complete").map((m) => ({ name: m.title, k: c.goalSteps.get(m.id)?.length ?? 0 })),
    ].filter((x) => x.k > 0);
    if (!r.length) return empty(d, "закончите дело с подзадачами или цель");
    const best = top(r, (x) => x.k);
    return { value: `${best[0]!.k} ${plural(best[0]!.k, ["этап", "этапа", "этапов"])}`, detail: q(best[0]!.name) + " побеждено", kind: "spark", series: best.map((x) => x.k), labels: best.map((x) => cut(x.name, 30)), ready: true, score: best[0]!.k, record: best[0]!.k };
  },
  deadline(c, d) {
    const saved = c.done.filter((n) => {
      if (!n.dueAt) return false;
      const due = ms(n.dueAt), at = ms(n.completedAt);
      return isDateOnly(n.dueAt) ? dayKey(at) === dayKey(due) && new Date(at).getHours() >= 18 : at <= due && due - at <= 2 * 3_600_000;
    });
    if (!c.done.some((n) => n.dueAt)) return empty(d, "нужны выполненные дела со сроком");
    const last = saved[saved.length - 1];
    return { value: String(saved.length), detail: last ? `Последний раз: ${q(last.text)}, ${ruShort(ms(last.completedAt))}` : "Пока всё делается с запасом", ready: true, score: saved.length, kind: "dots", series: [saved.length] };
  },
  octopus(c, d) {
    if (!c.done.length) return empty(d, "отметьте сделанным хотя бы одно дело");
    let best = 0, bestDay = "";
    for (const [k, v] of c.doneByDay) if (v.length > best) { best = v.length; bestDay = k; }
    const series = c.lastDays(14).map((t) => c.doneByDay.get(dayKey(t))?.length ?? 0);
    return { value: dl(best), detail: `Рекорд за день — ${ruDate(Date.parse(bestDay + "T12:00"))}`, kind: "spark", series, labels: c.lastDays(14).map(ruShort), ready: true, score: best, record: best };
  },
  breakthrough(c, d) {
    const ds = [...c.doneByDay.keys()].sort().map((k) => Date.parse(k + "T12:00"));
    const backs: { gap: number; at: number }[] = [];
    for (let i = 1; i < ds.length; i++) { const g = Math.round((ds[i]! - ds[i - 1]!) / DAY) - 1; if (g >= 3) backs.push({ gap: g, at: ds[i]! }); }
    if (ds.length < 2) return empty(d, "нужны выполненные дела в разные дни");
    const last = backs[backs.length - 1];
    return { value: String(backs.length), detail: last ? `Последний прорыв ${ruDate(last.at)} после ${dn(last.gap)} затишья` : "Затиший дольше трёх дней не было", kind: "spark", series: backs.slice(-8).map((b) => b.gap), labels: backs.slice(-8).map((b) => ruShort(b.at)), ready: true, score: backs.length };
  },
  bullseye(c, d) {
    const dated = c.done.filter((n) => n.dueAt);
    if (!dated.length) return empty(d, "нужны выполненные дела со сроком");
    const hit = dated.filter((n) => dayKey(ms(n.completedAt)) === dayKey(ms(n.dueAt)));
    return { value: String(hit.length), detail: `${Math.round((100 * hit.length) / dated.length)}% дел со сроком — точно в свой день`, ring: hit.length / dated.length, ready: true, score: hit.length };
  },
  farflight(c, d) {
    const r = [
      ...c.missions.filter((m) => m.status === "complete").map((m) => { const end = Math.max(ms(m.createdAt), ...(c.goalSteps.get(m.id) ?? []).map((n) => ms(n.completedAt)).filter(Number.isFinite)); return { name: m.title, k: days(end - ms(m.createdAt)) }; }),
      ...c.todos.filter((n) => n.done && c.children.get(n.id)?.length).map((n) => ({ name: n.text, k: days(ms(n.completedAt) - ms(n.createdAt)) })),
    ];
    if (!r.length) return empty(d, "достигните хотя бы одной цели");
    const best = top(r, (x) => x.k);
    return { value: dn(best[0]!.k), detail: q(best[0]!.name) + " — долетели", kind: "spark", series: best.map((x) => x.k), labels: best.map((x) => cut(x.name, 30)), ready: true, score: best[0]!.k, record: best[0]!.k };
  },
  predictor(c, d) {
    const series = c.lastDays(14).map((t) => c.doneByDay.get(dayKey(t))?.length ?? 0);
    const sum = series.reduce((a, b) => a + b, 0);
    if (!sum) return empty(d, "нужны выполненные дела за последние две недели");
    const rate = sum / 14, left = c.open.length;
    const eta = left ? Math.ceil(left / rate) : 0;
    const active = series.filter(Boolean).length;
    return { value: left ? `≈ ${dn(eta)}` : "всё сделано", detail: left ? `В таком темпе (${rate.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} в день) открытые ${dl(left)} закончатся к ${ruDate(c.now + eta * DAY)}` : "Открытых дел нет — прогноз не нужен", kind: "line", series, ready: true, score: active };
  },
  wave(c, d) {
    const weeks = Array.from({ length: 8 }, (_, i) => { const end = startOf(c.now) + DAY - (7 - i) * 7 * DAY; return c.done.filter((n) => ms(n.completedAt) >= end - 7 * DAY && ms(n.completedAt) < end).length; });
    if (!c.done.length) return empty(d, "нужны выполненные дела");
    let best = 0, bestAt = 0;
    for (const n of c.done) { const t = ms(n.completedAt); const k = c.done.filter((x) => ms(x.completedAt) > t - 7 * DAY && ms(x.completedAt) <= t).length; if (k > best) { best = k; bestAt = t; } }
    return { value: `${dl(best)} за неделю`, detail: `Самая высокая волна — неделя до ${ruDate(bestAt)}`, kind: "line", series: weeks, ready: true, score: best, record: best };
  },
  course(c, d) {
    const month = (t: number) => new Date(t).getFullYear() * 12 + new Date(t).getMonth();
    const cur = month(c.now);
    const by = (k: number) => { const m = new Map<string, number>(); for (const n of c.todos) if (month(ms(n.createdAt)) === k || (n.completedAt && month(ms(n.completedAt)) === k)) { const dir = directionOf(n, c.missionTitles) || "other"; m.set(dir, (m.get(dir) ?? 0) + 1); } return m; };
    const a = by(cur), b = by(cur - 1);
    const total = (x: Map<string, number>) => [...x.values()].reduce((s, v) => s + v, 0);
    const name = (id: string) => TAILS.find((t) => t.id === id)?.title ?? "Прочее";
    const parts = [...a].sort((x, y) => y[1] - x[1]);
    const touched = [...a.keys()].filter((k) => k !== "other").length;
    if (total(a) < 3) return empty(d, "нужно хотя бы 3 дела в этом месяце");
    if (total(b) < 3) return { value: name(parts[0]![0]), detail: "Главное направление месяца; сравнение с прошлым появится через месяц", kind: "split", series: parts.map((p) => p[1]), labels: parts.map((p) => name(p[0])), ready: true, score: touched };
    const shift = [...new Set([...a.keys(), ...b.keys()])].map((k) => ({ k, d: Math.round(100 * ((a.get(k) ?? 0) / total(a) - (b.get(k) ?? 0) / total(b))) })).sort((x, y) => y.d - x.d)[0]!;
    return { value: name(shift.k), detail: shift.d > 0 ? `Доля выросла на ${shift.d} п.п. по сравнению с прошлым месяцем` : "Курс прежний: доли направлений почти не изменились", kind: "split", series: parts.map((p) => p[1]), labels: parts.map((p) => name(p[0])), ready: true, score: touched };
  },
  rare(c, d) {
    const counts = [...c.doneByDay.values()].map((v) => v.length).sort((a, b) => a - b);
    if (counts.length < 5) return empty(d, "нужно хотя бы 5 дней с выполненными делами");
    const median = counts[Math.floor(counts.length / 2)]!;
    let best = 0, bestDay = "";
    for (const [k, v] of c.doneByDay) if (v.length > best) { best = v.length; bestDay = k; }
    const ratio = best / Math.max(1, median);
    return { value: `×${ratio.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}`, detail: `${ruDate(Date.parse(bestDay + "T12:00"))}: ${dl(best)} при обычных ${median}`, kind: "spark", series: counts.slice(-12), ready: true, score: Math.round(ratio * 10) };
  },
  tree(c, d) {
    const r = [
      ...c.todos.filter((n) => c.children.get(n.id)?.length).map((n) => ({ name: n.text, k: c.children.get(n.id)!.length })),
      ...c.missions.map((m) => ({ name: m.title, k: c.goalSteps.get(m.id)?.length ?? 0 })).filter((x) => x.k),
    ];
    if (!r.length) return empty(d, "разбейте дело на шаги («Разбить на шаги»)");
    const best = top(r, (x) => x.k);
    const all = [...c.children.values()].reduce((s, v) => s + v.length, 0) + [...c.goalSteps.values()].reduce((s, v) => s + v.length, 0);
    return { value: `${best[0]!.k} ${plural(best[0]!.k, ["ветка", "ветки", "веток"])}`, detail: `${q(best[0]!.name)}; всего шагов и подзадач: ${all}`, kind: "spark", series: best.map((x) => x.k), labels: best.map((x) => cut(x.name, 30)), ready: true, score: best[0]!.k };
  },
  dna(c, d) {
    if (c.done.length < 3) return empty(d, "нужно хотя бы 3 выполненных дела");
    const w = Array(7).fill(0) as number[], h = Array(24).fill(0) as number[];
    for (const n of c.done) { w[wd(ms(n.completedAt))]!++; h[new Date(ms(n.completedAt)).getHours()]!++; }
    const fav = w.indexOf(Math.max(...w)), hour = h.indexOf(Math.max(...h));
    return { value: WEEKDAYS[fav]!, detail: `Чаще всего дела закрываются ${WEEKDAY_ON[fav]}, около ${p2(hour)}:00`, kind: "spark", series: w, labels: WEEKDAYS, ready: true, score: w.filter(Boolean).length };
  },
  hours(c) {
    const W: Partial<Record<AutoLogEntry["kind"], number>> = { roll: 2, remind: 1, brief: 5, evening: 4, week: 8, quiet: 1, arrange: 6, move: 1, rule: 2 };
    const parts = Object.entries(c.autoCount).map(([k, v]) => ({ k, m: (W[k as AutoLogEntry["kind"]] ?? 1) * (v ?? 0) })).filter((x) => x.m > 0).sort((a, b) => b.m - a.m);
    const total = parts.reduce((s, p) => s + p.m, 0);
    const label: Record<string, string> = { roll: "перенос", remind: "сроки", brief: "сводки", evening: "итоги", week: "обзоры", quiet: "тишина", arrange: "раскладка", move: "переносы", rule: "правила" };
    return { value: total ? hoursText(total) : "0 мин", detail: total ? `Автоматика сделала за вас ${parts.reduce((s, p) => s + (c.autoCount[p.k as AutoLogEntry["kind"]] ?? 0), 0)} действий` : "Автоматика ещё не успела поработать — счёт идёт с этого обновления", kind: "split", series: parts.map((p) => p.m), labels: parts.map((p) => label[p.k] ?? p.k), ready: true, score: total, record: total };
  },
  backpack(c) {
    const est = c.open.reduce((s, n) => s + (n.estimateMinutes ?? 30), 0);
    const no = c.open.filter((n) => !n.estimateMinutes).length;
    const empty_ = !c.open.length && c.done.length >= 5;
    const byDir = new Map<string, number>();
    for (const n of c.open) { const k = TAILS.find((t) => t.id === directionOf(n, c.missionTitles))?.title ?? "Прочее"; byDir.set(k, (byDir.get(k) ?? 0) + (n.estimateMinutes ?? 30)); }
    const parts = [...byDir].sort((a, b) => b[1] - a[1]);
    return { value: c.open.length ? hoursText(est) : "пусто", detail: c.open.length ? `${dl(c.open.length)}` + (no ? `, без оценки ${no} (считаю по 30 мин)` : "") : "Рюкзак пуст — можно идти налегке", kind: "split", series: parts.map((p) => p[1]), labels: parts.map((p) => p[0]), ready: true, score: 0, earned: empty_ };
  },
  cost(c) {
    let sum = 0, k = 0;
    for (const e of c.history) if (e.kind === "move" && e.from && e.to && ms(e.to) > ms(e.from)) { sum += ms(e.to) - ms(e.from); k++; }
    const rolledOnly = c.todos.reduce((s, n) => s + Math.max(0, (n.rolled ?? 0) - (c.ev.get(n.id) ?? []).filter((e) => e.kind === "move" && e.auto).length), 0);
    const total = days(sum) + rolledOnly;
    const month = startOf(c.now) - (new Date(c.now).getDate() - 1) * DAY;
    const doneM = c.done.filter((n) => ms(n.completedAt) >= month);
    const movedM = doneM.filter((n) => c.movesOf(n) > 0).length;
    const earned = doneM.length >= 10 && movedM / doneM.length < 0.1;
    return { value: dn(total), detail: k + rolledOnly ? `${tn(k + rolledOnly)} дела сдвигались вперёд` : "Ни одного переноса — откладывать не приходилось", ring: doneM.length ? 1 - movedM / doneM.length : undefined, ready: true, score: 0, earned };
  },
  calm(c, d) {
    if (!c.todos.length) return empty(d, "добавьте дела со сроками");
    const series = c.lastDays(30).map((t) => { const end = t + DAY - 1; if (end > c.now) return c.overdueAt(c.now) === 0 ? 1 : 0; return c.overdueAt(end) === 0 && !c.todos.some((n) => n.priority === "high" && n.dueAt && dayKey(ms(n.dueAt)) === dayKey(t)) ? 1 : 0; });
    const k = series.filter(Boolean).length;
    return { value: dn(k), detail: series[series.length - 1] ? "Сегодня спокойный день: просрочек нет" : "Сегодня есть просрочки или срочное", kind: "spark", series, labels: c.lastDays(30).map(ruShort), ready: true, score: k };
  },
  early(c, d) {
    if (!c.done.length) return empty(d, "нужны выполненные дела");
    const shift = (t: number) => { const x = new Date(t); return ((x.getHours() * 60 + x.getMinutes()) - 300 + 1440) % 1440; };
    const best = [...c.done].sort((a, b) => shift(ms(a.completedAt)) - shift(ms(b.completedAt)))[0]!;
    const before8 = c.done.filter((n) => { const h = new Date(ms(n.completedAt)).getHours(); return h >= 5 && h < 8; }).length;
    const h = Array(24).fill(0) as number[];
    for (const n of c.done) h[new Date(ms(n.completedAt)).getHours()]!++;
    return { value: hm(ms(best.completedAt)), detail: `${q(best.text)}, ${ruDate(ms(best.completedAt))}; до 8 утра — ${before8}`, kind: "spark", series: h.slice(5, 13), labels: Array.from({ length: 8 }, (_, i) => `${i + 5}:00`), ready: true, score: before8 };
  },
  distance(c, d) {
    const r = [...c.projects.values()].filter((p) => p.items.length).map((p) => {
      const start = Math.min(...p.items.map((n) => ms(n.createdAt)), p.goal ? ms(p.goal.createdAt) : Infinity);
      const fin = p.items.filter((n) => n.completedAt).map((n) => ms(n.completedAt));
      const end = p.goal?.status === "active" || p.items.some((n) => !n.done) ? c.now : Math.max(start, ...fin);
      return { name: p.name, k: days(end - start) };
    });
    if (!r.length) return empty(d, "добавьте цель или #проект");
    const best = top(r, (x) => x.k);
    return { value: dn(best[0]!.k), detail: best[0]!.name, kind: "spark", series: best.map((x) => x.k), labels: best.map((x) => x.name), ready: true, score: best[0]!.k, record: best[0]!.k };
  },
  keeper(c, d) {
    if (!c.todos.some((n) => n.dueAt)) return empty(d, "нужны дела со сроком");
    const first = Math.min(...c.todos.map((n) => ms(n.createdAt)));
    const span = Math.min(120, days(c.now - startOf(first)) + 1);
    const series = c.lastDays(span).map((t) => (c.overdueAt(Math.min(c.now, t + DAY - 1)) === 0 ? 1 : 0));
    let cur = 0, best = 0, run = 0;
    for (const v of series) { run = v ? run + 1 : 0; best = Math.max(best, run); }
    cur = run;
    return { value: dn(cur), detail: `Без просрочек подряд; лучший отрезок — ${dn(best)}`, kind: "spark", series: series.slice(-21), ready: true, score: best, record: best };
  },
  tamer(c, d) {
    if (c.todos.length < 3) return empty(d, "нужна очередь хотя бы из трёх дел");
    const ends = c.lastDays(90).map((t) => Math.min(c.now, t + DAY - 1));
    const open = ends.map((t) => c.openAt(t));
    let best = 0;
    for (let i = 0; i < open.length; i++) for (let j = Math.max(0, i - 7); j < i; j++) best = Math.max(best, open[j]! - open[i]!);
    return { value: best ? `−${best}` : "0", detail: best ? `Очередь сократилась на ${dl(best)} за неделю` : "Очередь пока не сокращали", kind: "line", series: open.slice(-30), ready: true, score: best, record: best };
  },
  planner(c, d) {
    const dated = c.done.filter((n) => n.dueAt);
    if (!dated.length) return empty(d, "нужны выполненные дела со сроком");
    const ok = dated.filter(c.onTime);
    return { value: String(ok.length), detail: `${Math.round((100 * ok.length) / dated.length)}% дел со сроком сделано в срок`, ring: ok.length / dated.length, ready: true, score: ok.length };
  },
  horizon(c, d) {
    const r = [
      ...c.missions.filter((m) => m.status === "complete").map((m) => m.title),
      ...c.todos.filter((n) => n.done && (c.children.get(n.id)?.length ?? 0) >= 3 && ms(n.completedAt) - ms(n.createdAt) >= 14 * DAY).map((n) => n.text),
    ];
    if (!r.length && !c.missions.length) return empty(d, "поставьте цель в «Целях»");
    return { value: String(r.length), detail: r.length ? "Последняя: " + q(r[r.length - 1]!) : "Горизонт впереди: ни одна долгая цель ещё не достигнута", kind: "list", list: r.slice(-4).map((x) => "✓ " + cut(x, 40)), ready: true, score: r.length };
  },
  starweek(c) {
    return { value: String(c.recordsThisWeek), detail: c.recordsThisWeek ? "Рекордов за последние семь дней" : "На этой неделе рекорды ещё не падали", kind: "dots", series: [c.recordsThisWeek], ready: true, score: c.recordsThisWeek, record: c.recordsThisWeek };
  },
  architect(c, d) {
    const r = [
      ...c.missions.filter((m) => (c.goalSteps.get(m.id)?.length ?? 0) >= 3).map((m) => ({ name: m.title, k: c.goalSteps.get(m.id)!.length })),
      ...c.todos.filter((n) => (c.children.get(n.id)?.length ?? 0) >= 3).map((n) => ({ name: n.text, k: c.children.get(n.id)!.length })),
    ];
    if (!r.length) return empty(d, "разбейте большую цель хотя бы на три шага");
    return { value: String(r.length), detail: "Самый подробный план: " + q(top(r, (x) => x.k)[0]!.name), kind: "spark", series: top(r, (x) => x.k).map((x) => x.k), labels: top(r, (x) => x.k).map((x) => cut(x.name, 30)), ready: true, score: r.length };
  },
  lost(c, d) {
    const idle = c.open.map((n) => ({ n, k: days(c.now - c.activity(n).pop()!) }));
    const found = c.done.filter((n) => { const a = c.activity(n); return a.length >= 2 && a[a.length - 1]! - a[a.length - 2]! >= 30 * DAY; }).length;
    if (!idle.length) return { value: "нет", detail: "Затерянных дел нет — всё на виду", ready: true, score: found };
    const best = top(idle, (x) => x.k);
    return { value: dn(best[0]!.k), detail: q(best[0]!.n.text) + " давно не трогали", kind: "spark", series: best.map((x) => x.k), labels: best.map((x) => cut(x.n.text, 30)), ready: true, score: found };
  },
  link(c, d) {
    const r = [...c.goalSteps].map(([id, xs]) => ({ name: c.missionTitles.get(id)!, k: xs.length }));
    if (!r.length) return empty(d, "привяжите дела к цели");
    const best = top(r, (x) => x.k);
    return { value: dl(best[0]!.k), detail: "Связаны целью " + q(best[0]!.name), kind: "spark", series: best.map((x) => x.k), labels: best.map((x) => x.name), ready: true, score: best[0]!.k };
  },
  ray(c, d) {
    const hits: { name: string; at: number }[] = [];
    for (const p of c.projects.values()) {
      const t = p.items.flatMap((n) => c.activity(n)).concat(p.goal ? [ms(p.goal.createdAt)] : []).sort((a, b) => a - b);
      const doneT = new Set(p.items.filter((n) => n.completedAt).map((n) => ms(n.completedAt)));
      for (let i = 1; i < t.length; i++) if (t[i]! - t[i - 1]! >= 7 * DAY && doneT.has(t[i]!)) hits.push({ name: p.name, at: t[i]! });
    }
    if (!c.projects.size) return empty(d, "добавьте цель или #проект");
    hits.sort((a, b) => a.at - b.at);
    const last = hits[hits.length - 1];
    return { value: String(hits.length), detail: last ? `${last.name}: прогресс после простоя, ${ruDate(last.at)}` : "Застывших и оживших проектов пока не было", ready: true, score: hits.length, kind: "dots", series: [hits.length] };
  },
  letter(c, d) {
    const back = c.notes.filter((n) => (c.ev.get(n.id) ?? []).some((e) => e.kind === "edit" && ms(e.at) - ms(n.createdAt) >= 30 * DAY));
    const old = [...c.notes].sort((a, b) => ms(a.createdAt) - ms(b.createdAt))[0];
    if (!c.notes.length) return empty(d, "нужны заметки");
    return { value: String(back.length), detail: back.length ? "Последнее письмо: " + q(back[back.length - 1]!.text) : old ? `Самая старая заметка ждёт с ${ruDate(ms(old.createdAt))}: ${q(old.text)}` : "", ready: true, score: back.length, kind: "dots", series: [back.length] };
  },
  trap(c, d) {
    const small = c.todos.filter((n) => (n.estimateMinutes ?? 30) <= 30).map((n) => ({ n, k: c.movesOf(n) })).filter((x) => x.k >= 2);
    const escaped = c.done.filter((n) => (n.estimateMinutes ?? 30) <= 30 && c.movesOf(n) >= 3).length;
    if (!small.length) return { value: "нет", detail: "Маленькие дела не застревают", ready: true, score: escaped };
    const best = top(small, (x) => x.k);
    return { value: tn(best[0]!.k), detail: q(best[0]!.n.text) + ` — на ${hoursText(best[0]!.n.estimateMinutes ?? 30)}, а переносилось`, kind: "spark", series: best.map((x) => x.k), labels: best.map((x) => cut(x.n.text, 30)), ready: true, score: escaped };
  },
  key(c, d) {
    const r = c.todos.filter((n) => n.done && (c.children.get(n.id)?.length ?? 0) >= 2).map((n) => ({ name: n.text, k: c.children.get(n.id)!.length }));
    if (!c.children.size) return empty(d, "нужны дела с подзадачами");
    const best = top(r, (x) => x.k);
    return { value: String(r.length), detail: best[0] ? `${q(best[0].name)} открыло путь ${best[0].k} подзадачам` : "Ключевые дела с подзадачами ещё впереди", kind: "spark", series: best.map((x) => x.k), labels: best.map((x) => cut(x.name, 30)), ready: true, score: r.length };
  },
  planet(c, d) {
    const act = [...c.projects.values()].filter((p) => (p.goal ? p.goal.status === "active" : p.items.some((n) => !n.done)));
    if (!act.length) return empty(d, "нет активных целей и #проектов");
    const parts = top(act, (p) => p.items.filter((n) => !n.done).length, 6);
    return { value: `${act.length} ${plural(act.length, ["проект", "проекта", "проектов"])}`, detail: `В них открытых дел: ${act.reduce((s, p) => s + p.items.filter((n) => !n.done).length, 0)}`, kind: "split", series: parts.map((p) => p.items.filter((n) => !n.done).length || 1), labels: parts.map((p) => p.name), ready: true, score: act.length };
  },
  launch(c, d) {
    const r = [...c.projects.values()].map((p) => ({ name: p.name, at: Math.min(...p.items.filter((n) => n.completedAt).map((n) => ms(n.completedAt))) })).filter((x) => Number.isFinite(x.at)).sort((a, b) => a.at - b.at);
    if (!c.projects.size) return empty(d, "добавьте цель или #проект");
    const last = r[r.length - 1];
    return { value: String(r.length), detail: last ? `${last.name}: первый шаг ${ruDate(last.at)}` : "Ни один проект ещё не сделал первого шага", ready: true, score: r.length, kind: "dots", series: [r.length] };
  },
  galaxy(c, d) {
    if (!c.open.length) return empty(d, "нет открытых дел");
    const goals = new Set(c.open.filter((n) => n.project && c.missionTitles.has(n.project)).map((n) => n.project));
    const tied = c.open.filter((n) => n.project || n.parentId).length;
    return { value: `${goals.size} ${plural(goals.size, ["цель", "цели", "целей"])}`, detail: `${Math.round((100 * tied) / c.open.length)}% открытых дел связаны с целью или проектом`, ring: tied / c.open.length, ready: true, score: goals.size };
  },
  comet(c, d) {
    const t = [...c.todos, ...c.notes].map((n) => ms(n.createdAt)).sort((a, b) => a - b);
    if (!t.length) return empty(d, "нужны записи");
    let best = 0, at = 0;
    for (let i = 0, j = 0; i < t.length; i++) { while (t[i]! - t[j]! > 3 * DAY) j++; if (i - j + 1 > best) { best = i - j + 1; at = t[i]!; } }
    const weeks = Array.from({ length: 8 }, (_, i) => { const end = startOf(c.now) + DAY - (7 - i) * 7 * DAY; return t.filter((x) => x >= end - 7 * DAY && x < end).length; });
    return { value: `${best} ${plural(best, ["идея", "идеи", "идей"])}`, detail: `Самый яркий хвост — три дня до ${ruDate(at)}`, kind: "line", series: weeks, ready: true, score: best, record: best };
  },
  signal(c, d) {
    const n = new Date(c.now), from = new Date(n.getFullYear(), n.getMonth() + 1, 1).getTime(), to = new Date(n.getFullYear(), n.getMonth() + 2, 1).getTime();
    const next = c.open.filter((x) => x.dueAt && ms(x.dueAt) >= from && ms(x.dueAt) < to).sort((a, b) => Number(b.priority === "high") - Number(a.priority === "high") || ms(a.dueAt) - ms(b.dueAt))[0];
    const far = c.todos.filter((x) => x.dueAt && ms(x.dueAt) - ms(x.createdAt) >= 30 * DAY).length;
    if (!next) return { value: "тишина", detail: "На следующий месяц дел со сроком пока нет", ready: true, score: far };
    return { value: ruShort(ms(next.dueAt)), detail: (next.priority === "high" ? "⚑ " : "") + q(next.text), ready: true, score: far };
  },
  dark(c, d) {
    const act = [...c.projects.values()].filter((p) => (p.goal ? p.goal.status === "active" : p.items.some((n) => !n.done)));
    if (!act.length) return empty(d, "нет активных целей и #проектов");
    const idle = act.map((p) => ({ name: p.name, k: days(c.now - Math.max(p.goal ? ms(p.goal.createdAt) : 0, ...p.items.flatMap((n) => c.activity(n)))) })).filter((x) => x.k >= 14);
    return { value: String(idle.length), detail: idle.length ? "Давно без внимания: " + idle.slice(0, 2).map((x) => `${x.name} (${dn(x.k)})`).join(", ") : "Все проекты на светлой стороне", kind: "list", list: idle.slice(0, 4).map((x) => "· " + cut(x.name, 30) + " — " + dn(x.k)), ready: true, score: 0, earned: act.length >= 1 && !idle.length };
  },
  ears(c, d) {
    const heard = c.done.filter((n) => n.remindedFor && n.dueAt && ms(n.completedAt) <= ms(n.dueAt)).length;
    const asked = c.autoCount.remind ?? 0;
    if (!asked && !heard) return empty(d, "напоминания о сроке появятся, когда срок будет близко");
    return { value: String(heard), detail: `Напоминаний о сроке: ${asked}; после них сделано вовремя — ${heard}`, ring: asked ? Math.min(1, heard / asked) : undefined, ready: true, score: heard };
  },
  tracks(c, d) {
    const g = top([...c.goalSteps], ([, xs]) => xs.filter((n) => n.done).length, 1)[0];
    if (!g) return empty(d, "привяжите шаги к цели");
    const steps = g[1].filter((n) => n.completedAt).sort((a, b) => ms(a.completedAt) - ms(b.completedAt));
    return { value: `${steps.length} ${plural(steps.length, ["шаг", "шага", "шагов"])}`, detail: "К цели " + q(c.missionTitles.get(g[0])!), kind: "list", list: steps.slice(-5).map((n) => `✓ ${ruShort(ms(n.completedAt))} ${cut(n.text, 32)}`), ready: true, score: steps.length, record: steps.length };
  },
  twelve(c) {
    const t = tailsOf(c);
    // a direction counts once it has three done to-dos, so one stray word does not light a tail
    const lit = t.filter((x) => x.done >= 3).length;
    return { value: `${lit} из 12`, detail: lit ? "Направления: " + t.filter((x) => x.done >= 3).slice(0, 4).map((x) => x.title.toLowerCase()).join(", ") + (lit > 4 ? "…" : "") : "Ни одно направление ещё не набрало трёх дел", ring: lit / 12, ready: true, score: lit };
  },
  dropped(c, d) {
    const gone = c.history.filter((e) => e.kind === "remove" && e.todo && !e.from);
    if (!c.history.length) return empty(d, "история ведётся с этого обновления");
    return { value: String(gone.length), detail: gone.length ? "Последний сброшенный: " + q(gone[gone.length - 1]!.text) : "Ненужных дел пока не убирали", ready: true, score: gone.length, kind: "dots", series: [gone.length] };
  },
  bloom(c, d) {
    if (!c.notes.length) return empty(d, "нужны заметки с идеями");
    const words = (s: string) => new Set(s.toLowerCase().split(/[^а-яёa-z0-9]+/).filter((w) => w.length >= 4).map((w) => w.slice(0, 6)));
    const grown = c.notes.filter((n) => { const a = words(n.text); return c.todos.some((t) => ms(t.createdAt) >= ms(n.createdAt) && [...words(t.text)].filter((w) => a.has(w)).length >= Math.min(2, a.size)); });
    return { value: String(grown.length), detail: `${Math.round((100 * grown.length) / c.notes.length)}% заметок превратились в дела`, ring: grown.length / c.notes.length, ready: true, score: grown.length };
  },
  light(c, d) {
    const act = c.missions.filter((m) => m.status === "active");
    const stalled = c.missions.filter((m) => m.status === "complete" && (() => { const t = (c.goalSteps.get(m.id) ?? []).flatMap((n) => c.activity(n)).concat([ms(m.createdAt)]).sort((a, b) => a - b); return t.some((x, i) => i > 0 && x - t[i - 1]! >= 7 * DAY); })()).length;
    if (!c.missions.length) return empty(d, "поставьте цель");
    const lights = act.map((m) => { const xs = (c.goalSteps.get(m.id) ?? []); const last = Math.max(ms(m.createdAt), ...xs.flatMap((n) => c.activity(n))); const next = xs.filter((n) => !n.done).sort((a, b) => (a.dueAt ?? "9").localeCompare(b.dueAt ?? "9"))[0]; return { m, idle: days(c.now - last), next }; }).filter((x) => x.idle >= 3 && x.next);
    return { value: String(lights.length), detail: lights[0] ? `${q(lights[0].m.title)} стоит ${dn(lights[0].idle)} — следующий шаг: ${q(lights[0].next!.text)}` : "Застрявших целей нет, всем светло", kind: "list", list: lights.slice(0, 3).map((x) => "🏮 " + cut(x.m.title, 20) + " → " + cut(x.next!.text, 24)), ready: true, score: stalled };
  },
  twist(c, d) {
    if (!c.history.length) return empty(d, "история ведётся с этого обновления");
    const k = c.done.filter((n) => (c.ev.get(n.id) ?? []).some((e) => e.kind === "edit" && ms(e.at) < ms(n.completedAt))).length;
    return { value: String(k), detail: k ? "Дел, изменённых по ходу и всё равно сделанных" : "Пока всё делается ровно как задумано", ready: true, score: k, kind: "dots", series: [k] };
  },
  chain(c, d) {
    if (c.done.length < 2) return empty(d, "нужно хотя бы два выполненных дела");
    let best = 1, run = 1, at = 0;
    for (let i = 1; i < c.done.length; i++) { run = ms(c.done[i]!.completedAt) - ms(c.done[i - 1]!.completedAt) <= 20 * 60_000 ? run + 1 : 1; if (run > best) { best = run; at = ms(c.done[i]!.completedAt); } }
    return { value: `${best} подряд`, detail: best > 1 ? `Дела падали как домино ${ruDate(at)}` : "Цепочек пока не было", ready: true, score: best, record: best, kind: "dots", series: [best] };
  },
  roles(c, d) {
    if (!c.done.length) return empty(d, "нужны выполненные дела");
    let best = 0, bestDay = "";
    for (const [k, v] of c.doneByDay) { const s = new Set(v.map((n) => directionOf(n, c.missionTitles)).filter(Boolean)).size; if (s > best) { best = s; bestDay = k; } }
    const series = c.lastDays(14).map((t) => new Set((c.doneByDay.get(dayKey(t)) ?? []).map((n) => directionOf(n, c.missionTitles)).filter(Boolean)).size);
    return { value: `${best} ${plural(best, ["роль", "роли", "ролей"])}`, detail: best ? `Больше всего ролей — ${ruDate(Date.parse(bestDay + "T12:00"))}` : "Направления дел пока не распознаны", kind: "spark", series, ready: true, score: best, record: best };
  },
  steps(c, d) {
    const r = [...[...c.goalSteps].map(([id, xs]) => ({ name: c.missionTitles.get(id)!, xs })), ...[...c.children].map(([id, xs]) => ({ name: c.todos.find((n) => n.id === id)?.text ?? "", xs }))]
      .map((x) => ({ name: x.name, k: new Set(x.xs.filter((n) => n.completedAt).map((n) => dayKey(ms(n.completedAt)))).size })).filter((x) => x.name);
    if (!r.length) return empty(d, "нужна цель или дело с шагами");
    const best = top(r, (x) => x.k);
    return { value: dn(best[0]!.k), detail: q(best[0]!.name) + ": по шагу за раз", kind: "spark", series: best.map((x) => x.k), labels: best.map((x) => cut(x.name, 30)), ready: true, score: best[0]!.k, record: best[0]!.k };
  },
  route(c, d) {
    const chains = [...[...c.goalSteps].filter(([id]) => c.missions.find((m) => m.id === id)?.status === "complete").map(([, xs]) => xs), ...[...c.children].filter(([id]) => c.todos.find((n) => n.id === id)?.done).map(([, xs]) => xs)].filter((xs) => xs.length >= 3);
    if (!chains.length) return empty(d, "закончите цепочку хотя бы из трёх шагов");
    const ok = chains.filter((xs) => { const s = [...xs].sort((a, b) => ms(a.createdAt) - ms(b.createdAt)); return s.every((n, i) => n.done && (!i || ms(n.completedAt) >= ms(s[i - 1]!.completedAt))); });
    return { value: `${ok.length} из ${chains.length}`, detail: "Цепочек, пройденных строго по порядку", ring: ok.length / chains.length, ready: true, score: ok.length };
  },
  rescue(c, d) {
    const hi = c.done.filter((n) => n.priority === "high" && n.dueAt);
    if (!hi.length) return empty(d, "нужны важные (⚑) дела со сроком");
    const ok = hi.filter((n) => ms(n.completedAt) <= ms(n.dueAt));
    return { value: String(ok.length), detail: `${Math.round((100 * ok.length) / hi.length)}% важных дел спасены до срока`, ring: ok.length / hi.length, ready: true, score: ok.length };
  },
  moment(c) {
    const b = c.awardsInBook;
    return { value: `${b.length} ${plural(b.length, ["награда", "награды", "наград"])}`, detail: b.length ? "Каждая сохранена с датой" : "Первая награда ещё впереди", kind: "list", list: b.slice(-3).reverse().map((x) => `✓ ${ruShort(ms(x.at))} ${cut(x.title, 30)}`), ready: true, score: b.length };
  },
  firstpage(c, d) {
    const f = c.first ?? (c.done[0] ? { text: c.done[0].text, at: c.done[0].completedAt! } : undefined);
    if (!f) return empty(d, "отметьте сделанным первое дело");
    return { value: ruShort(ms(f.at)), detail: q(f.text) + `, ${new Date(ms(f.at)).getFullYear()}`, ready: true, score: 1 };
  },
  journey(c, d) {
    const y = new Date(c.now).getFullYear();
    const months = Array(12).fill(0) as number[];
    for (const n of c.todos) if (n.project && c.missionTitles.has(n.project)) for (const t of [ms(n.createdAt), ms(n.completedAt)]) if (Number.isFinite(t) && new Date(t).getFullYear() === y) months[new Date(t).getMonth()]!++;
    for (const m of c.missions) if (new Date(ms(m.createdAt)).getFullYear() === y) months[new Date(ms(m.createdAt)).getMonth()]!++;
    if (!c.missions.length) return empty(d, "поставьте цель");
    const active = months.filter(Boolean).length;
    return { value: `${active} ${plural(active, ["месяц", "месяца", "месяцев"])}`, detail: `Цели двигались в ${y} году; целей всего: ${c.missions.length}`, kind: "spark", series: months, labels: MONTHS, ready: true, score: active };
  },
  message(c, d) {
    const act = c.missions.filter((m) => m.status === "active").sort((a, b) => ms(a.createdAt) - ms(b.createdAt))[0];
    const won = c.missions.filter((m) => m.status === "complete" && c.now - ms(m.createdAt) >= 60 * DAY).length;
    if (!act) return c.missions.length ? { value: "—", detail: "Активных целей нет", ready: true, score: won } : empty(d, "поставьте цель");
    return { value: dn(days(c.now - ms(act.createdAt))), detail: `Цель ${q(act.title)} записана ${ruDate(ms(act.createdAt))}`, ready: true, score: won };
  },
  mirror(c, d) {
    const n = new Date(c.now), dom = n.getDate();
    const cur0 = new Date(n.getFullYear(), n.getMonth(), 1).getTime(), prev0 = new Date(n.getFullYear(), n.getMonth() - 1, 1).getTime();
    const prevEnd = Math.min(new Date(n.getFullYear(), n.getMonth(), 1).getTime(), prev0 + dom * DAY);
    const cur = c.done.filter((x) => ms(x.completedAt) >= cur0).length, prev = c.done.filter((x) => ms(x.completedAt) >= prev0 && ms(x.completedAt) < prevEnd).length;
    if (!cur && !prev) return empty(d, "нужны выполненные дела в этом или прошлом месяце");
    const delta = prev ? Math.round((100 * (cur - prev)) / prev) : 100;
    return { value: prev ? (delta >= 0 ? "+" : "−") + Math.abs(delta) + "%" : `${cur}`, detail: `За ${dom} ${plural(dom, ["день", "дня", "дней"])} месяца: ${cur}, в прошлом месяце за то же время: ${prev}`, kind: "spark", series: [prev, cur], labels: ["прошлый", "этот"], ready: true, score: 0, earned: prev > 0 && cur > prev };
  },
  legend(c, d) {
    const y = new Date(c.now).getFullYear();
    const sig = (n: Note) => 3 * (c.children.get(n.id)?.length ?? 0) + (n.estimateMinutes ?? 0) / 30 + (n.priority === "high" ? 4 : 0) + Math.min(60, days(ms(n.completedAt) - ms(n.createdAt))) / 10 + c.movesOf(n) / 2;
    const cands = [
      ...c.done.filter((n) => new Date(ms(n.completedAt)).getFullYear() === y).map((n) => ({ name: n.text, s: sig(n) })),
      ...c.missions.filter((m) => m.status === "complete").map((m) => ({ name: m.title, s: 10 + 2 * (c.goalSteps.get(m.id)?.length ?? 0) })),
    ];
    if (!cands.length) return empty(d, "нужны выполненные дела этого года");
    const best = top(cands, (x) => x.s)[0]!;
    const goalMax = Math.max(0, ...c.missions.filter((m) => m.status === "complete").map((m) => c.goalSteps.get(m.id)?.length ?? 0));
    return { value: cut(best.name, 28), detail: "По этапам, важности, оценке, сроку жизни и переносам", ready: true, score: goalMax };
  },
};

/** The twelve tails: done to-dos in each direction, the level of its pattern and the next step. */
export function tailsOf(c: Ctx) {
  const k = new Map<string, number>(TAILS.map((t) => [t.id, 0]));
  for (const n of c.done) for (const d of directionsOf(n, c.missionTitles)) k.set(d, (k.get(d) ?? 0) + 1);
  k.set("order", (k.get("order") ?? 0) + c.history.filter((e) => e.kind === "remove" && e.todo && !e.from).length);
  return TAILS.map((t) => {
    const done = k.get(t.id) ?? 0;
    const level = TAIL_LEVELS.filter((x) => done >= x).length;
    const next = TAIL_LEVELS[level];
    return { id: t.id, emoji: t.emoji, title: t.title, done, level, pattern: TAIL_PATTERNS[level]!, next: next ?? null, progress: next ? (done - (TAIL_LEVELS[level - 1] ?? 0)) / (next - (TAIL_LEVELS[level - 1] ?? 0)) : 1 };
  });
}

/** The level (0–4) an award has with this score or with this many periods. */
export function levelFor(def: MetricDef, score: number): number { return def.levels.filter((x) => score >= x).length; }

/** All 60 figures. */
export function computeMetrics(input: Input): { metrics: MetricResult[]; tails: ReturnType<typeof tailsOf>; ctx: Ctx } {
  const c = prepare(input);
  const metrics = METRICS.map((def) => {
    let r: Partial<MetricResult>;
    try { r = COMPUTE[def.id]!(c, def); } catch { r = empty(def, "не удалось посчитать"); }
    return { id: def.id, n: def.n, group: def.group, emoji: def.emoji, title: def.title, hint: def.hint, value: "—", detail: "", ready: false, score: 0, ...r } as MetricResult;
  });
  return { metrics, tails: tailsOf(c), ctx: c };
}

/**
 * «Маленькие открытия»: patterns in when and how things get done. Observations, not judgements;
 * each needs enough to-dos behind it.
 */
export function discoveries(c: Ctx): string[] {
  const out: { text: string; w: number }[] = [];
  const weeks = Math.max(1, Math.ceil((c.now - Math.min(c.now, ...c.done.map((n) => ms(n.completedAt)))) / (7 * DAY)));
  const byDir = new Map<string, number[]>();
  for (const n of c.done) { const d = directionOf(n, c.missionTitles); if (!d) continue; (byDir.get(d) ?? byDir.set(d, Array(7).fill(0)).get(d)!)[wd(ms(n.completedAt))]!++; }
  for (const [d, w] of byDir) {
    const total = w.reduce((a, b) => a + b, 0);
    if (total < 5) continue;
    const hi = w.indexOf(Math.max(...w)), lo = w.indexOf(Math.min(...w.slice(0, 5)));
    if (w[hi]! - w[lo]! >= 2 && w[hi]! >= 2 * Math.max(1, w[lo]!)) out.push({ text: `${WEEKDAY_ON[hi]![0]!.toUpperCase() + WEEKDAY_ON[hi]!.slice(1)} вы чаще завершаете дела направления «${TAILS.find((t) => t.id === d)!.title}», чем ${WEEKDAY_ON[lo]}.`, w: w[hi]! - w[lo]! });
  }
  const hi = c.done.filter((n) => n.priority === "high"), rest = c.done.filter((n) => n.priority !== "high");
  const morning = (xs: Note[]) => xs.filter((n) => new Date(ms(n.completedAt)).getHours() < 13).length / Math.max(1, xs.length);
  if (hi.length >= 4 && rest.length >= 4 && Math.abs(morning(hi) - morning(rest)) >= 0.2) out.push({ text: `Важные дела вы чаще закрываете ${morning(hi) > morning(rest) ? "до обеда" : "после обеда"}, чем обычные (${Math.round(100 * morning(hi))}% против ${Math.round(100 * morning(rest))}%).`, w: 3 });
  const est = c.done.filter((n) => n.dueAt && n.estimateMinutes), noEst = c.done.filter((n) => n.dueAt && !n.estimateMinutes);
  const share = (xs: Note[]) => xs.filter(c.onTime).length / Math.max(1, xs.length);
  if (est.length >= 4 && noEst.length >= 4 && Math.abs(share(est) - share(noEst)) >= 0.15) out.push({ text: `Дела с оценкой времени ${share(est) > share(noEst) ? "чаще" : "реже"} успевают в срок: ${Math.round(100 * share(est))}% против ${Math.round(100 * share(noEst))}% без оценки.`, w: 2 });
  const life = (xs: Note[]) => { const v = xs.map((n) => ms(n.completedAt) - ms(n.createdAt)).sort((a, b) => a - b); return v[Math.floor(v.length / 2)] ?? 0; };
  const am = c.done.filter((n) => new Date(ms(n.createdAt)).getHours() < 12), pm = c.done.filter((n) => new Date(ms(n.createdAt)).getHours() >= 12);
  if (am.length >= 4 && pm.length >= 4 && Math.abs(life(am) - life(pm)) >= DAY) out.push({ text: `Дела, записанные ${life(am) < life(pm) ? "утром" : "после полудня"}, закрываются быстрее: обычно за ${dn(Math.max(0, days(Math.min(life(am), life(pm)))))} против ${dn(days(Math.max(life(am), life(pm))))}.`, w: 2 });
  const wk = Array(7).fill(0) as number[];
  for (const n of c.done) wk[wd(ms(n.completedAt))]!++;
  if (c.done.length >= 10) { const we = wk[5]! + wk[6]!, wdays = wk.slice(0, 5).reduce((a, b) => a + b, 0); out.push({ text: we / 2 > wdays / 5 ? "В выходные вы успеваете больше, чем в будни, — в среднем за день." : `В будни вы закрываете в среднем ${(wdays / 5 / weeks).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} дела в день, в выходные — ${(we / 2 / weeks).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}.`, w: 1 }); }
  return out.sort((a, b) => b.w - a.w).slice(0, 4).map((x) => x.text);
}

/** Candidates for «Сюрприз дня», the most unusual first. */
export function surprises(c: Ctx, metrics: MetricResult[], recordsToday: string[]): { text: string; emoji: string }[] {
  const out: { text: string; emoji: string; w: number }[] = [];
  const n = new Date(c.now), month0 = new Date(n.getFullYear(), n.getMonth(), 1).getTime();
  for (const r of recordsToday) out.push({ emoji: "🏆", text: `Сегодня побит личный рекорд «${r}».`, w: 10 });
  for (let w = 0; w < 7; w++) {
    const due = c.todos.filter((x) => x.dueAt && ms(x.dueAt) >= month0 && ms(x.dueAt) < startOf(c.now) && wd(ms(x.dueAt)) === w);
    if (due.length >= 2 && due.every((x) => x.done)) out.push({ emoji: "📅", text: `В этом месяце завершены все дела, назначенные на ${WEEKDAY_ACC[w]} (${due.length}).`, w: 7 });
  }
  const today = c.doneByDay.get(dayKey(c.now))?.length ?? 0;
  const lastWeek = c.done.filter((x) => ms(x.completedAt) >= startOf(c.now) - 7 * DAY && ms(x.completedAt) < startOf(c.now)).length;
  if (today >= 3 && today > lastWeek) out.push({ emoji: "⚡", text: `Сегодня сделано больше (${today}), чем за всю прошлую неделю (${lastWeek}).`, w: 8 });
  const milestones = [10, 25, 50, 100, 200, 300, 500, 750, 1000, 1500, 2000];
  const total = c.done.length, ms_ = [...milestones].reverse().find((x) => total >= x);
  if (ms_ && total - ms_ < 5) out.push({ emoji: "🎯", text: `Всего выполнено ${dl(total)} — позади отметка ${ms_}.`, w: 6 });
  const patient = c.done.filter((x) => dayKey(ms(x.completedAt)) === dayKey(c.now)).map((x) => ({ x, d: days(ms(x.completedAt) - ms(x.createdAt)) })).sort((a, b) => b.d - a.d)[0];
  if (patient && patient.d >= 7) out.push({ emoji: "🧟", text: `Сегодня закрыто дело, которое ждало ${dn(patient.d)}: ${q(patient.x.text)}.`, w: 9 });
  const streak = c.todos.filter((x) => x.repeat && (x.streak ?? 0) >= 5).sort((a, b) => (b.streak ?? 0) - (a.streak ?? 0))[0];
  if (streak) out.push({ emoji: "🔥", text: `Серия ${q(streak.text)} — ${streak.streak} раз подряд без пропусков.`, w: 5 });
  const early = metrics.find((m) => m.id === "early");
  if (early?.ready) out.push({ emoji: "🌅", text: `Самое раннее завершённое дело было в ${early.value}. ${early.detail.split(";")[0]}.`, w: 2 });
  const dna = metrics.find((m) => m.id === "dna");
  if (dna?.ready) out.push({ emoji: "🧬", text: dna.detail + ".", w: 2 });
  const old = c.open.map((x) => ({ x, d: days(c.now - ms(x.createdAt)) })).sort((a, b) => b.d - a.d)[0];
  if (old && old.d >= 14) out.push({ emoji: "🕵️", text: `Самое давнее открытое дело ${q(old.x.text)} ждёт уже ${dn(old.d)}.`, w: 3 });
  const glacier = metrics.find((m) => m.id === "glacier");
  if (glacier?.ready && glacier.score >= 3) out.push({ emoji: "🧊", text: `Самая долгая пауза в делах — ${glacier.value}. ${glacier.detail}.`, w: 1 });
  return out.sort((a, b) => b.w - a.w).map(({ text, emoji }) => ({ text, emoji }));
}

/** «Машина времени»: what happened on a past day, in order, and a short story of it. */
export function dayStory(input: Input, day: string, book: { title: string; at: string; tier: number }[], notices: { at: string; text: string }[]) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw Object.assign(new Error("День: YYYY-MM-DD"), { status: 400 });
  const c = prepare(input);
  const from = new Date(day + "T00:00").getTime(), to = from + DAY;
  const inDay = (t: number) => t >= from && t < to;
  type Line = { at: string; kind: "add" | "done" | "move" | "remove" | "edit" | "undone" | "note" | "award" | "notice"; text: string };
  const lines: Line[] = [];
  const seenAdd = new Set<string>();
  for (const e of c.history) {
    if (!inDay(ms(e.at))) continue;
    if (e.kind === "add") seenAdd.add(e.id);
    if (e.kind === "move" && !e.from) continue; // a first date is not a move
    if (e.kind === "move") lines.push({ at: e.at, kind: "move", text: `${q(e.text)} → ${e.to ? ruShort(ms(e.to)) : "без срока"}${e.auto ? " (автоматика)" : ""}` });
    else lines.push({ at: e.at, kind: e.kind === "add" && !e.todo ? "note" : e.kind, text: q(e.text) });
  }
  for (const n of [...c.todos, ...c.notes]) {
    if (inDay(ms(n.createdAt)) && !seenAdd.has(n.id)) lines.push({ at: n.createdAt, kind: n.kind === "note" ? "note" : "add", text: q(n.text) });
    if (n.completedAt && inDay(ms(n.completedAt)) && !c.history.some((e) => e.id === n.id && e.kind === "done" && inDay(ms(e.at)))) lines.push({ at: n.completedAt, kind: "done", text: q(n.text) });
  }
  for (const a of book) if (inDay(ms(a.at))) lines.push({ at: a.at, kind: "award", text: `Награда «${a.title}» (${TIERS[a.tier]!.title.toLowerCase()})` });
  for (const x of notices) if (inDay(ms(x.at)) && !x.text.startsWith("Новая награда")) lines.push({ at: x.at, kind: "notice", text: x.text });
  lines.sort((a, b) => a.at.localeCompare(b.at));
  const count = (k: Line["kind"]) => lines.filter((l) => l.kind === k).length;
  const done = count("done"), added = count("add"), notes = count("note"), moved = count("move"), awards = count("award"), removed = count("remove");
  const dueThat = c.todos.filter((n) => n.dueAt && inDay(ms(n.dueAt)));
  const date = new Date(from + 12 * 3_600_000).toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const parts: string[] = [];
  if (!lines.length) parts.push("В этот день в делах было тихо: ничего не добавлено и не закрыто.");
  else {
    const mood = done >= 5 ? "Продуктивный день" : done ? "Рабочий день" : added + notes ? "День идей" : "Спокойный день";
    parts.push(`${mood}.`);
    if (added || notes) parts.push(`Добавлено ${dl(added)}${notes ? ` и ${notes} ${plural(notes, ["заметка", "заметки", "заметок"])}` : ""}.`);
    if (done) { const first = lines.find((l) => l.kind === "done")!; parts.push(`Завершено ${dl(done)}; первым — ${first.text} в ${hm(ms(first.at))}.`); }
    if (moved) parts.push(`Переносов: ${moved}.`);
    if (removed) parts.push(`Убрано лишнего: ${removed}.`);
    if (awards) parts.push(`JUUNIBI выдала ${awards} ${plural(awards, ["награду", "награды", "наград"])}.`);
  }
  if (dueThat.length) parts.push(`На этот день было назначено ${dl(dueThat.length)}, сейчас из них сделано ${dueThat.filter((n) => n.done).length}.`);
  const prev = dayKey(from - DAY / 2), next = dayKey(to + DAY / 2);
  return { day, date: date[0]!.toUpperCase() + date.slice(1), story: parts.join(" "), lines: lines.slice(0, 120).map((l) => ({ ...l, time: hm(ms(l.at)) })), counts: { done, added, notes, moved, removed, awards }, prev, next: to > input.now ? null : next };
}

// ------------------------------------------------------------------ what was won, kept on disk

export interface AwardState { level: number; firstAt: string; lastAt: string; history: { level: number; at: string }[]; periods?: string[] }
export interface RecordEntry { value: number; label: string; text: string; at: string; first?: boolean }
export interface Notice { id: string; at: string; text: string; emoji: string; award?: string; tier?: number; kind: "award" | "record" | "event" | "tail" | "title" }
interface StoreData {
  awards: Record<string, AwardState>; records: Record<string, RecordEntry[]>; notices: Notice[]; phrasesUsed: string[];
  title: string | null; titles: Record<string, string>; pending: { award: string; level: number; at: string; text?: string }[];
  first?: { text: string; at: string }; tails: Record<string, number>; events: string[];
}
const blank = (): StoreData => ({ awards: {}, records: {}, notices: [], phrasesUsed: [], title: null, titles: {}, pending: [], tails: {}, events: [] });
const MAX_NOTICES = 120, MAX_RECORDS = 20, MAX_PENDING = 30;

/** The award catalogue as the page shows it: the 60 figures' awards, a tail award per direction and the twelve together. */
export function awardCatalog() {
  return [
    ...METRICS.map((d) => ({ id: d.id, emoji: d.emoji, title: d.award, tier: d.tier, group: d.group, metric: d.title, goal: d.goal, levels: d.levels.length, hidden: !!d.hidden, riddle: d.riddle ?? null, repeat: d.repeat ?? null, n: d.n })),
    ...TAILS.map((t, i) => ({ id: "tail-" + t.id, emoji: t.emoji, title: "Хвост: " + t.title, tier: TAIL_AWARD_TIER, group: "tails", metric: "Двенадцать хвостов", goal: `${TAIL_LEVELS[1]} дел направления «${t.title}», дальше — новые узоры`, levels: 4, hidden: false, riddle: null, repeat: null, n: 61 + i })),
    { id: ALL_TAILS_AWARD.id, emoji: ALL_TAILS_AWARD.emoji, title: ALL_TAILS_AWARD.title, tier: ALL_TAILS_AWARD.tier, group: "tails", metric: "Двенадцать хвостов", goal: ALL_TAILS_AWARD.goal, levels: 1, hidden: true, riddle: ALL_TAILS_AWARD.riddle ?? null, repeat: null, n: 73 },
  ];
}
/** Week and month keys for `repeat` awards. */
const periodKey = (t: number, kind: "week" | "month") => {
  const d = new Date(t);
  if (kind === "month") return `${d.getFullYear()}-${p2(d.getMonth() + 1)}`;
  const monday = startOf(t) - wd(t) * DAY;
  return "w" + dayKey(monday);
};

export class Achievements {
  private data: StoreData = blank();
  private writes: Promise<void> = Promise.resolve();
  private busy: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string, private readonly source: () => Omit<Input, "recordsThisWeek" | "awardsInBook" | "first">, private readonly now: () => number = Date.now) {}

  async load() {
    try {
      const raw = JSON.parse(await readFile(this.file, "utf8")) as Partial<StoreData>;
      const d = blank();
      if (raw.awards && typeof raw.awards === "object") for (const [k, v] of Object.entries(raw.awards)) if (v && Number.isInteger(v.level) && v.level >= 0 && v.level <= 4 && typeof v.firstAt === "string") d.awards[k] = { level: v.level, firstAt: v.firstAt, lastAt: typeof v.lastAt === "string" ? v.lastAt : v.firstAt, history: Array.isArray(v.history) ? v.history.filter((h) => h && Number.isInteger(h.level) && typeof h.at === "string").slice(-12) : [], ...(Array.isArray(v.periods) ? { periods: v.periods.filter((p): p is string => typeof p === "string").slice(-60) } : {}) };
      if (raw.records && typeof raw.records === "object") for (const [k, v] of Object.entries(raw.records)) if (Array.isArray(v)) d.records[k] = v.filter((r) => r && typeof r.value === "number" && typeof r.at === "string" && typeof r.label === "string").slice(-MAX_RECORDS);
      if (Array.isArray(raw.notices)) d.notices = raw.notices.filter((n) => n && typeof n.id === "string" && typeof n.text === "string" && typeof n.at === "string").slice(-MAX_NOTICES);
      if (Array.isArray(raw.phrasesUsed)) d.phrasesUsed = raw.phrasesUsed.filter((x): x is string => typeof x === "string").slice(-200);
      if (typeof raw.title === "string") d.title = raw.title;
      if (raw.titles && typeof raw.titles === "object") for (const [k, v] of Object.entries(raw.titles)) if (typeof v === "string") d.titles[k] = v;
      if (Array.isArray(raw.pending)) d.pending = raw.pending.filter((p) => p && typeof p.award === "string" && Number.isInteger(p.level) && typeof p.at === "string").map((p) => ({ award: p.award, level: p.level, at: p.at, ...(typeof p.text === "string" ? { text: p.text } : {}) })).slice(-MAX_PENDING);
      if (raw.first && typeof raw.first.text === "string" && typeof raw.first.at === "string") d.first = { text: raw.first.text, at: raw.first.at };
      if (raw.tails && typeof raw.tails === "object") for (const [k, v] of Object.entries(raw.tails)) if (Number.isInteger(v)) d.tails[k] = v as number;
      if (Array.isArray(raw.events)) d.events = raw.events.filter((x): x is string => typeof x === "string").slice(-300);
      this.data = d;
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
  private save() {
    const json = JSON.stringify(this.data);
    this.writes = this.writes.catch(() => {}).then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const tmp = this.file + "." + randomUUID() + ".tmp";
      await writeFile(tmp, json, { mode: 0o600 });
      await rename(tmp, this.file);
    });
    return this.writes;
  }
  flush() { return this.writes; }

  private input(): Input {
    const now = this.now();
    const recordsThisWeek = Object.values(this.data.records).flat().filter((r) => !r.first && now - Date.parse(r.at) < 7 * DAY).length;
    const cat = new Map(awardCatalog().map((a) => [a.id, a.title]));
    const awardsInBook = Object.entries(this.data.awards).filter(([, s]) => s.level > 0).map(([id, s]) => ({ title: cat.get(id) ?? id, at: s.firstAt })).sort((a, b) => a.at.localeCompare(b.at));
    return { ...this.source(), recordsThisWeek, awardsInBook, ...(this.data.first ? { first: this.data.first } : {}) };
  }
  /** A line JUUNIBI has not said yet for this tier (mythic and higher never repeat until all were said). */
  private reaction(tier: number, fill: Record<string, string>): string {
    const band = [...REACTIONS].reverse().find((b) => tier >= b.from)!;
    const key = (i: number) => `${band.from}:${i}`;
    let free = band.lines.map((_, i) => i).filter((i) => !this.data.phrasesUsed.includes(key(i)));
    if (!free.length) { this.data.phrasesUsed = this.data.phrasesUsed.filter((k) => !k.startsWith(band.from + ":")); free = band.lines.map((_, i) => i); }
    const i = band.from >= 7 ? free[0]! : free[Math.floor(Math.random() * free.length)]!;
    this.data.phrasesUsed.push(key(i));
    return band.lines[i]!.replace(/\{(\w+)\}/g, (_, k: string) => fill[k] ?? "").replace(/\s+/g, " ").trim();
  }
  private notice(n: Omit<Notice, "id" | "at">) {
    this.data.notices.push({ id: randomUUID(), at: new Date(this.now()).toISOString(), ...n });
    if (this.data.notices.length > MAX_NOTICES) this.data.notices = this.data.notices.slice(-MAX_NOTICES);
  }
  /** Gives an award level; returns whether it is new. */
  private grant(id: string, level: number, tier: number, title: string, fill: Record<string, string>, quiet: boolean): boolean {
    const cur = this.data.awards[id];
    if (cur && cur.level >= level) return false;
    const at = new Date(this.now()).toISOString();
    this.data.awards[id] = { level, firstAt: cur?.firstAt ?? at, lastAt: at, history: [...(cur?.history ?? []), { level, at }].slice(-12), ...(cur?.periods ? { periods: cur.periods } : {}) };
    const medal = MEDALS[level] ?? "";
    const text = cur && cur.level > 0 ? `Медаль «${title}» улучшена: ${medal.toLowerCase()}. ${this.reaction(tier, { ...fill, award: title })}` : this.reaction(tier, { ...fill, award: title });
    this.data.pending.push({ award: id, level, at, text });
    if (this.data.pending.length > MAX_PENDING) this.data.pending = this.data.pending.slice(-MAX_PENDING);
    if (!quiet) this.notice({ text, emoji: TIERS[tier]!.emoji, award: id, tier, kind: "award" });
    return true;
  }

  /**
   * Counts everything, gives what was earned, writes new records and JUUNIBI's notices, and returns the page data.
   * The first run (an empty book) gives what is already earned without a notice for each of them.
   */
  refresh() {
    const run = this.busy.then(() => this.refreshNow());
    this.busy = run.catch(() => {});
    return run;
  }
  private async refreshNow(second = false): Promise<ReturnType<Achievements["view"]>> {
    const now = this.now();
    const input = this.input();
    const { metrics, tails, ctx } = computeMetrics(input);
    // the first look runs twice, quietly: awards that count other awards («Коллекционер», titles) come in the second pass
    const firstRun = second || (!Object.keys(this.data.awards).length && !Object.keys(this.data.records).length);
    const before = JSON.stringify(this.data);
    if (!this.data.first && ctx.done[0]) this.data.first = { text: ctx.done[0].text.slice(0, 120), at: ctx.done[0].completedAt! };
    // records: a better value than the best so far goes into the book; the old one stays in its history
    const recordsToday: string[] = [];
    for (const m of metrics) {
      if (m.record === undefined || !m.ready || m.record <= 0) continue;
      const list = this.data.records[m.id] ?? [];
      const best = list.length ? list[list.length - 1]!.value : -Infinity;
      if (m.record <= best) continue;
      list.push({ value: m.record, label: m.value, text: m.detail.slice(0, 160), at: new Date(now).toISOString(), ...(list.length ? {} : { first: true }) });
      this.data.records[m.id] = list.slice(-MAX_RECORDS);
      if (list.length > 1 && !firstRun) { recordsToday.push(m.title); this.notice({ text: `Новый личный рекорд «${m.title}»: ${m.value} (было ${list[list.length - 2]!.label}).`, emoji: "🏆", kind: "record" }); }
    }
    // patience: a to-do finished today that waited longer than any before it
    const waited = ctx.done.filter((n) => dayKey(Date.parse(n.completedAt!)) === dayKey(now)).map((n) => ({ n, d: days(Date.parse(n.completedAt!) - Date.parse(n.createdAt)) })).sort((a, b) => b.d - a.d)[0];
    if (waited && waited.d >= 3) {
      const list = this.data.records.patience ?? [];
      const best = list.length ? list[list.length - 1]!.value : 0;
      if (waited.d > best) {
        list.push({ value: waited.d, label: dn(waited.d), text: q(waited.n.text), at: new Date(now).toISOString(), ...(list.length ? {} : { first: true }) });
        this.data.records.patience = list.slice(-MAX_RECORDS);
        if (!firstRun) this.notice({ text: `Господин, сегодня вы завершили задачу, которую откладывали ${dn(waited.d)}: ${q(waited.n.text)}. Это ваш новый рекорд терпения!`, emoji: "🧟", kind: "event" });
      }
    }
    // a few events worth noticing once
    const once = (key: string, text: string, emoji: string) => { if (this.data.events.includes(key)) return; this.data.events.push(key); if (this.data.events.length > 300) this.data.events = this.data.events.slice(-300); if (!firstRun) this.notice({ text, emoji, kind: "event" }); };
    const total = ctx.done.length;
    for (const mark of [10, 50, 100, 250, 500, 1000]) if (total >= mark) once("total-" + mark, `Это ${mark}-е выполненное дело! Я веду счёт с самого первого.`, "🎯");
    const todayDone = ctx.doneByDay.get(dayKey(now))?.length ?? 0;
    if (todayDone >= 5) once("busy-" + dayKey(now), `Пять дел за один день — сегодня вы как многорукий мастер.`, "🐙");
    const keep = metrics.find((m) => m.id === "keeper");
    if (keep?.ready && /^7 /.test(keep.value)) once("keeper7-" + dayKey(now), "Неделя без просроченных дел. Порядок под охраной лисы.", "🦊");
    // awards by score, and repeat awards by periods
    const quiet = firstRun;
    for (const def of METRICS) {
      const m = metrics.find((x) => x.id === def.id)!;
      const fill = { value: m.value, detail: m.detail.endsWith(".") ? m.detail : m.detail + "." };
      if (def.repeat) {
        if (!m.earned) continue;
        const key = periodKey(now, def.repeat);
        const st = this.data.awards[def.id];
        const periods = [...new Set([...(st?.periods ?? []), key])];
        if (st) st.periods = periods.slice(-60);
        const level = def.levels.filter((x) => periods.length >= x).length;
        if (this.grant(def.id, level, def.tier, def.award, fill, quiet)) this.data.awards[def.id]!.periods = periods.slice(-60);
        continue;
      }
      if (!m.ready) continue;
      const level = levelFor(def, m.score);
      if (level > 0) this.grant(def.id, level, def.tier, def.award, fill, quiet);
    }
    // the twelve tails: a new pattern is noticed, the «Узор» gives the tail's award
    for (const t of tails) {
      const was = this.data.tails[t.id] ?? 0;
      if (t.level > was && !quiet && t.level >= 1) this.notice({ text: `Хвост «${t.title}» получил узор «${t.pattern}». Мой мех светится ярче!`, emoji: t.emoji, kind: "tail" });
      this.data.tails[t.id] = t.level;
      const lvl = Math.min(4, Math.max(0, t.level - 1));
      if (lvl > 0) this.grant("tail-" + t.id, lvl, TAIL_AWARD_TIER, "Хвост: " + t.title, { value: t.pattern, detail: `${dl(t.done)} в направлении «${t.title}».` }, quiet);
    }
    if (tails.every((t) => t.level >= 3)) this.grant(ALL_TAILS_AWARD.id, 1, ALL_TAILS_AWARD.tier, ALL_TAILS_AWARD.title, { value: "12 из 12", detail: "Все двенадцать хвостов сияют." }, quiet);
    // titles
    const lv = (id: string) => this.data.awards[id]?.level ?? 0;
    for (const t of TITLES) {
      if (this.data.titles[t.id]) continue;
      const ok = t.needs.every((n) => lv(n.award) >= n.level) && (!t.groupCount || METRICS.filter((d) => d.group === t.groupCount!.group && lv(d.id) > 0).length >= t.groupCount.count);
      if (!ok) continue;
      this.data.titles[t.id] = new Date(now).toISOString();
      if (!quiet) this.notice({ text: `Новый титул: «${t.title}». Можно выбрать его в коллекции — он появится под приветствием.`, emoji: t.emoji, kind: "title" });
    }
    if (firstRun && !second) { await this.save(); return this.refreshNow(true); }
    if (second && Object.keys(this.data.awards).length) {
      const n = Object.values(this.data.awards).filter((a) => a.level > 0).length;
      this.notice({ text: `Я заглянула в историю ваших дел и сразу нашла ${n} ${plural(n, ["награду", "награды", "наград"])}. Дальше буду замечать новое по мере дел.`, emoji: "🦊", kind: "event" });
      // the first look shows one celebration for the rarest, not a flood
      const best = [...this.data.pending].sort((a, b) => tierOf(b.award) - tierOf(a.award) || b.level - a.level)[0];
      this.data.pending = best ? [best] : [];
    }
    if (JSON.stringify(this.data) !== before) await this.save();
    return this.view(metrics, tails, ctx, recordsToday);
  }

  private view(metrics: MetricResult[], tails: ReturnType<typeof tailsOf>, ctx: Ctx, recordsToday: string[]) {
    const now = this.now();
    const cat = awardCatalog();
    const awards = cat.map((a) => {
      const st = this.data.awards[a.id];
      const def = METRICS.find((d) => d.id === a.id);
      const m = metrics.find((x) => x.id === a.id);
      const level = st?.level ?? 0;
      const next = def && !def.repeat ? def.levels[level] ?? null : null;
      // «N» in a goal is the threshold: the one reached for a won award, the first one otherwise.
      // It is named after the words rather than put in them, so «N дел» never reads «1 дел».
      const fill = (n: number | undefined) => {
        if (!def || n === undefined || !/\bN\b/.test(def.goal)) return a.goal;
        if (def.goal.includes("N/10")) return def.goal.replace("N/10", (n / 10).toLocaleString("ru-RU"));
        return `${def.goal} (N = ${n.toLocaleString("ru-RU")})`;
      };
      return { ...a, goal: fill(def?.levels[Math.max(0, level - 1)]), nextGoal: level && next ? fill(next) : null, level, firstAt: st?.firstAt ?? null, lastAt: st?.lastAt ?? null, history: st?.history ?? [], periods: st?.periods?.length ?? 0,
        progress: def && m && next ? Math.min(1, m.score / next) : level ? 1 : 0, next, ...(a.hidden && !level ? { title: "???", emoji: "❔", goal: "" } : {}) };
    });
    const pool = surprises(ctx, metrics, recordsToday);
    const seed = [...dayKey(now)].reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) >>> 0, 7);
    // the same surprise all day, picked among the three most unusual
    const surprise = pool.length ? pool[seed % Math.min(3, pool.length)]! : { emoji: "🦊", text: "Сюрприз дня появится, когда накопится немного истории дел." };
    const titles = TITLES.map((t) => ({ id: t.id, title: t.title, emoji: t.emoji, how: t.how, at: this.data.titles[t.id] ?? null }));
    const records = Object.entries(this.data.records).map(([id, list]) => {
      const def = METRICS.find((d) => d.id === id);
      return { id, emoji: def?.emoji ?? "🧟", title: def?.title ?? "Рекорд терпения", best: list[list.length - 1]!, history: [...list].reverse() };
    }).sort((a, b) => b.best.at.localeCompare(a.best.at));
    const pending = this.data.pending.map((p) => { const a = awards.find((x) => x.id === p.award); return a ? { award: p.award, level: p.level, at: p.at, title: cat.find((x) => x.id === p.award)!.title, emoji: cat.find((x) => x.id === p.award)!.emoji, tier: a.tier, text: p.text ?? null } : null; }).filter(Boolean);
    const won = awards.filter((a) => a.level > 0);
    return {
      generatedAt: new Date(now).toISOString(),
      groups: GROUPS, tiers: TIERS, effects: EFFECTS, medals: MEDALS,
      metrics: metrics.map(({ score: _s, record: _r, earned: _e, ...m }) => m),
      awards, tails, titles, title: this.data.title, records,
      notices: [...this.data.notices].reverse().slice(0, 40),
      surprise, discoveries: discoveries(ctx), pending,
      stats: { won: won.length, total: awards.length, rare: won.filter((a) => a.tier >= 4).length, medals: won.reduce((s, a) => s + a.level, 0), ready: metrics.filter((m) => m.ready).length },
    };
  }
  /** The celebrations were shown. */
  async seen(ids: unknown) {
    const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
    const before = this.data.pending.length;
    this.data.pending = list.length ? this.data.pending.filter((p) => !list.includes(p.award)) : [];
    if (this.data.pending.length !== before) await this.save();
  }
  async setTitle(id: unknown) {
    if (id !== null && (typeof id !== "string" || !this.data.titles[id])) throw Object.assign(new Error("Этот титул ещё не получен"), { status: 409 });
    this.data.title = id as string | null;
    await this.save();
    return { title: this.data.title };
  }
  day(day: string) {
    const cat = awardCatalog();
    const book = Object.entries(this.data.awards).filter(([, s]) => s.level > 0).flatMap(([id, s]) => s.history.map((h) => ({ title: (cat.find((a) => a.id === id)?.title ?? id) + (h.level > 1 ? ` (${MEDALS[h.level]!.toLowerCase()})` : ""), at: h.at, tier: tierOf(id) })));
    return dayStory(this.input(), day, book, this.data.notices);
  }
}
const tierOf = (id: string) => awardCatalog().find((a) => a.id === id)?.tier ?? 0;
