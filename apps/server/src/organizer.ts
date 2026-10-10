import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { isWorkday, prodDay } from "@juunibi/core";

export interface Mission { id: string; title: string; description: string; createdAt: string; status: "active" | "paused" | "complete" }
export interface Note {
  id: string; kind: "note" | "todo"; text: string; done: boolean; createdAt: string; priority?: "low" | "normal" | "high"; dueAt?: string; project?: string; parentId?: string; estimateMinutes?: number; completedAt?: string;
  /** A repeating to-do: ticking it off creates the next one. */
  repeat?: Repeat; repeatDay?: number;
  /** The copy created when this one was ticked off (removed again if the tick is undone). */
  nextId?: string;
  /** How many times the automation moved this overdue to-do to the next day. */
  rolled?: number;
  /** The due time a "срок скоро" reminder was already sent for. */
  remindedFor?: string;
  /** A note written by the automation (the morning brief); one of each kind is kept. */
  auto?: "brief";
}
/** What the "Дела" automation does by itself; the owner switches each part on or off. */
export interface Automation {
  /** A morning brief note (and a notification) once a day at `briefTime`. */
  brief: boolean;
  briefTime: string;
  /** Overdue to-dos move to today after midnight, marked "перенесено". */
  rollOverdue: boolean;
  /** A reminder before a to-do's due time: 15 or 60 minutes before, or in the morning of that day. */
  dueReminder: "off" | "15" | "60" | "morning";
  /** "По будням" skips holidays and counts working Saturdays by the production calendar. */
  workdays: boolean;
}
export const DEFAULT_AUTOMATION: Automation = { brief: true, briefTime: "09:00", rollOverdue: true, dueReminder: "15", workdays: true };
/** How a reminder or to-do repeats. */
export type Repeat = "daily" | "weekdays" | "weekly" | "monthly" | "every3days" | "yearly";
export const REPEATS: Repeat[] = ["daily", "weekdays", "weekly", "monthly", "every3days", "yearly"];
export interface Reminder { id: string; text: string; at: string; createdAt: string; status: "scheduled" | "due" | "done"; firedAt?: string; repeat?: Repeat; seriesId?: string; repeatDay?: number; repeatMonth?: number;
  /** Set on reminders the automation created: the to-do it is about, or "brief". */
  source?: string }
const MAX_NOTES = 500, MAX_REMINDERS = 200, MAX_TEXT = 500, MAX_DONE_REMINDERS = 100;
const YEAR = 366 * 86_400_000;
const bad = (message: string, status = 400) => Object.assign(new Error(message), { status });
const repeatOf = (v: unknown): Repeat | undefined => {
  if (v === undefined || v === null || v === "" || v === "none") return undefined;
  if (!REPEATS.includes(v as Repeat)) throw bad("Повтор: daily, weekdays, weekly, monthly, every3days, yearly или none");
  return v as Repeat;
};
/** The first occurrence of a repeating reminder strictly after `now`, keeping the local time of day of `at`. */
export function nextOccurrence(at: number, repeat: Repeat, now: number, anchorDay?: number, workday: (d: Date) => boolean = weekday, anchorMonth?: number): number {
  const d = new Date(at);
  const originalDay = anchorDay ?? d.getDate();
  const originalMonth = anchorMonth ?? d.getMonth();
  let elapsed = 0;
  const step = () => {
    if (repeat === "yearly") {
      d.setDate(1);
      d.setFullYear(d.getFullYear() + 1, originalMonth);
      d.setDate(Math.min(originalDay, new Date(d.getFullYear(), originalMonth + 1, 0).getDate()));
    } else if (repeat === "monthly") {
      const month = d.getMonth() + 1;
      d.setDate(1);
      d.setMonth(month);
      const lastDay = new Date(d.getFullYear(), d.getMonth()+1,0).getDate();
      d.setDate(Math.min(originalDay,lastDay));
    } else d.setDate(d.getDate() + (repeat==="weekly"?7:repeat==="every3days"?3:1));
    if (++elapsed > 400) throw bad("Не удалось вычислить следующее напоминание");
  };
  const ok = () => repeat !== "weekdays" || workday(d);
  do step(); while (d.getTime() <= now || !ok());
  return d.getTime();
}
/** A "weekdays" reminder set for a Saturday or Sunday starts on the next Monday instead. */
export function alignStart(at: number, repeat: Repeat | undefined, workday: (d: Date) => boolean = weekday): number {
  if (repeat !== "weekdays") return at;
  const d = new Date(at);
  for (let i = 0; i < 30 && !workday(d); i++) d.setDate(d.getDate() + 1);
  return d.getTime();
}
/** Monday to Friday; with the production calendar, holidays are skipped and working Saturdays count. */
export const weekday = (d: Date) => d.getDay() !== 0 && d.getDay() !== 6;
const localKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const dayStart = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const hhmm = (t: number) => new Date(t).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
/** A to-do due at 23:59 has a date and no time of its own. */
const dateOnly = (iso: string) => { const d = new Date(iso); return d.getHours() === 23 && d.getMinutes() === 59; };
function cleanAutomation(v: unknown): Automation {
  const a = { ...DEFAULT_AUTOMATION };
  if (!v || typeof v !== "object") return a;
  const o = v as Record<string, unknown>;
  if (typeof o.brief === "boolean") a.brief = o.brief;
  if (typeof o.briefTime === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(o.briefTime)) a.briefTime = o.briefTime;
  if (typeof o.rollOverdue === "boolean") a.rollOverdue = o.rollOverdue;
  if (o.dueReminder === "off" || o.dueReminder === "15" || o.dueReminder === "60" || o.dueReminder === "morning") a.dueReminder = o.dueReminder;
  if (typeof o.workdays === "boolean") a.workdays = o.workdays;
  return a;
}
const text = (v: unknown, label: string) => {
  if (typeof v !== "string" || !v.trim() || v.trim().length > MAX_TEXT) throw bad(`${label}: от 1 до ${MAX_TEXT} символов`);
  return v.trim();
};

