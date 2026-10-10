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
  /** A note written by the automation (morning brief, evening summary, weekly review); one of each kind is kept. */
  auto?: AutoNote;
  /** A repeating to-do: how many times in a row the previous ones were done on their day. */
  streak?: number;
  /** Rules already applied to this to-do, as `ruleId@dueAt`, so each runs once per due date. */
  ruled?: string[];
}
export type AutoNote = "brief" | "evening" | "week";
const AUTO_NOTES: AutoNote[] = ["brief", "evening", "week"];
/** «Если — то»: when a to-do matches, the automation does one thing for it. */
export interface AutoRule {
  id: string;
  /** What to look at: the project tag (#покупки), a word in the text, or the ⚑ mark. */
  match: "tag" | "word" | "important";
  value: string;
  /** What to do: a reminder N minutes before the due time, a reminder on a weekday at a time, or mark important. */
  action: "before" | "weekday" | "important";
  minutes?: number; weekday?: number; time?: string;
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
  /** The evening summary at `eveningTime`: done, left, and tomorrow. */
  evening: boolean;
  eveningTime: string;
  /** Quiet hours: no sound at night, automatic reminders wait for the morning. */
  quiet: boolean;
  quietFrom: string;
  quietTo: string;
  /** A to-do moved this many times is "stuck" and gets a question (0 = never). */
  stuckAfter: number;
  /** The day before a holiday or a short day, the brief says so. */
  holidayWarn: boolean;
  /** A review of the week on Sunday evening. */
  weekly: boolean;
  /** A goal that has not moved for this many days is mentioned in the brief (0 = never). */
  goalNudge: number;
  /** In the chat, "надо завтра позвонить" offers a card «Добавить в дела?». */
  chatPromises: boolean;
  /** Hours free for to-dos on a working day (the day load); 0 = do not count. */
  dayHours: number;
  /** Streaks of repeating to-dos. */
  streaks: boolean;
  rules: AutoRule[];
}
export const DEFAULT_AUTOMATION: Automation = {
  brief: true, briefTime: "09:00", rollOverdue: true, dueReminder: "15", workdays: true,
  evening: true, eveningTime: "21:00", quiet: true, quietFrom: "23:00", quietTo: "08:00",
  stuckAfter: 3, holidayWarn: true, weekly: true, goalNudge: 3, chatPromises: true, dayHours: 8, streaks: true, rules: [],
};
/** One line of «Что сделала автоматика», with what is needed to take it back. */
export interface AutoLogEntry {
  id: string; at: string;
  kind: "roll" | "remind" | "brief" | "evening" | "week" | "quiet" | "arrange" | "move" | "rule";
  text: string;
  /** Previous due date, «перенесено» count and importance of the to-dos it changed; reminders and notes it created. */
  undo?: { notes?: { id: string; dueAt: string | null; rolled: number | null; priority?: Note["priority"] | null }[]; reminders?: string[]; created?: string[] };
  undone?: boolean;
}
/** How a reminder or to-do repeats. */
export type Repeat = "daily" | "weekdays" | "weekly" | "monthly" | "every3days" | "yearly";
export const REPEATS: Repeat[] = ["daily", "weekdays", "weekly", "monthly", "every3days", "yearly"];
export interface Reminder { id: string; text: string; at: string; createdAt: string; status: "scheduled" | "due" | "done"; firedAt?: string; repeat?: Repeat; seriesId?: string; repeatDay?: number; repeatMonth?: number;
  /** Set on reminders the automation created: the to-do it is about, or "brief" / "evening" / "week". */
  source?: string;
  /** The rule that created it (its reminder is dropped when the to-do is done). */
  rule?: string }
const MAX_NOTES = 500, MAX_REMINDERS = 200, MAX_TEXT = 500, MAX_DONE_REMINDERS = 100, MAX_AUTO_TEXT = 1500, MAX_LOG = 60;
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
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const minsOf = (hm: string) => { const [h, m] = hm.split(":").map(Number); return h! * 60 + m!; };
const minsNow = (t: number) => { const d = new Date(t); return d.getHours() * 60 + d.getMinutes(); };
/** Inside quiet hours [from, to); the range may cross midnight. */
export function inQuiet(t: number, from: string, to: string): boolean {
  const m = minsNow(t), f = minsOf(from), e = minsOf(to);
  return f === e ? false : f < e ? m >= f && m < e : m >= f || m < e;
}
function cleanRule(v: unknown): AutoRule | null {
  const o = v as Partial<AutoRule> | null;
  if (!o || typeof o !== "object" || typeof o.id !== "string" || !/^[\w-]{1,40}$/.test(o.id)) return null;
  if (o.match !== "tag" && o.match !== "word" && o.match !== "important") return null;
  const value = typeof o.value === "string" ? o.value.trim().replace(/^#/, "").slice(0, 40) : "";
  if (o.match !== "important" && !value) return null;
  const r: AutoRule = { id: o.id, match: o.match, value: o.match === "important" ? "" : value, action: "important" };
  if (o.action === "before" && [15, 30, 60, 180, 1440].includes(Number(o.minutes))) { r.action = "before"; r.minutes = Number(o.minutes); }
  else if (o.action === "weekday" && Number.isInteger(o.weekday) && o.weekday! >= 0 && o.weekday! <= 6 && typeof o.time === "string" && TIME_RE.test(o.time)) { r.action = "weekday"; r.weekday = o.weekday!; r.time = o.time; }
  else if (o.action === "important" && o.match !== "important") r.action = "important";
  else return null;
  return r;
}
function cleanAutomation(v: unknown): Automation {
  const a: Automation = { ...DEFAULT_AUTOMATION, rules: [] };
  if (!v || typeof v !== "object") return a;
  const o = v as Record<string, unknown>;
  for (const k of ["brief", "rollOverdue", "workdays", "evening", "quiet", "holidayWarn", "weekly", "chatPromises", "streaks"] as const) if (typeof o[k] === "boolean") a[k] = o[k] as boolean;
  for (const k of ["briefTime", "eveningTime", "quietFrom", "quietTo"] as const) if (typeof o[k] === "string" && TIME_RE.test(o[k] as string)) a[k] = o[k] as string;
  if (o.dueReminder === "off" || o.dueReminder === "15" || o.dueReminder === "60" || o.dueReminder === "morning") a.dueReminder = o.dueReminder;
  if ([0, 2, 3, 5].includes(o.stuckAfter as number)) a.stuckAfter = o.stuckAfter as number;
  if ([0, 3, 7, 14].includes(o.goalNudge as number)) a.goalNudge = o.goalNudge as number;
  if (Number.isInteger(o.dayHours) && (o.dayHours as number) >= 0 && (o.dayHours as number) <= 16) a.dayHours = o.dayHours as number;
  if (Array.isArray(o.rules)) a.rules = o.rules.map(cleanRule).filter((r): r is AutoRule => !!r).slice(0, 20);
  return a;
}
const hoursText = (min: number) => (Math.round(min / 6) / 10).toLocaleString("ru-RU") + " ч";
const dayWord = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "день" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "дня" : "дней");
const timesWord = (n: number) => (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "раза" : "раз");
const ruleBefore = (m: number) => (m === 1440 ? "сутки" : m >= 60 ? m / 60 + " ч" : m + " мин");
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
  if (c.auto !== undefined && !AUTO_NOTES.includes(c.auto)) delete c.auto;
  if (c.streak !== undefined && !(Number.isInteger(c.streak) && c.streak >= 0 && c.streak < 10_000)) delete c.streak;
  if (c.ruled !== undefined && !(Array.isArray(c.ruled) && c.ruled.every((x) => typeof x === "string"))) delete c.ruled;
  if (c.kind === "note") { delete c.priority; delete c.dueAt; delete c.parentId; delete c.estimateMinutes; delete c.repeat; delete c.repeatDay; delete c.rolled; delete c.streak; delete c.ruled; }
  return c;
}