/** Optional fields from the file are kept only when they make sense, so one bad value cannot break the page. */
function cleanNote(n: Note): Note {
  const c: Note = { ...n };
  if (c.priority !== undefined && !["low", "normal", "high"].includes(c.priority)) delete c.priority;
  if (c.dueAt !== undefined && (typeof c.dueAt !== "string" || !Number.isFinite(Date.parse(c.dueAt)))) delete c.dueAt;
  if (c.completedAt !== undefined && (typeof c.completedAt !== "string" || !Number.isFinite(Date.parse(c.completedAt)))) delete c.completedAt;
  if (c.project !== undefined && (typeof c.project !== "string" || !c.project.trim() || c.project.length > 80)) delete c.project;
  if (c.parentId !== undefined && typeof c.parentId !== "string") delete c.parentId;
  if (c.estimateMinutes !== undefined && !(Number.isInteger(c.estimateMinutes) && c.estimateMinutes >= 1 && c.estimateMinutes <= 1440)) delete c.estimateMinutes;
  if (c.repeat !== undefined && !REPEATS.includes(c.repeat)) { delete c.repeat; delete c.repeatDay; }
  if (c.rolled !== undefined && !(Number.isInteger(c.rolled) && c.rolled > 0)) delete c.rolled;
  if (c.auto !== undefined && c.auto !== "brief") delete c.auto;
  if (c.kind === "note") { delete c.priority; delete c.dueAt; delete c.parentId; delete c.estimateMinutes; delete c.repeat; delete c.repeatDay; delete c.rolled; }
  return c;
}

/** Notes, to-do items and reminders kept by the owner and (with approval) by the assistant. */
export class Organizer {
  private notes: Note[] = [];
  private missions: Mission[] = [];
  private reminders: Reminder[] = [];
  private writes: Promise<void> = Promise.resolve();
  private automation: Automation = { ...DEFAULT_AUTOMATION };
  /** The local days the brief and the overdue roll-over last ran, so each runs once a day. */
  private autoState: { briefDay?: string; rollDay?: string } = {};
  private briefing = false;
  /**
   * Writes the morning brief in words (the assistant, when Cloud.ru is configured); returns null to keep the plain one.
   * Set by the server after the assistant is ready.
   */
  composeBrief?: (facts: string) => Promise<string | null>;
  constructor(private readonly file: string, private readonly now: () => number = Date.now) {}
  /** A working day for "по будням": the production calendar when the owner keeps it on, else Monday to Friday. */
  private workday = (d: Date) => this.automation.workdays ? isWorkday(d) : weekday(d);

  async load() {
    try {
      const raw = JSON.parse(await readFile(this.file, "utf8")) as { notes?: unknown; reminders?: unknown; missions?: unknown; automation?: unknown; autoState?: { briefDay?: unknown; rollDay?: unknown } };
      this.automation = cleanAutomation(raw.automation);
      if (raw.autoState && typeof raw.autoState === "object") {
        if (typeof raw.autoState.briefDay === "string") this.autoState.briefDay = raw.autoState.briefDay;
        if (typeof raw.autoState.rollDay === "string") this.autoState.rollDay = raw.autoState.rollDay;
      }
      if (Array.isArray(raw.missions)) this.missions = raw.missions.filter((m): m is Mission => !!m && typeof m.id === "string" && typeof m.title === "string" && typeof m.description === "string" && typeof m.createdAt === "string" && ["active","paused","complete"].includes(m.status)).slice(-100);
      if (Array.isArray(raw.notes)) this.notes = raw.notes.filter((n): n is Note => !!n && typeof n.id === "string" && (n.kind === "note" || n.kind === "todo") && typeof n.text === "string" && n.text.length <= MAX_TEXT && typeof n.done === "boolean" && typeof n.createdAt === "string").slice(-MAX_NOTES).map(cleanNote);
      // a subtask whose parent is gone becomes an ordinary to-do
      const ids = new Set(this.notes.map((n) => n.id));
      for (const n of this.notes) if (n.parentId && !ids.has(n.parentId)) delete n.parentId;
      if (Array.isArray(raw.reminders)) this.reminders = raw.reminders.filter((r): r is Reminder => !!r && typeof r.id === "string" && typeof r.text === "string" && r.text.length <= MAX_TEXT && !Number.isNaN(Date.parse(r.at)) && ["scheduled", "due", "done"].includes(r.status) && (r.repeat === undefined || REPEATS.includes(r.repeat))).slice(-MAX_REMINDERS);
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
  private save() {
    const data = JSON.stringify({ notes: this.notes, reminders: this.reminders, missions: this.missions, automation: this.automation, autoState: this.autoState });
    this.writes = this.writes.catch(() => {}).then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const tmp = this.file + "." + randomUUID() + ".tmp";
      await writeFile(tmp, data, { mode: 0o600 });
      await rename(tmp, this.file);
    });
    return this.writes;
  }
  flush() { return this.writes; }

  /** Read-only Mission Control. Existing tasks remain the canonical progress source. */
  missionBoard() {
    return this.missions.map(m => {
      const tasks = this.notes.filter(n => n.kind === "todo" && n.project === m.id);
      const done = tasks.filter(n => n.done).length;
      const open = tasks.filter(n => !n.done);
      const blocked = open.filter(n => n.parentId && this.notes.some(p => p.id === n.parentId && !p.done));
      const available = open.filter(n => !blocked.some(b => b.id === n.id));
      const priority = (n: Note) => n.priority === "high" ? 2 : n.priority === "normal" ? 1 : 0;
      available.sort((a,b)=>priority(b)-priority(a)||(a.dueAt??"9999").localeCompare(b.dueAt??"9999"));
      const next = available[0];
      return { ...m, total:tasks.length, done, percent:tasks.length?Math.round(done*100/tasks.length):0,
        blocked:blocked.length, next:next ? {id:next.id,text:next.text,reason:next.dueAt?"Ближайший срок и приоритет":"Доступный этап"} : null,
        stages:tasks.map(t=>({id:t.id,text:t.text,done:t.done,parentId:t.parentId??null,priority:t.priority??"normal"})) };
    });
  }
  async addMission(title: unknown, description: unknown = ""): Promise<Mission> {
    const name = text(title,"Название миссии");
    if (this.missions.length >= 100) throw bad("Достигнут лимит миссий",409);
    if (this.missions.some(m=>m.title.toLowerCase()===name.toLowerCase())) throw bad("Миссия с таким названием уже существует",409);
    if (typeof description !== "string" || description.length > 1000) throw bad("Описание до 1000 символов");
    const mission: Mission = {id:randomUUID(),title:name,description:description.trim(),createdAt:new Date(this.now()).toISOString(),status:"active"};
    this.missions.push(mission);
    await this.save();
    return {...mission};
  }
  async updateMission(id:string,status:unknown): Promise<Mission> {
    const mission=this.missions.find(m=>m.id===id);
    if (!mission) throw bad("Миссия не найдена",404);
    if (!["active","paused","complete"].includes(String(status))) throw bad("Некорректный статус");
    mission.status=status as Mission["status"];
    await this.save();
    return {...mission};
  }
  async addMissionStage(id:string,description:unknown):Promise<Note>{
    const mission=this.missions.find(m=>m.id===id);
    if (!mission) throw bad("Миссия не найдена",404);
    if (mission.status!=="active") throw bad("Миссия приостановлена",409);
    const stage=await this.addNote("todo",description);
    return this.updateTask(stage.id,{project:id});
  }
  // ---------- notes and to-dos ----------
  listNotes(): Note[] { return this.notes.map((n) => ({ ...n })); }
  async addNote(kind: unknown, body: unknown): Promise<Note> {
    if (kind !== "note" && kind !== "todo") throw bad("Тип: note или todo");
    if (this.notes.length >= MAX_NOTES) throw bad(`Достигнут предел: ${MAX_NOTES} записей`, 409);
    const n: Note = { id: randomUUID(), kind, text: text(body, "Текст"), done: false, createdAt: new Date(this.now()).toISOString() };
    this.notes.push(n);
    await this.save();
    return { ...n };
  }
  /** A to-do with its date, importance and repeat in one step (the assistant's add_note). */
  async addTask(body: unknown, opts: { dueAt?: unknown; priority?: unknown; repeat?: unknown } = {}): Promise<Note> {
    const n = await this.addNote("todo", body);
    const patch: Record<string, unknown> = {};
    if (opts.dueAt !== undefined && opts.dueAt !== null && opts.dueAt !== "") patch.dueAt = opts.dueAt;
    if (opts.priority === "high" || opts.priority === "low" || opts.priority === "normal") patch.priority = opts.priority;
    if (opts.repeat !== undefined && opts.repeat !== "none") patch.repeat = opts.repeat;
    if (!Object.keys(patch).length) return n;
    try { return await this.updateTask(n.id, patch); } catch (e) { await this.removeNote(n.id); throw e; }
  }
  async editNote(id: string, body: unknown): Promise<Note> {
    const n = this.notes.find((x) => x.id === id);
    if (!n) throw bad("Запись не найдена", 404);
    n.text = text(body, "Текст");
    await this.save();
    return { ...n };
  }
  /** Optional task details; older stored notes remain readable without migration. */
  async updateTask(id: string, patch: Record<string, unknown>): Promise<Note> {
    const n = this.notes.find(x => x.id === id);
    if (!n) throw bad("Дело не найдено", 404);
    if (n.kind !== "todo") throw bad("Поля планирования доступны только делам", 409);
    const next = { ...n };
    if ("priority" in patch) {
      if (!["low", "normal", "high"].includes(String(patch.priority))) throw bad("Недопустимый приоритет");
      next.priority = patch.priority as "low" | "normal" | "high";
    }
    if ("project" in patch) {
      if (patch.project === null || patch.project === "") delete next.project;
      else if (typeof patch.project === "string" && patch.project.trim().length <= 80) next.project = patch.project.trim();
      else throw bad("Некорректный проект");
    }
    if ("dueAt" in patch) {
      if (patch.dueAt === null || patch.dueAt === "") delete next.dueAt;
      else if (typeof patch.dueAt === "string" && Number.isFinite(Date.parse(patch.dueAt))) next.dueAt = new Date(patch.dueAt).toISOString();
      else throw bad("Некорректный срок");
      // a date set by hand is a fresh start: no "перенесено" mark, and the "срок скоро" reminder may come again
      if (next.dueAt !== n.dueAt) { delete next.rolled; delete next.remindedFor; }
    }
    if ("estimateMinutes" in patch) {
      if (patch.estimateMinutes === null) delete next.estimateMinutes;
      else if (Number.isInteger(patch.estimateMinutes) && Number(patch.estimateMinutes) >= 1 && Number(patch.estimateMinutes) <= 1440) next.estimateMinutes = Number(patch.estimateMinutes);
      else throw bad("Оценка времени: 1–1440 минут");
    }
    if ("repeat" in patch) {
      const rep = repeatOf(patch.repeat);
      if (rep) {
        next.repeat = rep;
        const base = next.dueAt ? new Date(next.dueAt) : new Date(this.now());
        if (rep === "monthly" || rep === "yearly") next.repeatDay = base.getDate(); else delete next.repeatDay;
      } else { delete next.repeat; delete next.repeatDay; }
    }
    if ("parentId" in patch) {
      if (patch.parentId === null || patch.parentId === "") delete next.parentId;
      else if (typeof patch.parentId === "string" && patch.parentId !== id && this.notes.some(x=>x.id === patch.parentId && x.kind === "todo" && !x.parentId)) next.parentId = patch.parentId;
      else throw bad("Родительское дело не найдено или вложенность недопустима");
    }
    // fields removed above must go from the stored note too (Object.assign alone would keep them)
    for (const k of Object.keys(n) as (keyof Note)[]) if (!(k in next)) delete n[k];
    Object.assign(n, next);
    await this.save();
    return { ...n };
  }
  /** Advisory only: never modifies tasks or schedules. */
  planToday(now = this.now()) {
    const start = new Date(now); start.setHours(0,0,0,0);
    const end = new Date(start); end.setDate(end.getDate()+1);
    const open = this.notes.filter(n=>n.kind==="todo"&&!n.done);
    const due = (n: Note) => n.dueAt ? Date.parse(n.dueAt) : Infinity;
    const score = (n: Note) => (n.priority==="high"?30:n.priority==="low"?0:10) + (due(n)<now?50:due(n)<end.getTime()?35:0);
    const ordered = [...open].sort((a,b)=>score(b)-score(a)||due(a)-due(b)||a.createdAt.localeCompare(b.createdAt));
    return { generatedAt:new Date(now).toISOString(), total:open.length, overdue:open.filter(n=>due(n)<now).length,
      estimatedMinutes:open.reduce((sum,n)=>sum+(n.estimateMinutes??0),0),
      suggested:ordered.slice(0,10).map(n=>({id:n.id,text:n.text,score:score(n),reason:due(n)<now?"Просрочено":due(n)<end.getTime()?"Срок сегодня":n.priority==="high"?"Высокий приоритет":"Очередь задач"})),
      advisoryOnly:true as const };
  }
  /** Calendar, statistics and deterministic Brain-compatible recommendations: no network, no side effects. */
  insights(month: string, now = this.now()) {
    if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month)) throw bad("Месяц: YYYY-MM");
    const [year, m] = month.split("-").map(Number);
    const begin = new Date(year!,m!-1,1).getTime(), end = new Date(year!,m!,1).getTime();
    const items = [
      ...this.notes.filter(n=>n.kind==="todo"&&n.dueAt&&Date.parse(n.dueAt)>=begin&&Date.parse(n.dueAt)<end)
        .map(n=>({id:n.id,text:n.text,at:n.dueAt!,kind:"todo" as const,done:n.done})),
      ...this.reminders.filter(r=>Date.parse(r.at)>=begin&&Date.parse(r.at)<end)
        .map(r=>({id:r.id,text:r.text,at:r.at,kind:"reminder" as const,done:r.status==="done"}))
    ].sort((a,b)=>a.at.localeCompare(b.at));
    const todos=this.notes.filter(n=>n.kind==="todo"), finished=todos.filter(n=>n.done);
    const overdue=todos.filter(n=>!n.done&&n.dueAt&&Date.parse(n.dueAt)<now);
    const completedThisMonth=finished.filter(n=>n.completedAt&&Date.parse(n.completedAt)>=begin&&Date.parse(n.completedAt)<end).length;
    const plan=this.planToday(now);
    return {month,items,statistics:{all:todos.length,completed:finished.length,open:todos.length-finished.length,
      overdue:overdue.length,completedThisMonth,completionPercent:todos.length?Math.round(100*finished.length/todos.length):0},
      brainRecommendations:plan.suggested.slice(0,5).map(x=>({...x,evidence:"Срок и приоритет задачи",source:"local-task-metrics" as const})),
      advisoryOnly:true as const};
  }
  async setDone(id: string, done: boolean): Promise<Note> {
    const n = this.notes.find((x) => x.id === id);
    if (!n) throw bad("Запись не найдена", 404);
    if (n.kind !== "todo") throw bad("Отметить выполненным можно только дело", 409);
    if (n.done === done) return { ...n };
    n.done = done;
    if (done) {
      n.completedAt = new Date(this.now()).toISOString();
      if (n.repeat && !n.nextId && this.notes.length < MAX_NOTES) {
        // a repeating to-do: the next one appears as soon as this one is ticked off
        const now = this.now();
        const from = n.dueAt ? Date.parse(n.dueAt) : dayStart(now) + (23 * 60 + 59) * 60_000;
        const nextAt = nextOccurrence(from, n.repeat, Math.max(now, from), n.repeatDay, this.workday);
        const copy: Note = { id: randomUUID(), kind: "todo", text: n.text, done: false, createdAt: new Date(now).toISOString(), dueAt: new Date(nextAt).toISOString(), repeat: n.repeat,
          ...(n.repeatDay ? { repeatDay: n.repeatDay } : {}), ...(n.priority ? { priority: n.priority } : {}), ...(n.project ? { project: n.project } : {}),
          ...(n.estimateMinutes ? { estimateMinutes: n.estimateMinutes } : {}), ...(n.parentId ? { parentId: n.parentId } : {}) };
        this.notes.push(copy);
        n.nextId = copy.id;
      }
    } else {
      delete n.completedAt;
      // undoing the tick takes back the next copy, unless it was already worked on
      const next = n.nextId ? this.notes.find((x) => x.id === n.nextId) : undefined;
      if (next && !next.done && next.text === n.text) this.notes = this.notes.filter((x) => x !== next);
      delete n.nextId;
    }
    await this.save();
    return { ...n };
  }
  async removeNote(id: string) {
    const n = this.notes.length;
    this.notes = this.notes.filter((x) => x.id !== id);
    if (this.notes.length === n) throw bad("Запись не найдена", 404);
    // Subtasks of a removed to-do become ordinary to-dos instead of pointing at nothing
    // (such orphans were hidden from the day plan and counted as stages of a missing task).
    for (const x of this.notes) if (x.parentId === id) delete x.parentId;
    await this.save();
  }

  // ---------- reminders ----------
  listReminders(): Reminder[] { return this.reminders.map((r) => ({ ...r })).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)); }
  private when(at: unknown): number {
    const ms = typeof at === "string" ? Date.parse(at) : NaN;
    if (Number.isNaN(ms)) throw bad("Время: дата и время в формате ISO 8601, например 2026-10-10T10:00:00+03:00");
    if (ms < this.now() - 60_000) throw bad("Это время уже прошло");
    if (ms > this.now() + YEAR) throw bad("Дальше чем на год вперёд напоминания не ставятся");
    return ms;
  }
  async addReminder(body: unknown, at: unknown, repeat?: unknown): Promise<Reminder> {
    const t = text(body, "Текст");
    const rep = repeatOf(repeat);
    const ms = alignStart(this.when(at), rep, this.workday);
    if (this.reminders.filter((r) => r.status !== "done").length >= MAX_REMINDERS) throw bad(`Достигнут предел: ${MAX_REMINDERS} активных напоминаний`, 409);
    const r: Reminder = { id: randomUUID(), text: t, at: new Date(ms).toISOString(), createdAt: new Date(this.now()).toISOString(), status: "scheduled", ...(rep ? { repeat: rep, ...(rep === "monthly" || rep === "yearly" ? { repeatDay: new Date(ms).getDate() } : {}), ...(rep === "yearly" ? { repeatMonth: new Date(ms).getMonth() } : {}) } : {}) };
    this.reminders.push(r);
    await this.save();
    return { ...r };
  }
  /** Changes the text, time or repeat of a reminder that has not fired yet. Missing fields stay as they are. */
  async editReminder(id: string, patch: { text?: unknown; at?: unknown; repeat?: unknown }): Promise<Reminder> {
    const r = this.reminders.find((x) => x.id === id);
    if (!r) throw bad("Напоминание не найдено", 404);
    if (r.status !== "scheduled") throw bad("Изменить можно только запланированное напоминание", 409);
    const t = patch.text === undefined ? r.text : text(patch.text, "Текст");
    const rep = patch.repeat === undefined ? r.repeat : repeatOf(patch.repeat);
    const at = new Date(alignStart(patch.at === undefined ? Date.parse(r.at) : this.when(patch.at), rep, this.workday)).toISOString();
    r.text = t; r.at = at;
    delete r.repeatDay; delete r.repeatMonth;
    if (rep) { r.repeat = rep; if (rep === "monthly" || rep === "yearly") r.repeatDay = new Date(at).getDate(); if (rep === "yearly") r.repeatMonth = new Date(at).getMonth(); } else delete r.repeat;
    await this.save();
    return { ...r };
  }
  /** Snoozes a fired one-off occurrence, never silently shifts its repeating series. */
  async snoozeReminder(id: string, minutes: unknown): Promise<Reminder> {
    if (!Number.isInteger(minutes) || ![5, 10, 15, 30, 60, 1440].includes(Number(minutes))) throw bad("Отложить можно на 5, 10, 15, 30, 60 минут или сутки");
    const r = this.reminders.find(x => x.id === id);
    if (!r) throw bad("Напоминание не найдено", 404);
    if (r.status !== "due") throw bad("Отложить можно только сработавшее напоминание", 409);
    r.at = new Date(this.now() + Number(minutes) * 60_000).toISOString();
    r.status = "scheduled";
    delete r.firedAt;
    await this.save();
    return { ...r };
  }
  /** Suggest a finite working-day schedule without modifying the task list or promising external calendar availability. */
  timeBlocks(day: string, startHour = 9, endHour = 18) {
    if (!/^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])$/.test(day)) throw bad("День: YYYY-MM-DD");
    const d = new Date(day + "T12:00:00");
    if (Number.isNaN(d.getTime()) || [d.getFullYear(), d.getMonth()+1, d.getDate()].join("-") !== day.split("-").map(Number).join("-")) throw bad("Недопустимая дата");
    if (!Number.isInteger(startHour) || !Number.isInteger(endHour) || startHour < 0 || endHour > 24 || endHour <= startHour) throw bad("Неверные рабочие часы");
    const minutes = (endHour-startHour)*60;
    const tasks = this.notes.filter(n=>n.kind==="todo"&&!n.done && !n.parentId);
    const ordered = [...tasks].sort((a,b)=>(b.priority==="high"?2:b.priority==="normal"?1:0)-(a.priority==="high"?2:a.priority==="normal"?1:0) || (a.dueAt??"9999").localeCompare(b.dueAt??"9999"));
    let used = 0;
    const blocks: { id:string; text:string; start:string; end:string; minutes:number }[] = [];
    for (const task of ordered) {
      const duration = task.estimateMinutes ?? 30;
      if (used + duration > minutes) continue;
      const from = new Date(d); from.setHours(startHour, used, 0, 0);
      const to = new Date(from.getTime()+duration*60_000);
      blocks.push({id:task.id,text:task.text,start:from.toISOString(),end:to.toISOString(),minutes:duration});
      used += duration;
    }
    return {day, workingMinutes:minutes, plannedMinutes:used, remainingMinutes:minutes-used, blocks,
      note:"Предложение по задачам; занятость внешнего календаря не проверялась", advisoryOnly:true as const};
  }
  async dismissReminder(id: string): Promise<Reminder> {
    const r = this.reminders.find((x) => x.id === id);
    if (!r) throw bad("Напоминание не найдено", 404);
    r.status = "done";
    this.pruneDone();
    await this.save();
    return { ...r };
  }
  async removeReminder(id: string) {
    const n = this.reminders.length;
    this.reminders = this.reminders.filter((x) => x.id !== id);
    if (this.reminders.length === n) throw bad("Напоминание не найдено", 404);
    await this.save();
  }
  /**
   * Marks reminders whose time has come as "due" and returns the newly due ones. Safe to call as often as you like.
   * A repeating reminder fires as a separate one-off copy and moves on to its next time; occurrences missed while
   * JUUNIBI was closed fire once, not once per missed day.
   */
  async tick(): Promise<Reminder[]> {
    const fired: Reminder[] = [];
    const now = this.now(), firedAt = new Date(now).toISOString();
    for (const r of [...this.reminders]) {
      if (r.status !== "scheduled" || Date.parse(r.at) > now) continue;
      if (!r.repeat) { r.status = "due"; r.firedAt = firedAt; fired.push({ ...r }); continue; }
      const copy: Reminder = { id: randomUUID(), text: r.text, at: r.at, createdAt: firedAt, status: "due", firedAt, seriesId: r.id };
      this.reminders.push(copy);
      fired.push({ ...copy });
      r.at = new Date(nextOccurrence(Date.parse(r.at), r.repeat, now, r.repeatDay, this.workday, r.repeatMonth)).toISOString();
    }
    const changed = this.automate(now, fired);
    if (fired.length || changed) { this.pruneDone(); await this.save(); }
    if (this.automation.brief && !this.briefing && this.briefDue(now)) await this.runBrief(now).catch(() => {});
    return fired;
  }

  // ---------- automation ----------
  getAutomation(): Automation { return { ...this.automation }; }
  async setAutomation(patch: unknown): Promise<Automation> {
    if (!patch || typeof patch !== "object") throw bad("Ожидается объект настроек");
    const next = cleanAutomation({ ...this.automation, ...(patch as object) });
    for (const [k, v] of Object.entries(patch as Record<string, unknown>)) if ((next as unknown as Record<string, unknown>)[k] !== v) throw bad("Недопустимое значение: " + k);
    this.automation = next;
    await this.save();
    return { ...next };
  }
  /** Overdue roll-over and "срок скоро" reminders; returns whether anything changed. Fired reminders go into `fired`. */
  private automate(now: number, fired: Reminder[]): boolean {
    const a = this.automation, today = localKey(now), start = dayStart(now);
    let changed = false;
    if (a.rollOverdue && this.autoState.rollDay !== today) {
      this.autoState.rollDay = today; changed = true;
      for (const n of this.notes) {
        if (n.kind !== "todo" || n.done || !n.dueAt || Date.parse(n.dueAt) >= start) continue;
        const d = new Date(n.dueAt), t = new Date(start);
        t.setHours(d.getHours(), d.getMinutes(), 0, 0);
        // a time that is already behind us today (rolled at 10:00 for 08:00) becomes the end of today
        n.dueAt = (t.getTime() < now ? new Date(start + (23 * 60 + 59) * 60_000) : t).toISOString();
        n.rolled = (n.rolled ?? 0) + 1;
        delete n.remindedFor;
      }
    }
    if (a.dueReminder !== "off") {
      const [bh, bm] = a.briefTime.split(":").map(Number);
      for (const n of this.notes) {
        if (n.kind !== "todo" || n.done || !n.dueAt || dateOnly(n.dueAt) || n.remindedFor === n.dueAt) continue;
        const due = Date.parse(n.dueAt);
        const at = a.dueReminder === "morning" ? new Date(dayStart(due)).setHours(bh!, bm!, 0, 0) : due - Number(a.dueReminder) * 60_000;
        if (now < at) continue;
        n.remindedFor = n.dueAt; changed = true;
        if (now > due) continue; // created or edited after its time: nothing to warn about
        const when = localKey(due) === today ? "в " + hhmm(due) : new Date(due).toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) + " в " + hhmm(due);
        const r: Reminder = { id: randomUUID(), text: `Срок ${when}: ${n.text}`.slice(0, MAX_TEXT), at: new Date(now).toISOString(), createdAt: new Date(now).toISOString(), status: "due", firedAt: new Date(now).toISOString(), source: n.id };
        this.reminders.push(r);
        fired.push({ ...r });
      }
    }
    return changed;
  }
  /** The brief runs once a day, from its time until 15:00 (a brief at night would be no use). */
  private briefDue(now: number): boolean {
    if (this.autoState.briefDay === localKey(now)) return false;
    const [h, m] = this.automation.briefTime.split(":").map(Number);
    const d = new Date(now), mins = d.getHours() * 60 + d.getMinutes();
    return mins >= h! * 60 + m! && mins < Math.max(15 * 60, h! * 60 + m! + 60);
  }
  /** Facts for the morning brief, in plain Russian. */
  briefFacts(now = this.now()): { text: string; short: string } {
    const today = localKey(now), start = dayStart(now), end = start + 86_400_000;
    const pd = prodDay(today);
    const dayName = new Date(now).toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
    const kind = pd ? (pd.kind === "holiday" ? `праздник (${pd.note})` : pd.kind === "off" ? "выходной (перенос)" : pd.kind === "weekend" ? "выходной" : pd.kind === "short" ? "сокращённый рабочий день" : "рабочий день") : "";
    const open = this.notes.filter((n) => n.kind === "todo" && !n.done);
    const todays = open.filter((n) => n.dueAt && Date.parse(n.dueAt) >= start && Date.parse(n.dueAt) < end).sort((a, b) => a.dueAt!.localeCompare(b.dueAt!));
    const overdue = open.filter((n) => n.dueAt && Date.parse(n.dueAt) < start);
    const rems = this.reminders.filter((r) => r.status === "scheduled" && Date.parse(r.at) >= now && Date.parse(r.at) < end).sort((a, b) => a.at.localeCompare(b.at));
    const rolled = open.filter((n) => n.rolled && n.dueAt && Date.parse(n.dueAt) >= start && Date.parse(n.dueAt) < end).length;
    const important = open.filter((n) => n.priority === "high" && !todays.includes(n)).slice(0, 2);
    const item = (n: Note) => (n.dueAt && !dateOnly(n.dueAt) ? hhmm(Date.parse(n.dueAt)) + " " : "") + n.text;
    const lines = [dayName[0]!.toUpperCase() + dayName.slice(1) + (kind ? " — " + kind : "") + "."];
    lines.push(todays.length ? `Дела на сегодня (${todays.length}): ` + todays.slice(0, 5).map(item).join("; ") + (todays.length > 5 ? "…" : "") + "." : "На сегодня дел со сроком нет.");
    if (rolled) lines.push(`Из них перенесено со вчера: ${rolled}.`);
    if (overdue.length) lines.push(`Просрочено: ${overdue.length} (${overdue.slice(0, 3).map((n) => n.text).join("; ")}).`);
    if (rems.length) lines.push("Напоминания: " + rems.slice(0, 4).map((r) => hhmm(Date.parse(r.at)) + " " + r.text).join("; ") + ".");
    if (important.length) lines.push("Важное без срока на сегодня: " + important.map((n) => n.text).join("; ") + ".");
    const text = lines.join("\n").slice(0, MAX_TEXT);
    const short = `Сегодня ${todays.length ? "дел: " + todays.length : "дел со сроком нет"}` + (overdue.length ? `, просрочено: ${overdue.length}` : "") + (rems.length ? `, напоминаний: ${rems.length}` : "") + (kind ? ` · ${kind}` : "");
    return { text, short };
  }
  /** Writes the morning brief note (replacing yesterday's) and announces it. `force` runs it again today. */
  async runBrief(now = this.now(), force = false): Promise<Note | null> {
    if (this.briefing || (!force && this.autoState.briefDay === localKey(now))) return null;
    this.briefing = true;
    try {
      this.autoState.briefDay = localKey(now);
      const facts = this.briefFacts(now);
      let body = facts.text;
      if (this.composeBrief) {
        const words = await Promise.race([this.composeBrief(facts.text).catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 25_000))]);
        if (words && words.trim()) body = words.trim().slice(0, MAX_TEXT);
      }
      this.notes = this.notes.filter((n) => n.auto !== "brief");
      const note: Note = { id: randomUUID(), kind: "note", text: body, done: false, createdAt: new Date(now).toISOString(), auto: "brief" };
      this.notes.push(note);
      // the morning one also rings; one asked for by hand is just shown
      const stamp = new Date(now).toISOString();
      if (!force) this.reminders.push({ id: randomUUID(), text: ("Утренняя сводка. " + facts.short).slice(0, MAX_TEXT), at: stamp, createdAt: stamp, status: "due", firedAt: stamp, source: "brief" });
      this.pruneDone();
      await this.save();
      return { ...note };
    } finally { this.briefing = false; }
  }
  /** Old finished reminders are dropped so a daily reminder does not fill the list over the months. */
  private pruneDone() {
    const done = this.reminders.filter((r) => r.status === "done");
    if (done.length <= MAX_DONE_REMINDERS) return;
    const drop = new Set(done.sort((a, b) => Date.parse(a.firedAt ?? a.at) - Date.parse(b.firedAt ?? b.at)).slice(0, done.length - MAX_DONE_REMINDERS).map((r) => r.id));
    this.reminders = this.reminders.filter((r) => !drop.has(r.id));
  }
}