/** Notes, to-do items and reminders kept by the owner and (with approval) by the assistant. */
export class Organizer {
  private notes: Note[] = [];
  private missions: Mission[] = [];
  private reminders: Reminder[] = [];
  private writes: Promise<void> = Promise.resolve();
  private automation: Automation = { ...DEFAULT_AUTOMATION };
  /** The local days the brief, the overdue roll-over, the evening summary and the weekly review last ran. */
  private autoState: { briefDay?: string; rollDay?: string; eveningDay?: string; weekDay?: string } = {};
  /** «Что сделала автоматика», newest last. */
  private log: AutoLogEntry[] = [];
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
      const raw = JSON.parse(await readFile(this.file, "utf8")) as { notes?: unknown; reminders?: unknown; missions?: unknown; automation?: unknown; autoState?: Record<string, unknown>; log?: unknown };
      this.automation = cleanAutomation(raw.automation);
      if (raw.autoState && typeof raw.autoState === "object") {
        for (const k of ["briefDay", "rollDay", "eveningDay", "weekDay"] as const) if (typeof raw.autoState[k] === "string") this.autoState[k] = raw.autoState[k] as string;
      }
      if (Array.isArray(raw.log)) this.log = raw.log.filter((e): e is AutoLogEntry => !!e && typeof e.id === "string" && typeof e.at === "string" && typeof e.kind === "string" && typeof e.text === "string").slice(-MAX_LOG);
      if (Array.isArray(raw.missions)) this.missions = raw.missions.filter((m): m is Mission => !!m && typeof m.id === "string" && typeof m.title === "string" && typeof m.description === "string" && typeof m.createdAt === "string" && ["active","paused","complete"].includes(m.status)).slice(-100);
      if (Array.isArray(raw.notes)) this.notes = raw.notes.filter((n): n is Note => !!n && typeof n.id === "string" && (n.kind === "note" || n.kind === "todo") && typeof n.text === "string" && n.text.length <= (n.auto ? MAX_AUTO_TEXT : MAX_TEXT) && typeof n.done === "boolean" && typeof n.createdAt === "string").slice(-MAX_NOTES).map(cleanNote);
      // a subtask whose parent is gone becomes an ordinary to-do
      const ids = new Set(this.notes.map((n) => n.id));
      for (const n of this.notes) if (n.parentId && !ids.has(n.parentId)) delete n.parentId;
      if (Array.isArray(raw.reminders)) this.reminders = raw.reminders.filter((r): r is Reminder => !!r && typeof r.id === "string" && typeof r.text === "string" && r.text.length <= MAX_TEXT && !Number.isNaN(Date.parse(r.at)) && ["scheduled", "due", "done"].includes(r.status) && (r.repeat === undefined || REPEATS.includes(r.repeat))).slice(-MAX_REMINDERS);
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
  private save() {
    const data = JSON.stringify({ notes: this.notes, reminders: this.reminders, missions: this.missions, automation: this.automation, autoState: this.autoState, log: this.log });
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
      return { ...m, total:tasks.length, done, percent:tasks.length?Math.round(done*100/tasks.length):0, idleDays: this.goalIdleDays(m),
        blocked:blocked.length, next:next ? {id:next.id,text:next.text,reason:next.dueAt?"Ближайший срок и приоритет":"Доступный этап"} : null,
        stages:tasks.map(t=>({id:t.id,text:t.text,done:t.done,parentId:t.parentId??null,priority:t.priority??"normal"})) };
    });
  }
  /** Whole days since anything happened to a goal: a step added or ticked off, or the goal created. */
  private goalIdleDays(m: Mission, now = this.now()): number {
    let last = Date.parse(m.createdAt);
    for (const n of this.notes) if (n.kind === "todo" && n.project === m.id) last = Math.max(last, Date.parse(n.createdAt), n.completedAt ? Date.parse(n.completedAt) : 0);
    return Number.isFinite(last) ? Math.max(0, Math.floor((now - last) / 86_400_000)) : 0;
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
    // days whose to-dos take more time than there is (the calendar marks them)
    const heavyDays = [...new Set(items.filter(x=>x.kind==="todo"&&!x.done).map(x=>localKey(Date.parse(x.at))))].filter(d=>this.dayLoad(d,now).over);
    return {month,items,heavyDays,statistics:{all:todos.length,completed:finished.length,open:todos.length-finished.length,
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
        // done on its day (or before) continues the streak; a late tick starts a new one
        const onTime = !n.dueAt || now < dayStart(Date.parse(n.dueAt)) + 86_400_000;
        const streak = onTime ? (n.streak ?? 0) + 1 : 1;
        const copy: Note = { id: randomUUID(), kind: "todo", text: n.text, done: false, createdAt: new Date(now).toISOString(), dueAt: new Date(nextAt).toISOString(), repeat: n.repeat, streak,
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
    if (minutes !== "tomorrow" && (!Number.isInteger(minutes) || ![5, 10, 15, 30, 60, 180, 1440].includes(Number(minutes)))) throw bad("Отложить можно на 5, 10, 15, 30 минут, 1 или 3 часа, сутки или до завтра");
    const r = this.reminders.find(x => x.id === id);
    if (!r) throw bad("Напоминание не найдено", 404);
    if (r.status !== "due") throw bad("Отложить можно только сработавшее напоминание", 409);
    // «до завтра» is tomorrow at the brief time, when the day starts
    r.at = new Date(minutes === "tomorrow" ? dayStart(this.now()) + 86_400_000 + minsOf(this.automation.briefTime) * 60_000 : this.now() + Number(minutes) * 60_000).toISOString();
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
   * JUUNIBI was closed fire once, not once per missed day. Automatic reminders wait out the quiet hours.
   */
  async tick(): Promise<Reminder[]> {
    const fired: Reminder[] = [];
    const now = this.now(), firedAt = new Date(now).toISOString();
    const a = this.automation, quiet = this.isQuiet(now);
    let released = 0, changed = false;
    for (const r of [...this.reminders]) {
      if (r.status !== "scheduled" || Date.parse(r.at) > now) continue;
      // a rule's reminder about a to-do that is already done (or gone) is no longer needed
      if (r.rule) {
        const n = this.notes.find((x) => x.id === r.source);
        if (!n || n.done) { r.status = "done"; r.firedAt = firedAt; changed = true; continue; }
      }
      if (r.source && quiet) continue; // automatic ones wait for the morning
      if (r.source && a.quiet && inQuiet(Date.parse(r.at), a.quietFrom, a.quietTo)) released++;
      if (!r.repeat) { r.status = "due"; r.firedAt = firedAt; fired.push({ ...r }); continue; }
      const copy: Reminder = { id: randomUUID(), text: r.text, at: r.at, createdAt: firedAt, status: "due", firedAt, seriesId: r.id };
      this.reminders.push(copy);
      fired.push({ ...copy });
      r.at = new Date(nextOccurrence(Date.parse(r.at), r.repeat, now, r.repeatDay, this.workday, r.repeatMonth)).toISOString();
    }
    if (released) this.addLog("quiet", `Тихие часы: придержала напоминаний до утра: ${released}`);
    changed = this.automate(now, fired) || changed;
    if (fired.length || changed) { this.pruneDone(); await this.save(); }
    if (a.brief && !this.briefing && this.briefDue(now)) await this.runBrief(now).catch(() => {});
    if (a.evening && !this.briefing && this.autoState.eveningDay !== localKey(now) && minsNow(now) >= minsOf(a.eveningTime)) await this.runEvening(now).catch(() => {});
    if (a.weekly && !this.briefing && new Date(now).getDay() === 0 && this.autoState.weekDay !== localKey(now) && minsNow(now) >= minsOf(a.eveningTime)) await this.runWeek(now).catch(() => {});
    return fired;
  }

  // ---------- automation ----------
  getAutomation(): Automation { return { ...this.automation, rules: this.automation.rules.map((r) => ({ ...r })) }; }
  async setAutomation(patch: unknown): Promise<Automation> {
    if (!patch || typeof patch !== "object") throw bad("Ожидается объект настроек");
    const next = cleanAutomation({ ...this.automation, ...(patch as object) });
    for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
      // rules are tidied up (a leading # dropped), so only a rule that was thrown out is an error
      const okRule = k === "rules" && Array.isArray(v) && next.rules.length === v.length;
      if (!okRule && JSON.stringify((next as unknown as Record<string, unknown>)[k]) !== JSON.stringify(v)) throw bad("Недопустимое значение: " + k);
    }
    this.automation = next;
    await this.save();
    return this.getAutomation();
  }
  /** Quiet hours are on and `now` is inside them. */
  isQuiet(now = this.now()): boolean { const a = this.automation; return a.quiet && inQuiet(now, a.quietFrom, a.quietTo); }

  /** «Что сделала автоматика», newest first. */
  listLog(): AutoLogEntry[] { return this.log.map((e) => ({ ...e })).reverse(); }
  private addLog(kind: AutoLogEntry["kind"], text: string, undo?: AutoLogEntry["undo"]) {
    this.log.push({ id: randomUUID(), at: new Date(this.now()).toISOString(), kind, text: text.slice(0, 300), ...(undo ? { undo } : {}) });
    if (this.log.length > MAX_LOG) this.log = this.log.slice(-MAX_LOG);
  }
  /** Takes back one action of the automation: due dates and marks as they were, created reminders and notes removed. */
  async undoLog(id: string): Promise<AutoLogEntry> {
    const e = this.log.find((x) => x.id === id);
    if (!e) throw bad("Запись журнала не найдена", 404);
    if (e.undone) throw bad("Уже отменено", 409);
    if (!e.undo) throw bad("Это действие нельзя отменить", 409);
    for (const u of e.undo.notes ?? []) {
      const n = this.notes.find((x) => x.id === u.id);
      if (!n || n.done) continue;
      if (u.dueAt === null) delete n.dueAt; else n.dueAt = u.dueAt;
      if (u.rolled === null) delete n.rolled; else n.rolled = u.rolled;
      if (u.priority !== undefined) { if (u.priority === null) delete n.priority; else n.priority = u.priority; }
      delete n.remindedFor;
    }
    const drop = new Set([...(e.undo.reminders ?? [])]);
    this.reminders = this.reminders.filter((r) => !drop.has(r.id));
    const gone = new Set(e.undo.created ?? []);
    this.notes = this.notes.filter((n) => !gone.has(n.id));
    e.undone = true;
    await this.save();
    return { ...e };
  }

  /** Overdue roll-over, "срок скоро" reminders and the owner's rules; returns whether anything changed. Fired reminders go into `fired`. */
  private automate(now: number, fired: Reminder[]): boolean {
    const a = this.automation, today = localKey(now), start = dayStart(now);
    let changed = false;
    if (a.rollOverdue && this.autoState.rollDay !== today) {
      this.autoState.rollDay = today; changed = true;
      const undo: NonNullable<AutoLogEntry["undo"]>["notes"] = [];
      for (const n of this.notes) {
        if (n.kind !== "todo" || n.done || !n.dueAt || Date.parse(n.dueAt) >= start) continue;
        undo.push({ id: n.id, dueAt: n.dueAt, rolled: n.rolled ?? null });
        const d = new Date(n.dueAt), t = new Date(start);
        t.setHours(d.getHours(), d.getMinutes(), 0, 0);
        // a time that is already behind us today (rolled at 10:00 for 08:00) becomes the end of today
        n.dueAt = (t.getTime() < now ? new Date(start + (23 * 60 + 59) * 60_000) : t).toISOString();
        n.rolled = (n.rolled ?? 0) + 1;
        if (n.repeat) n.streak = 0; // a missed repeating to-do breaks its streak
        delete n.remindedFor;
      }
      if (undo.length) this.addLog("roll", `Перенесла на сегодня просроченные (${undo.length}): ` + this.names(undo.map((u) => u.id)), { notes: undo });
    }
    if (a.dueReminder !== "off" && !this.isQuiet(now)) {
      for (const n of this.notes) {
        if (n.kind !== "todo" || n.done || !n.dueAt || dateOnly(n.dueAt) || n.remindedFor === n.dueAt) continue;
        const due = Date.parse(n.dueAt);
        const at = a.dueReminder === "morning" ? dayStart(due) + minsOf(a.briefTime) * 60_000 : due - Number(a.dueReminder) * 60_000;
        if (now < at) continue;
        n.remindedFor = n.dueAt; changed = true;
        if (now > due) continue; // created or edited after its time: nothing to warn about
        const when = localKey(due) === today ? "в " + hhmm(due) : new Date(due).toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) + " в " + hhmm(due);
        const r: Reminder = { id: randomUUID(), text: `Срок ${when}: ${n.text}`.slice(0, MAX_TEXT), at: new Date(now).toISOString(), createdAt: new Date(now).toISOString(), status: "due", firedAt: new Date(now).toISOString(), source: n.id };
        this.reminders.push(r);
        fired.push({ ...r });
        this.addLog("remind", "Напомнила о сроке: " + n.text, { reminders: [r.id] });
      }
    }
    if (a.rules.length && this.applyRules(now)) changed = true;
    return changed;
  }
  private names(ids: string[]): string {
    const t = ids.map((id) => this.notes.find((n) => n.id === id)?.text).filter(Boolean) as string[];
    return t.slice(0, 3).map((x) => "«" + x.slice(0, 40) + "»").join(", ") + (t.length > 3 ? ` и ещё ${t.length - 3}` : "");
  }
  /** Does the rule fit this to-do? */
  private ruleMatches(r: AutoRule, n: Note): boolean {
    const v = r.value.toLowerCase();
    if (r.match === "important") return n.priority === "high";
    if (r.match === "tag") return n.project?.toLowerCase() === v || n.text.toLowerCase().includes("#" + v);
    return n.text.toLowerCase().includes(v);
  }
  /** Runs each rule once per to-do and due date. */
  private applyRules(now: number): boolean {
    let changed = false;
    for (const n of this.notes) {
      if (n.kind !== "todo" || n.done) continue;
      for (const rule of this.automation.rules) {
        const key = `${rule.id}@${n.dueAt ?? ""}`;
        if (n.ruled?.includes(key) || !this.ruleMatches(rule, n)) continue;
        n.ruled = [...(n.ruled ?? []).filter((x) => !x.startsWith(rule.id + "@")), key].slice(-20);
        changed = true;
        if (rule.action === "important") {
          if (n.priority === "high") continue;
          this.addLog("rule", "Правило: отметила важным " + n.text, { notes: [{ id: n.id, dueAt: n.dueAt ?? null, rolled: n.rolled ?? null, priority: n.priority ?? null }] });
          n.priority = "high";
          continue;
        }
        let at: number;
        if (rule.action === "before") {
          if (!n.dueAt || dateOnly(n.dueAt)) continue;
          at = Date.parse(n.dueAt) - rule.minutes! * 60_000;
        } else {
          const d = new Date(now), [h, m] = rule.time!.split(":").map(Number);
          d.setHours(h!, m!, 0, 0);
          while (d.getDay() !== rule.weekday || d.getTime() <= now) d.setDate(d.getDate() + 1);
          at = d.getTime();
        }
        if (at <= now || this.reminders.filter((r) => r.status !== "done").length >= MAX_REMINDERS) continue;
        // the rule's reminder for an earlier due date is replaced
        this.reminders = this.reminders.filter((r) => !(r.rule === rule.id && r.source === n.id && r.status === "scheduled"));
        const label = rule.action === "before" ? `Через ${ruleBefore(rule.minutes!)} срок: ` : "";
        const r: Reminder = { id: randomUUID(), text: (label + n.text).slice(0, MAX_TEXT), at: new Date(at).toISOString(), createdAt: new Date(now).toISOString(), status: "scheduled", source: n.id, rule: rule.id };
        this.reminders.push(r);
        this.addLog("rule", `Правило: напомню ${new Date(at).toLocaleString("ru-RU", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} — ${n.text}`, { reminders: [r.id] });
      }
    }
    return changed;
  }

  /** The brief runs once a day, from its time until 15:00 (a brief at night would be no use). */
  private briefDue(now: number): boolean {
    if (this.autoState.briefDay === localKey(now)) return false;
    const b = minsOf(this.automation.briefTime), mins = minsNow(now);
    return mins >= b && mins < Math.max(15 * 60, b + 60);
  }
  private dayKind(key: string): { work: boolean; short: boolean; label: string; note?: string } {
    const pd = prodDay(key);
    const work = pd ? pd.kind === "work" || pd.kind === "short" : weekday(new Date(key + "T12:00"));
    const label = pd ? (pd.kind === "holiday" ? "праздник" : pd.kind === "off" ? "выходной (перенос)" : pd.kind === "weekend" ? "выходной" : pd.kind === "short" ? "сокращённый рабочий день" : "рабочий день") : work ? "рабочий день" : "выходной";
    return { work, short: pd?.kind === "short", label, ...(pd?.note ? { note: pd.note } : {}) };
  }
  /** Facts for the morning brief, in plain Russian. On a day off it is short and calm. */
  briefFacts(now = this.now()): { text: string; short: string } {
    const a = this.automation, today = localKey(now), start = dayStart(now), end = start + 86_400_000;
    const dk = this.dayKind(today);
    const kind = dk.label + (dk.note && dk.label === "праздник" ? ` (${dk.note})` : "");
    const dayName = new Date(now).toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
    const open = this.notes.filter((n) => n.kind === "todo" && !n.done);
    const todays = open.filter((n) => n.dueAt && Date.parse(n.dueAt) >= start && Date.parse(n.dueAt) < end).sort((x, y) => x.dueAt!.localeCompare(y.dueAt!));
    const overdue = open.filter((n) => n.dueAt && Date.parse(n.dueAt) < start);
    const rems = this.reminders.filter((r) => r.status === "scheduled" && !r.rule && Date.parse(r.at) >= now && Date.parse(r.at) < end).sort((x, y) => x.at.localeCompare(y.at));
    const rolled = open.filter((n) => n.rolled && n.dueAt && Date.parse(n.dueAt) >= start && Date.parse(n.dueAt) < end).length;
    const important = open.filter((n) => n.priority === "high" && !todays.includes(n)).slice(0, 2);
    const item = (n: Note) => (n.dueAt && !dateOnly(n.dueAt) ? hhmm(Date.parse(n.dueAt)) + " " : "") + n.text;
    const lines = [dayName[0]!.toUpperCase() + dayName.slice(1) + " — " + kind + "."];
    lines.push(todays.length ? `Дела на сегодня (${todays.length}): ` + todays.slice(0, 5).map(item).join("; ") + (todays.length > 5 ? "…" : ".") : dk.work ? "На сегодня дел со сроком нет." : "Дел на сегодня нет, можно отдохнуть.");
    if (rolled) lines.push(`Из них перенесено со вчера: ${rolled}.`);
    if (overdue.length) lines.push(dk.work ? `Просрочено: ${overdue.length} (${overdue.slice(0, 3).map((n) => n.text).join("; ")}).` : `Просрочено: ${overdue.length}.`);
    if (rems.length) lines.push("Напоминания: " + rems.slice(0, 4).map((r) => hhmm(Date.parse(r.at)) + " " + r.text).join("; ") + ".");
    if (dk.work) {
      if (important.length) lines.push("Важное без срока на сегодня: " + important.map((n) => n.text).join("; ") + ".");
      const load = this.dayLoad(today, now);
      if (load.over) lines.push(`День перегружен: дел примерно на ${hoursText(load.planned)} при ${hoursText(load.capacity)} свободных.`);
    }
    if (a.stuckAfter) {
      const stuck = open.filter((n) => (n.rolled ?? 0) >= a.stuckAfter).slice(0, 2);
      if (stuck.length) lines.push("Застряло: " + stuck.map((n) => `«${n.text}» (перенесено ${n.rolled} ${timesWord(n.rolled!)})`).join("; ") + ". Может, разбить на шаги или убрать?");
    }
    if (a.streaks) {
      const s = todays.filter((n) => n.repeat && (n.streak ?? 0) >= 3).slice(0, 2);
      if (s.length) lines.push("Серии: " + s.map((n) => `«${n.text}» ${n.streak} подряд`).join("; ") + ", не прервите.");
    }
    if (a.goalNudge && dk.work) {
      const g = this.missionBoard().filter((m) => m.status === "active" && m.idleDays >= a.goalNudge && m.next).slice(0, 1);
      for (const m of g) lines.push(`Цель «${m.title}» стоит ${m.idleDays} ${dayWord(m.idleDays)}. Следующий шаг: ${m.next!.text}.`);
    }
    if (a.holidayWarn) { const w = this.tomorrowWarning(now); if (w) lines.push(w); }
    if (!dk.work) lines.push("Хорошего выходного!");
    const text = lines.join("\n").slice(0, MAX_AUTO_TEXT);
    const short = `Сегодня ${todays.length ? "дел: " + todays.length : "дел со сроком нет"}` + (overdue.length ? `, просрочено: ${overdue.length}` : "") + (rems.length ? `, напоминаний: ${rems.length}` : "") + ` · ${kind}`;
    return { text, short };
  }
  /** «Завтра праздник…» when tomorrow is a holiday, a moved day off or a short day; null otherwise. */
  tomorrowWarning(now = this.now()): string | null {
    const end = dayStart(now) + 86_400_000, key = localKey(end + 3_600_000);
    const pd = prodDay(key);
    if (!pd || (pd.kind !== "holiday" && pd.kind !== "off" && pd.kind !== "short")) return null;
    const due = this.notes.filter((n) => n.kind === "todo" && !n.done && n.dueAt && localKey(Date.parse(n.dueAt)) === key).length;
    if (pd.kind === "short") return "Завтра сокращённый рабочий день, на час короче." + (due ? ` На него назначено дел: ${due}.` : "");
    return `Завтра ${pd.kind === "holiday" ? "праздник" + (pd.note ? ` (${pd.note})` : "") : "выходной (перенос)"}.` + (due ? ` На него назначено дел: ${due}, их можно сдвинуть на рабочий день.` : "");
  }
  /** Writes an automatic note (replacing the previous one of its kind) and, unless asked for by hand, rings once. */
  private async writeAuto(kind: AutoNote, body: string, ring: string, now: number, force: boolean): Promise<Note> {
    this.notes = this.notes.filter((n) => n.auto !== kind);
    const note: Note = { id: randomUUID(), kind: "note", text: body.slice(0, MAX_AUTO_TEXT), done: false, createdAt: new Date(now).toISOString(), auto: kind };
    this.notes.push(note);
    const stamp = new Date(now).toISOString();
    if (!force) this.reminders.push({ id: randomUUID(), text: ring.slice(0, MAX_TEXT), at: stamp, createdAt: stamp, status: "due", firedAt: stamp, source: kind });
    const what = kind === "brief" ? "утреннюю сводку" : kind === "evening" ? "итог дня" : "обзор недели";
    if (!force) this.addLog(kind, "Составила " + what, { created: [note.id] });
    this.pruneDone();
    await this.save();
    return { ...note };
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
        if (words && words.trim()) body = words.trim().slice(0, MAX_AUTO_TEXT);
      }
      // the morning one also rings; one asked for by hand is just shown
      return await this.writeAuto("brief", body, "Утренняя сводка. " + facts.short, now, force);
    } finally { this.briefing = false; }
  }
  /** Facts for the evening: done today, what is left, and what tomorrow brings. */
  eveningFacts(now = this.now()): { text: string; short: string; left: number } {
    const start = dayStart(now), end = start + 86_400_000, tKey = localKey(end + 3_600_000);
    const done = this.notes.filter((n) => n.kind === "todo" && n.done && n.completedAt && Date.parse(n.completedAt) >= start && Date.parse(n.completedAt) < end);
    const left = this.notes.filter((n) => n.kind === "todo" && !n.done && n.dueAt && Date.parse(n.dueAt) < end);
    const tomorrow = this.notes.filter((n) => n.kind === "todo" && !n.done && n.dueAt && localKey(Date.parse(n.dueAt)) === tKey).sort((x, y) => x.dueAt!.localeCompare(y.dueAt!));
    const rems = this.reminders.filter((r) => r.status === "scheduled" && !r.rule && localKey(Date.parse(r.at)) === tKey);
    const dayName = new Date(now).toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
    // «…» already ends the sentence, so no full stop after it
    const list = (xs: Note[]) => xs.slice(0, 4).map((n) => n.text).join("; ") + (xs.length > 4 ? "…" : "");
    const stop = (x: string) => (x.endsWith("…") ? x : x + ".");
    const lines = [`Итог дня: ${dayName}.`];
    lines.push(done.length ? stop(`Сделано: ${done.length} — ${list(done)}`) : "Сегодня ничего не отмечено сделанным.");
    if (left.length) lines.push(stop(`Не успели: ${left.length} — ${list(left)}`) + " Их можно перенести на завтра одной кнопкой.");
    else if (done.length) lines.push("Всё, что было на сегодня, сделано. Отличный день!");
    const tk = this.dayKind(tKey);
    lines.push(stop(`Завтра ${tk.label}: ` + (tomorrow.length ? `дел ${tomorrow.length} — ${list(tomorrow)}` : "дел со сроком пока нет") + (rems.length ? `, напоминаний: ${rems.length}` : "")));
    if (this.automation.holidayWarn) { const w = this.tomorrowWarning(now); if (w && !w.startsWith("Завтра праздник") && !w.startsWith("Завтра выходной")) lines.push(w); }
    const short = `Сделано: ${done.length}` + (left.length ? `, не успели: ${left.length}` : "") + `. Завтра дел: ${tomorrow.length}`;
    return { text: lines.join("\n"), short, left: left.length };
  }
  async runEvening(now = this.now(), force = false): Promise<Note | null> {
    if (this.briefing || (!force && this.autoState.eveningDay === localKey(now))) return null;
    this.autoState.eveningDay = localKey(now);
    const f = this.eveningFacts(now);
    return this.writeAuto("evening", f.text, "Итог дня. " + f.short, now, force);
  }
  /** The week that ends today (seven days): what was done, what got stuck, how the goals moved, what is next. */
  weekFacts(now = this.now()): { text: string; short: string } {
    const end = dayStart(now) + 86_400_000, start = end - 7 * 86_400_000;
    const todos = this.notes.filter((n) => n.kind === "todo");
    const done = todos.filter((n) => n.done && n.completedAt && Date.parse(n.completedAt) >= start && Date.parse(n.completedAt) < end);
    const byDay = new Map<string, number>();
    for (const n of done) { const k = new Date(n.completedAt!).toLocaleDateString("ru-RU", { weekday: "long" }); byDay.set(k, (byDay.get(k) ?? 0) + 1); }
    const best = [...byDay].sort((x, y) => y[1] - x[1])[0];
    const open = todos.filter((n) => !n.done);
    const stuck = open.filter((n) => (n.rolled ?? 0) >= Math.max(2, this.automation.stuckAfter || 3));
    const overdue = open.filter((n) => n.dueAt && Date.parse(n.dueAt) < end - 86_400_000);
    const next = open.filter((n) => n.dueAt && Date.parse(n.dueAt) >= end && Date.parse(n.dueAt) < end + 7 * 86_400_000);
    const nextBy = new Map<string, number>();
    for (const n of next) { const k = new Date(n.dueAt!).toLocaleDateString("ru-RU", { weekday: "long" }); nextBy.set(k, (nextBy.get(k) ?? 0) + 1); }
    const busiest = [...nextBy].sort((x, y) => y[1] - x[1])[0];
    const goals = this.missionBoard().filter((m) => m.status === "active");
    const from = new Date(start).toLocaleDateString("ru-RU", { day: "numeric", month: "long" }), to = new Date(end - 1).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
    const lines = [`Обзор недели: ${from} — ${to}.`];
    lines.push(done.length ? `Сделано дел: ${done.length}` + (best && best[1] > 1 ? `, больше всего — ${best[0]} (${best[1]})` : "") + "." : "За неделю ничего не отмечено сделанным.");
    if (stuck.length) lines.push(`Застряло: ${stuck.slice(0, 3).map((n) => `«${n.text}»`).join(", ")}. Стоит разбить на шаги или убрать.`);
    if (overdue.length) lines.push(`Просрочено: ${overdue.length}.`);
    for (const m of goals.slice(0, 3)) {
      const moved = m.stages.filter((s) => { const n = this.notes.find((x) => x.id === s.id); return n?.completedAt && Date.parse(n.completedAt) >= start; }).length;
      lines.push(`Цель «${m.title}»: ${m.percent}%` + (moved ? `, за неделю шагов: ${moved}` : ", за неделю не двигалась") + ".");
    }
    if (this.automation.streaks) {
      const s = open.filter((n) => n.repeat && (n.streak ?? 0) >= 3).sort((x, y) => (y.streak ?? 0) - (x.streak ?? 0))[0];
      if (s) lines.push(`Лучшая серия: «${s.text}» — ${s.streak} подряд.`);
    }
    lines.push(next.length ? `На следующую неделю дел: ${next.length}` + (busiest && busiest[1] > 1 ? `, самый загруженный день — ${busiest[0]} (${busiest[1]})` : "") + "." : "На следующую неделю дел со сроком пока нет.");
    return { text: lines.join("\n"), short: `Сделано за неделю: ${done.length}` + (stuck.length ? `, застряло: ${stuck.length}` : "") };
  }
  async runWeek(now = this.now(), force = false): Promise<Note | null> {
    if (this.briefing || (!force && this.autoState.weekDay === localKey(now))) return null;
    this.autoState.weekDay = localKey(now);
    const f = this.weekFacts(now);
    return this.writeAuto("week", f.text, "Обзор недели. " + f.short, now, force);
  }

  /** How full a day is: minutes of to-dos due that day (30 when not set) against the free hours; what to move when it is too much. */
  dayLoad(day: string, now = this.now()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw bad("День: YYYY-MM-DD");
    const dk = this.dayKind(day), hours = this.automation.dayHours;
    const capacity = hours ? (dk.work ? (dk.short ? Math.max(1, hours - 1) : hours) : Math.ceil(hours / 2)) * 60 : 0;
    const items = this.notes.filter((n) => n.kind === "todo" && !n.done && n.dueAt && localKey(Date.parse(n.dueAt)) === day);
    const mins = (n: Note) => n.estimateMinutes ?? 30;
    const planned = items.reduce((s, n) => s + mins(n), 0);
    const over = capacity > 0 && planned > capacity;
    const move: { id: string; text: string; minutes: number }[] = [];
    if (over) {
      const rank = (n: Note) => (n.priority === "low" ? 0 : 1) * 2 + (n.dueAt && dateOnly(n.dueAt) ? 0 : 1);
      let rest = planned;
      for (const n of items.filter((x) => x.priority !== "high").sort((x, y) => rank(x) - rank(y) || mins(y) - mins(x))) {
        if (rest <= capacity) break;
        move.push({ id: n.id, text: n.text, minutes: mins(n) });
        rest -= mins(n);
      }
    }
    void now;
    return { day, capacity, planned, over, count: items.length, work: dk.work, move };
  }

  /**
   * «Разложить день»: to-dos without a time of their own get one in the free windows of the day
   * (09:00 to the end of the working hours, lunch 13–14; a day off 10:00 to the afternoon), around what already has a time.
   * With `apply` the chosen ones are saved; otherwise it is only a proposal.
   */
  async arrangeDay(day: string, apply = false, ids?: string[]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw bad("День: YYYY-MM-DD");
    const now = this.now(), today = localKey(now) === day;
    if (day < localKey(now)) throw bad("Этот день уже прошёл", 409);
    const dk = this.dayKind(day), hours = this.automation.dayHours || 8;
    const base = new Date(day + "T00:00").getTime();
    const from = dk.work ? 9 * 60 : 10 * 60;
    const lunch = dk.work && hours >= 6;
    const to = Math.min(23 * 60, from + (dk.work ? (dk.short ? hours - 1 : hours) : Math.ceil(hours / 2)) * 60 + (lunch ? 60 : 0));
    const busy: [number, number][] = lunch ? [[13 * 60, 14 * 60]] : [];
    const minOf = (iso: string) => Math.round((Date.parse(iso) - base) / 60_000);
    const open = this.notes.filter((n) => n.kind === "todo" && !n.done);
    for (const n of open) if (n.dueAt && !dateOnly(n.dueAt) && localKey(Date.parse(n.dueAt)) === day) busy.push([minOf(n.dueAt), minOf(n.dueAt) + (n.estimateMinutes ?? 30)]);
    for (const r of this.reminders) if (r.status === "scheduled" && !r.rule && localKey(Date.parse(r.at)) === day) busy.push([minOf(r.at), minOf(r.at) + 15]);
    const dayStartMs = base;
    const reasonOf = (n: Note) => n.dueAt && Date.parse(n.dueAt) < dayStart(now) ? "просрочено" : n.dueAt ? "срок в этот день" : n.priority === "high" ? "важное без срока" : "без срока";
    const order = (n: Note) => (n.dueAt && Date.parse(n.dueAt) < dayStartMs ? 0 : n.dueAt ? 1 : n.priority === "high" ? 2 : n.priority === "low" ? 4 : 3);
    const cands = open.filter((n) => !this.notes.some((k) => k.parentId === n.id && !k.done) && (
      (n.dueAt && dateOnly(n.dueAt) && localKey(Date.parse(n.dueAt)) === day) ||
      (today && n.dueAt && Date.parse(n.dueAt) < dayStart(now)) ||
      (!n.dueAt && n.priority !== "low")))
      .sort((x, y) => order(x) - order(y) || x.createdAt.localeCompare(y.createdAt));
    let cursor = from;
    if (today) cursor = Math.max(from, Math.ceil((minsNow(now) + 5) / 15) * 15);
    const placed: { id: string; text: string; start: string; minutes: number; reason: string }[] = [];
    let left = 0;
    for (const n of cands) {
      const dur = n.estimateMinutes ?? 30;
      let t = cursor, ok = false;
      while (t + dur <= to) {
        const clash = busy.find(([s, e]) => t < e && t + dur > s);
        if (!clash) { ok = true; break; }
        t = Math.ceil(clash[1] / 15) * 15;
      }
      if (!ok) { left++; continue; }
      busy.push([t, t + dur]);
      placed.push({ id: n.id, text: n.text, start: new Date(base + t * 60_000).toISOString(), minutes: dur, reason: reasonOf(n) });
    }
    placed.sort((x, y) => x.start.localeCompare(y.start));
    const window = { from: `${String(Math.floor(from / 60)).padStart(2, "0")}:${String(from % 60).padStart(2, "0")}`, to: `${String(Math.floor(to / 60)).padStart(2, "0")}:${String(to % 60).padStart(2, "0")}` };
    if (!apply) return { day, window, placed, left, applied: 0 };
    const pick = ids ? placed.filter((p) => ids.includes(p.id)) : placed;
    const undo: NonNullable<AutoLogEntry["undo"]>["notes"] = [];
    for (const p of pick) {
      const n = this.notes.find((x) => x.id === p.id)!;
      undo.push({ id: n.id, dueAt: n.dueAt ?? null, rolled: n.rolled ?? null });
      n.dueAt = p.start; delete n.rolled; delete n.remindedFor;
    }
    if (pick.length) { this.addLog("arrange", `Разложила день ${new Date(base + 12 * 3_600_000).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}: дел ${pick.length}`, { notes: undo }); await this.save(); }
    return { day, window, placed, left, applied: pick.length };
  }

  /** Moves to-dos to tomorrow or to the next working day after their own day, keeping their time. Logged, so it can be undone. */
  async moveTasks(ids: unknown, to: unknown): Promise<Note[]> {
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || !ids.every((x) => typeof x === "string")) throw bad("Список дел: от 1 до 100");
    if (to !== "tomorrow" && to !== "workday") throw bad("Куда: tomorrow или workday");
    const now = this.now(), undo: NonNullable<AutoLogEntry["undo"]>["notes"] = [], out: Note[] = [];
    for (const id of ids as string[]) {
      const n = this.notes.find((x) => x.id === id && x.kind === "todo" && !x.done);
      if (!n) continue;
      const from = n.dueAt ? new Date(n.dueAt) : new Date(dayStart(now) + (23 * 60 + 59) * 60_000);
      const d = new Date(Math.max(dayStart(from.getTime()), dayStart(now)));
      d.setHours(from.getHours(), from.getMinutes(), 0, 0);
      d.setDate(d.getDate() + 1);
      if (to === "workday") for (let i = 0; i < 30 && !this.workday(d); i++) d.setDate(d.getDate() + 1);
      undo.push({ id: n.id, dueAt: n.dueAt ?? null, rolled: n.rolled ?? null });
      n.dueAt = d.toISOString(); delete n.rolled; delete n.remindedFor;
      out.push({ ...n });
    }
    if (!out.length) throw bad("Нечего переносить", 409);
    const where = to === "tomorrow" ? "на завтра" : "на рабочий день";
    this.addLog("move", `Перенесла ${where} (${out.length}): ` + this.names(out.map((n) => n.id)), { notes: undo });
    await this.save();
    return out;
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
  /** Quiet hours now: the page shows reminders without sound and gathers them for the morning. */
  quiet: boolean;
}
/** Everything worth saying at the start of the day, as data. The assistant (or the Home page) turns it into words. */
export function buildBrief(input: { now: number; reminders: Reminder[]; notes: Note[]; plansRunning: number; memoryPending: number; modulesFailed: string[]; updateAvailable: boolean; quiet?: boolean }): Brief {
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
    quiet: !!input.quiet,
  };
}