export interface Brief {
  now: string;
  due: { id: string; text: string; at: string }[];
  today: { id: string; text: string; at: string }[];
  openTodos: { count: number; first: { id: string; text: string }[] };
  plansRunning: number;
  memoryPending: number;
  modulesFailed: string[];
  updateAvailable: boolean;
  attention: number;
}
/** Everything worth saying at the start of the day, as data. The assistant (or the Home page) turns it into words. */
export function buildBrief(input: { now: number; reminders: Reminder[]; notes: Note[]; plansRunning: number; memoryPending: number; modulesFailed: string[]; updateAvailable: boolean }): Brief {
  const d = new Date(input.now);
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayEnd = dayStart + 86_400_000;
  const brief = (r: Reminder) => ({ id: r.id, text: r.text, at: r.at });
  const due = input.reminders.filter((r) => r.status === "due").map(brief);
  const today = input.reminders.filter((r) => r.status === "scheduled" && Date.parse(r.at) >= dayStart && Date.parse(r.at) < dayEnd).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).map(brief);
  const todos = input.notes.filter((n) => n.kind === "todo" && !n.done);
  return {
    now: d.toISOString(), due, today,
    openTodos: { count: todos.length, first: todos.slice(0, 5).map((n) => ({ id: n.id, text: n.text })) },
    plansRunning: input.plansRunning, memoryPending: input.memoryPending, modulesFailed: input.modulesFailed, updateAvailable: input.updateAvailable,
    attention: due.length + (input.memoryPending ? 1 : 0) + input.modulesFailed.length + (input.updateAvailable ? 1 : 0),
  };
}
