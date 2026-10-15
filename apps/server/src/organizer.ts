import { randomUUID } from "node:crypto";
import { isWorkday, nextHoliday, prodDay } from "@juunibi/core";
import { OrganizerRepository } from "./organizer-repository";
import { TaskService } from "./task-service";
import { ReminderService } from "./reminder-service";
import { AutomationEngine } from "./automation-engine";

export interface Mission { id: string; title: string; description: string; createdAt: string; status: "active" | "paused" | "complete" }
export interface Note {
  id: string; kind: "note" | "todo"; text: string; done: boolean; createdAt: string; priority?: "low" | "normal" | "high"; dueAt?: string; project?: string; parentId?: string; estimateMinutes?: number; completedAt?: string;
  /** A repeating to-do: ticking it off creates the next one. */
  repeat?: Repeat; repeatDay?: number;
  /** The copy created when this one was ticked off (removed again if the tick is undone). */
  nextId?: string;
  /** Exact original next occurrence; undo must never delete a copy edited by the owner or automation. */
  nextSnapshot?: string;
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
  /** Work or personal; unset follows the project (see `areaOf`). */
  area?: Area;
  /** Where a to-do stands between «Надо сделать» (unset) and done: «В работе» or «Жду ответа». */
  status?: TaskStatus;
  /** «Жду ответа»: from whom, and when to ask again (one reminder at that moment). */
  waitingFor?: string;
  followUpAt?: string;
  /** The `followUpAt` a reminder was already sent for. */
  followedUp?: string;
  /** A meeting: `dueAt` is its start and `estimateMinutes` its length. */
  meeting?: boolean;
  /** When the status last changed (so the board can say «ждёте 3 дня»). */
  statusAt?: string;
  /** The place on the board within its column, set by dragging (lower first; unset after the ranked ones). */
  rank?: number;
  /** Files from «Диск» attached to the to-do (id and the name at the time, so a missing file still reads well). */
  files?: FileLink[];
}
export interface FileLink { id: string; name: string }
const MAX_LINKS = 20;
/** Attached files from a request or the saved file: distinct ids, short names, at most MAX_LINKS. */
export function cleanLinks(v: unknown): FileLink[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: FileLink[] = [];
  for (const x of v) {
    const o = x as Partial<FileLink> | null;
    if (!o || typeof o.id !== "string" || !/^[0-9a-f-]{36}$/.test(o.id) || typeof o.name !== "string" || !o.name.trim() || out.some((l) => l.id === o.id)) continue;
    out.push({ id: o.id, name: o.name.trim().slice(0, 180) });
    if (out.length >= MAX_LINKS) break;
  }
  return out.length ? out : undefined;
}
export type Area = "work" | "personal";
export type TaskStatus = "doing" | "waiting";
/** A project's look and plan: colour, deadline and whether it is work. Projects themselves are the `project` names of to-dos. */
export interface ProjectMeta { name: string; color?: string; dueAt?: string; area?: Area; files?: FileLink[] }
export const PROJECT_COLORS = ["gold", "blue", "green", "violet", "red", "teal", "orange", "gray"];
/** A saved quick-entry line («отчёт по пятницам в 17:00 #работа»), added again with one click. */
export interface TaskTemplate { id: string; text: string }
/** Days away from work: on them work to-dos are not planned and not moved in. */
export interface DayOff { id: string; from: string; to: string; kind: "vacation" | "sick" }
/** A to-do's sphere: its own, else its project's, else «work» for a project named работа/work. */
export function areaOf(n: Pick<Note, "area" | "project">, projects: ProjectMeta[] = []): Area {
  if (n.area) return n.area;
  if (!n.project) return "personal";
  const p = projects.find((x) => x.name.toLowerCase() === n.project!.toLowerCase());
  if (p?.area) return p.area;
  return /^(работа|work|рабочее)$/i.test(n.project) ? "work" : "personal";
}
export type AutoNote = "brief" | "evening" | "week";
/**
 * One thing that happened to a note or to-do, kept for «Дела и достижения» (achievements.ts): what was added, ticked off,
 * moved, edited or removed and when. The text is a short copy, so a removed to-do can still be named.
 */
export interface TaskEvent {
  at: string; id: string; kind: "add" | "done" | "undone" | "move" | "edit" | "remove";
  text: string; todo: boolean;
  /** A move: the due dates before and after (null = no date). */
  from?: string | null; to?: string | null;
  /** Done by the automation, not by the owner. */
  auto?: boolean;
}
const EVENT_KINDS: TaskEvent["kind"][] = ["add", "done", "undone", "move", "edit", "remove"];
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
  /** The working week for the production calendar's hour norm in «Дела»: 40, 36 or 24 hours. */
  weekHours: 40 | 36 | 24;
  /** Streaks of repeating to-dos. */
  streaks: boolean;
  /** Working hours: inside them on a working day the list shows work first, outside them personal first. */
  workFrom: string;
  workTo: string;
  workFirst: boolean;
  /** After the working day: offer to move the work to-dos still open to the next working day. */
  eveningMove: boolean;
  rules: AutoRule[];
}
export const DEFAULT_AUTOMATION: Automation = {
  brief: true, briefTime: "09:00", rollOverdue: true, dueReminder: "15", workdays: true,
  evening: true, eveningTime: "21:00", quiet: true, quietFrom: "23:00", quietTo: "08:00",
  stuckAfter: 3, holidayWarn: true, weekly: true, goalNudge: 3, chatPromises: true, dayHours: 8, weekHours: 40, streaks: true,
  workFrom: "09:00", workTo: "18:00", workFirst: true, eveningMove: true, rules: [],
};
/** One line of «Что сделала автоматика», with what is needed to take it back. */
export interface AutoLogEntry {
  id: string; at: string;
  kind: "roll" | "remind" | "brief" | "evening" | "week" | "quiet" | "arrange" | "move" | "rule";
  text: string;
  /** Previous due date, «перенесено» count and importance of the to-dos it changed; reminders and notes it created. */
  undo?: { notes?: { id: string; dueAt: string | null; rolled: number | null; priority?: Note["priority"] | null; expectedDueAt?: string | null }[]; reminders?: string[]; created?: string[] };
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
const MAX_NOTES = 500, MAX_REMINDERS = 200, MAX_TEXT = 500, MAX_AUTO_TEXT = 1500, MAX_LOG = 60, MAX_HISTORY = 4000;
const YEAR = 366 * 86_400_000;
const MAX_PROJECTS = 100, MAX_TEMPLATES = 30, MAX_DAYS_OFF = 50;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
function cleanProject(v: unknown): ProjectMeta | null {
  const o = v as Partial<ProjectMeta> | null;
  if (!o || typeof o.name !== "string" || !o.name.trim() || o.name.length > 80) return null;
  const p: ProjectMeta = { name: o.name.trim() };
  if (typeof o.color === "string" && PROJECT_COLORS.includes(o.color)) p.color = o.color;
  if (typeof o.dueAt === "string" && DAY_RE.test(o.dueAt)) p.dueAt = o.dueAt;
  if (o.area === "work" || o.area === "personal") p.area = o.area;
  const files = cleanLinks(o.files);
  if (files) p.files = files;
  return p;
}
const bad = (message: string, status = 400) => Object.assign(new Error(message), { status });
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
  for (const k of ["brief", "rollOverdue", "workdays", "evening", "quiet", "holidayWarn", "weekly", "chatPromises", "streaks", "workFirst", "eveningMove"] as const) if (typeof o[k] === "boolean") a[k] = o[k] as boolean;
  for (const k of ["briefTime", "eveningTime", "quietFrom", "quietTo", "workFrom", "workTo"] as const) if (typeof o[k] === "string" && TIME_RE.test(o[k] as string)) a[k] = o[k] as string;
  if (o.dueReminder === "off" || o.dueReminder === "15" || o.dueReminder === "60" || o.dueReminder === "morning") a.dueReminder = o.dueReminder;
  if ([0, 2, 3, 5].includes(o.stuckAfter as number)) a.stuckAfter = o.stuckAfter as number;
  if ([0, 3, 7, 14].includes(o.goalNudge as number)) a.goalNudge = o.goalNudge as number;
  if (o.weekHours === 40 || o.weekHours === 36 || o.weekHours === 24) a.weekHours = o.weekHours;
  if (Number.isInteger(o.dayHours) && (o.dayHours as number) >= 0 && (o.dayHours as number) <= 16) a.dayHours = o.dayHours as number;
  if (Array.isArray(o.rules)) a.rules = o.rules.map(cleanRule).filter((r): r is AutoRule => !!r).slice(0, 20);
  if (minsOf(a.workFrom) >= minsOf(a.workTo)) { a.workFrom = DEFAULT_AUTOMATION.workFrom; a.workTo = DEFAULT_AUTOMATION.workTo; }
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
  if (c.nextSnapshot !== undefined && (typeof c.nextSnapshot !== "string" || c.nextSnapshot.length > 4096)) delete c.nextSnapshot;
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
  if (c.area !== undefined && c.area !== "work" && c.area !== "personal") delete c.area;
  if (c.status !== undefined && c.status !== "doing" && c.status !== "waiting") delete c.status;
  if (c.waitingFor !== undefined && (typeof c.waitingFor !== "string" || !c.waitingFor.trim() || c.waitingFor.length > 80)) delete c.waitingFor;
  for (const k of ["followUpAt", "followedUp"] as const) if (c[k] !== undefined && (typeof c[k] !== "string" || !Number.isFinite(Date.parse(c[k]!)))) delete c[k];
  if (c.status !== "waiting") { delete c.waitingFor; delete c.followUpAt; delete c.followedUp; }
  if (c.meeting !== undefined && c.meeting !== true) delete c.meeting;
  if (c.statusAt !== undefined && (typeof c.statusAt !== "string" || !Number.isFinite(Date.parse(c.statusAt)))) delete c.statusAt;
  if (c.rank !== undefined && !(Number.isInteger(c.rank) && c.rank >= 0 && c.rank < 100_000)) delete c.rank;
  if (c.files !== undefined) { const f = cleanLinks(c.files); if (f) c.files = f; else delete c.files; }
  if (c.kind === "note") { delete c.area; delete c.status; delete c.meeting; delete c.priority; delete c.dueAt; delete c.parentId; delete c.estimateMinutes; delete c.repeat; delete c.repeatDay; delete c.rolled; delete c.streak; delete c.ruled; delete c.statusAt; delete c.rank; }
  return c;
}

/** Notes, to-do items and reminders kept by the owner and (with approval) by the assistant. */
export class Organizer {
  private notes: Note[] = [];
  private missions: Mission[] = [];
  private reminders: Reminder[] = [];
  private readonly repository: OrganizerRepository;
  private readonly taskService: TaskService;
  private readonly reminderService: ReminderService;
  private readonly automationEngine: AutomationEngine;
  private automation: Automation = { ...DEFAULT_AUTOMATION };
  /** The local days the brief, the overdue roll-over, the evening summary and the weekly review last ran. */
  private autoState: { briefDay?: string; rollDay?: string; eveningDay?: string; weekDay?: string } = {};
  /** «Что сделала автоматика», newest last. */
  private log: AutoLogEntry[] = [];
  /** What happened to notes and to-dos, oldest first (see TaskEvent). */
  private history: TaskEvent[] = [];
  /** Every action of the automation, counted for «Возвращённые часы» (the log itself keeps only the last 60). */
  private autoCount: Partial<Record<AutoLogEntry["kind"], number>> = {};
  /** Durable operation ids prevent an accidentally repeated request moving tasks twice. */
  private moveRequests: string[] = [];
  private projects: ProjectMeta[] = [];
  private templates: TaskTemplate[] = [];
  private daysOff: DayOff[] = [];
  private briefing = false;
  /**
   * Writes the morning brief in words (the assistant, when Cloud.ru is configured); returns null to keep the plain one.
   * Set by the server after the assistant is ready.
   */
  composeBrief?: (facts: string) => Promise<string | null>;
  constructor(file: string, private readonly now: () => number = Date.now) {
    this.repository = new OrganizerRepository(file);
    this.taskService = new TaskService({
      getNotes: () => this.notes,
      replaceNotes: (notes) => { this.notes = notes; },
      save: () => this.save(),
      now: this.now,
      makeRoom: () => this.makeRoom(),
      record: (kind, note, extra) => this.record(kind, note, extra),
      workday: (date) => this.workday(date),
      nextOccurrence,
      cleanLinks,
    });
    this.reminderService = new ReminderService({
      getReminders: () => this.reminders,
      replaceReminders: (reminders) => { this.reminders = reminders; },
      getNotes: () => this.notes,
      getAutomation: () => this.automation,
      save: () => this.save(),
      now: this.now,
      workday: (date) => this.workday(date),
      alignStart,
      nextOccurrence,
      inQuiet,
    });
    this.automationEngine = new AutomationEngine({
      getNotes: () => this.notes,
      replaceNotes: (notes) => { this.notes = notes; },
      getReminders: () => this.reminders,
      replaceReminders: (reminders) => { this.reminders = reminders; },
      getAutomation: () => this.automation,
      getAutoState: () => this.autoState,
      getLog: () => this.log,
      replaceLog: (log) => { this.log = log; },
      getAutoCount: () => this.autoCount,
      getHistory: () => this.history,
      save: () => this.save(),
      now: this.now,
      isQuiet: (now) => this.isQuiet(now),
      awayOn: (day) => this.awayOn(day),
      workDayFor: (date) => this.workDayFor(date),
      isWork: (note) => this.isWork(note),
      record: (kind, note, extra) => this.record(kind, note, extra),
    });
  }
  /** A working day for "по будням": the production calendar when the owner keeps it on, else Monday to Friday. */
  private workday = (d: Date) => this.automation.workdays ? isWorkday(d) : weekday(d);

  async load() {
    try {
      const raw = await this.repository.load<{ notes?: unknown; reminders?: unknown; missions?: unknown; automation?: unknown; autoState?: Record<string, unknown>; log?: unknown; history?: unknown; autoCount?: unknown; moveRequests?: unknown; projects?: unknown; templates?: unknown; daysOff?: unknown }>();
      if (Array.isArray(raw.projects)) this.projects = raw.projects.map(cleanProject).filter((x): x is ProjectMeta => !!x).slice(0, MAX_PROJECTS);
      if (Array.isArray(raw.templates)) this.templates = raw.templates.filter((t): t is TaskTemplate => !!t && typeof t.id === "string" && typeof t.text === "string" && !!t.text.trim() && t.text.length <= MAX_TEXT).slice(0, MAX_TEMPLATES);
      if (Array.isArray(raw.daysOff)) this.daysOff = raw.daysOff.filter((d): d is DayOff => !!d && typeof d.id === "string" && DAY_RE.test(d.from) && DAY_RE.test(d.to) && d.from <= d.to && (d.kind === "vacation" || d.kind === "sick")).slice(-MAX_DAYS_OFF);
      this.automation = cleanAutomation(raw.automation);
      if (raw.autoState && typeof raw.autoState === "object") {
        for (const k of ["briefDay", "rollDay", "eveningDay", "weekDay"] as const) if (typeof raw.autoState[k] === "string") this.autoState[k] = raw.autoState[k] as string;
      }
      if (Array.isArray(raw.log)) this.log = raw.log.filter((e): e is AutoLogEntry => !!e && typeof e.id === "string" && typeof e.at === "string" && typeof e.kind === "string" && typeof e.text === "string").slice(-MAX_LOG);
      if (Array.isArray(raw.history)) this.history = raw.history.filter((e): e is TaskEvent => !!e && typeof e.at === "string" && Number.isFinite(Date.parse(e.at)) && typeof e.id === "string" && EVENT_KINDS.includes(e.kind) && typeof e.text === "string" && typeof e.todo === "boolean").slice(-MAX_HISTORY);
      if (Array.isArray(raw.moveRequests)) this.moveRequests = raw.moveRequests.filter((v):v is string=>typeof v==="string" && /^[a-zA-Z0-9_-]{8,100}$/.test(v)).slice(-200);
      if (raw.autoCount && typeof raw.autoCount === "object") for (const [k, v] of Object.entries(raw.autoCount)) if (Number.isInteger(v) && (v as number) >= 0) this.autoCount[k as AutoLogEntry["kind"]] = v as number;
      if (Array.isArray(raw.missions)) this.missions = raw.missions.filter((m): m is Mission => !!m && typeof m.id === "string" && typeof m.title === "string" && typeof m.description === "string" && typeof m.createdAt === "string" && ["active","paused","complete"].includes(m.status)).slice(-100);
      if (Array.isArray(raw.notes)) this.notes = raw.notes.filter((n): n is Note => !!n && typeof n.id === "string" && (n.kind === "note" || n.kind === "todo") && typeof n.text === "string" && n.text.length <= (n.auto ? MAX_AUTO_TEXT : MAX_TEXT) && typeof n.done === "boolean" && typeof n.createdAt === "string" && Number.isFinite(Date.parse(n.createdAt))).slice(-MAX_NOTES).map(cleanNote);
      // a subtask whose parent is gone becomes an ordinary to-do
      const ids = new Set(this.notes.map((n) => n.id));
      for (const n of this.notes) if (n.parentId && !ids.has(n.parentId)) delete n.parentId;
      if (Array.isArray(raw.reminders)) this.reminders = raw.reminders.filter((r): r is Reminder => !!r && typeof r.id === "string" && typeof r.text === "string" && r.text.length <= MAX_TEXT && !Number.isNaN(Date.parse(r.at)) && ["scheduled", "due", "done"].includes(r.status) && (r.repeat === undefined || REPEATS.includes(r.repeat))).slice(-MAX_REMINDERS);
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
  private save() {
    return this.repository.save({
      notes: this.notes,
      reminders: this.reminders,
      missions: this.missions,
      automation: this.automation,
      autoState: this.autoState,
      log: this.log,
      history: this.history,
      autoCount: this.autoCount,
      moveRequests: this.moveRequests,
      projects: this.projects,
      templates: this.templates,
      daysOff: this.daysOff,
    });
  }
  flush() { return this.repository.flush(); }

  /** «Дела и достижения» read the whole story: events oldest first, and how often the automation did each thing. */
  listHistory(): TaskEvent[] { return this.history.map((e) => ({ ...e })); }
  autoCounts(): Partial<Record<AutoLogEntry["kind"], number>> { return this.automationEngine.counts(); }
  listMissions(): Mission[] { return this.missions.map((m) => ({ ...m })); }
  private record(kind: TaskEvent["kind"], n: Note, extra: Partial<TaskEvent> = {}) {
    if (n.auto) return;
    this.history.push({ at: new Date(this.now()).toISOString(), id: n.id, kind, text: n.text.slice(0, 120), todo: n.kind === "todo", ...extra });
    if (this.history.length > MAX_HISTORY) this.history = this.history.slice(-MAX_HISTORY);
  }
  /**
   * Room for one more record: at the limit the oldest finished to-dos go (not goal steps, not ones with subtasks).
   * Without it a daily repeating to-do filled the list in a year and then silently stopped repeating.
   */
  private makeRoom(): boolean {
    if (this.notes.length < MAX_NOTES) return true;
    const parents = new Set(this.notes.map((n) => n.parentId).filter(Boolean));
    const goals = new Set(this.missions.map((m) => m.id));
    const old = this.notes.filter((n) => n.kind === "todo" && n.done && !parents.has(n.id) && !(n.project && goals.has(n.project)))
      .sort((a, b) => (a.completedAt ?? a.createdAt).localeCompare(b.completedAt ?? b.createdAt))[0];
    if (!old) return false;
    this.notes = this.notes.filter((n) => n !== old);
    return true;
  }

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
  // ---------- projects, templates, days away ----------
  listProjects(): ProjectMeta[] { return this.projects.map((p) => ({ ...p })); }
  /** Colour, deadline (YYYY-MM-DD) or sphere of a project; null clears a field. A project with nothing set is forgotten. */
  async setProject(name: unknown, patch: Record<string, unknown>): Promise<ProjectMeta> {
    if (typeof name !== "string" || !name.trim() || name.trim().length > 80) throw bad("Название проекта: от 1 до 80 символов");
    const key = name.trim();
    const cur = this.projects.find((p) => p.name.toLowerCase() === key.toLowerCase()) ?? { name: key };
    const next: ProjectMeta = { ...cur };
    if ("color" in patch) { if (patch.color === null || patch.color === "") delete next.color; else if (typeof patch.color === "string" && PROJECT_COLORS.includes(patch.color)) next.color = patch.color; else throw bad("Цвет: " + PROJECT_COLORS.join(", ")); }
    if ("dueAt" in patch) { if (patch.dueAt === null || patch.dueAt === "") delete next.dueAt; else if (typeof patch.dueAt === "string" && DAY_RE.test(patch.dueAt)) next.dueAt = patch.dueAt; else throw bad("Срок проекта: YYYY-MM-DD"); }
    if ("area" in patch) { if (patch.area === null || patch.area === "") delete next.area; else if (patch.area === "work" || patch.area === "personal") next.area = patch.area; else throw bad("Сфера: work или personal"); }
    if ("files" in patch) { if (patch.files !== null && !Array.isArray(patch.files)) throw bad("Файлы: список"); const f = cleanLinks(patch.files); if (f) next.files = f; else delete next.files; }
    this.projects = this.projects.filter((p) => p !== cur);
    if (next.color || next.dueAt || next.area || next.files) {
      if (this.projects.length >= MAX_PROJECTS) throw bad(`Достигнут предел: ${MAX_PROJECTS} проектов`, 409);
      this.projects.push(next);
    }
    await this.save();
    return { ...next };
  }
  listTemplates(): TaskTemplate[] { return this.templates.map((t) => ({ ...t })); }
  async addTemplate(body: unknown): Promise<TaskTemplate> {
    const t = text(body, "Шаблон");
    if (this.templates.some((x) => x.text.toLowerCase() === t.toLowerCase())) throw bad("Такой шаблон уже есть", 409);
    if (this.templates.length >= MAX_TEMPLATES) throw bad(`Достигнут предел: ${MAX_TEMPLATES} шаблонов`, 409);
    const tpl = { id: randomUUID(), text: t };
    this.templates.push(tpl);
    await this.save();
    return { ...tpl };
  }
  async removeTemplate(id: string) {
    if (!this.templates.some((t) => t.id === id)) throw bad("Шаблон не найден", 404);
    this.templates = this.templates.filter((t) => t.id !== id);
    await this.save();
  }
  listDaysOff(): DayOff[] { return this.daysOff.map((d) => ({ ...d })).sort((a, b) => a.from.localeCompare(b.from)); }
  /** A vacation or sick leave from `from` to `to` (local days, inclusive). Returns it with the open work to-dos due inside it. */
  async addDayOff(from: unknown, to: unknown, kind: unknown): Promise<{ dayOff: DayOff; clash: string[] }> {
    if (typeof from !== "string" || !DAY_RE.test(from) || typeof to !== "string" || !DAY_RE.test(to) || !Number.isFinite(Date.parse(from + "T12:00")) || !Number.isFinite(Date.parse(to + "T12:00"))) throw bad("Даты: YYYY-MM-DD");
    if (to < from) throw bad("Конец раньше начала");
    if (Date.parse(to + "T12:00") - Date.parse(from + "T12:00") > YEAR) throw bad("Не длиннее года");
    if (kind !== "vacation" && kind !== "sick") throw bad("Вид: vacation или sick");
    if (this.daysOff.some((d) => d.from <= to && from <= d.to)) throw bad("Эти дни уже отмечены", 409);
    if (this.daysOff.length >= MAX_DAYS_OFF) this.daysOff = this.daysOff.slice(1);
    const d: DayOff = { id: randomUUID(), from, to, kind };
    this.daysOff.push(d);
    await this.save();
    const clash = this.notes.filter((n) => n.kind === "todo" && !n.done && n.dueAt && areaOf(n, this.projects) === "work" && localKey(Date.parse(n.dueAt)) >= from && localKey(Date.parse(n.dueAt)) <= to).map((n) => n.id);
    return { dayOff: { ...d }, clash };
  }
  async removeDayOff(id: string) {
    if (!this.daysOff.some((d) => d.id === id)) throw bad("Не найдено", 404);
    this.daysOff = this.daysOff.filter((d) => d.id !== id);
    await this.save();
  }
  /** The vacation or sick leave on a local day, if any. */
  awayOn(key: string): DayOff | undefined { return this.daysOff.find((d) => d.from <= key && key <= d.to); }
  /** A working day for work to-dos: a working day of the calendar the owner is not away on. */
  private workDayFor = (d: Date) => this.workday(d) && !this.awayOn(localKey(d.getTime()));
  private isWork = (n: Note) => areaOf(n, this.projects) === "work";

  // ---------- notes and to-dos ----------
  listNotes(): Note[] { return this.taskService.listNotes(); }
  addNote(kind: unknown, body: unknown): Promise<Note> { return this.taskService.addNote(kind, body); }
  /** A to-do with its date, importance and repeat in one step (the assistant's add_note). */
  addTask(body: unknown, opts: { dueAt?: unknown; priority?: unknown; repeat?: unknown } = {}): Promise<Note> {
    return this.taskService.addTask(body, opts);
  }
  editNote(id: string, body: unknown): Promise<Note> { return this.taskService.editNote(id, body); }
  /** Optional task details; older stored notes remain readable without migration. */
  updateTask(id: string, patch: Record<string, unknown>): Promise<Note> {
    return this.taskService.updateTask(id, patch);
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
  /** The board's order: the to-dos of one column in the order they were dragged to (ranks 0, 1, 2…). */
  orderTasks(ids: unknown): Promise<{ ok: true }> { return this.taskService.orderTasks(ids); }
  setDone(id: string, done: boolean): Promise<Note> { return this.taskService.setDone(id, done); }
  removeNote(id: string): Promise<void> { return this.taskService.removeNote(id); }

  // ---------- reminders ----------
  listReminders(): Reminder[] { return this.reminderService.list(); }
  addReminder(body: unknown, at: unknown, repeat?: unknown): Promise<Reminder> {
    return this.reminderService.add(body, at, repeat);
  }
  /** Changes the text, time or repeat of a reminder that has not fired yet. Missing fields stay as they are. */
  editReminder(id: string, patch: { text?: unknown; at?: unknown; repeat?: unknown }): Promise<Reminder> {
    return this.reminderService.edit(id, patch);
  }
  /** Snoozes a fired one-off occurrence, never silently shifts its repeating series. */
  snoozeReminder(id: string, minutes: unknown): Promise<Reminder> {
    return this.reminderService.snooze(id, minutes);
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
  dismissReminder(id: string): Promise<Reminder> { return this.reminderService.dismiss(id); }
  removeReminder(id: string): Promise<void> { return this.reminderService.remove(id); }
  /**
   * Marks reminders whose time has come as "due" and returns the newly due ones. Safe to call as often as you like.
   * A repeating reminder fires as a separate one-off copy and moves on to its next time; occurrences missed while
   * JUUNIBI was closed fire once, not once per missed day. Automatic reminders wait out the quiet hours.
   */
  async tick(): Promise<Reminder[]> {
    const now = this.now();
    const a = this.automation;
    const reminderTick = this.reminderService.processDue(now);
    const fired = reminderTick.fired;
    let changed = reminderTick.changed;

    if (reminderTick.releasedFromQuiet) {
      this.automationEngine.addLog("quiet", `Тихие часы: придержала напоминаний до утра: ${reminderTick.releasedFromQuiet}`);
    }

    changed = this.automationEngine.run(now, fired) || changed;
    if (fired.length || changed) {
      this.reminderService.pruneDone();
      await this.save();
    }

    if (a.brief && !this.briefing && this.briefDue(now)) {
      await this.runBrief(now).catch((e: unknown) => console.error("Дела: ошибка автоматизации Brief", e));
    }
    if (a.evening && !this.briefing && this.autoState.eveningDay !== localKey(now) && minsNow(now) >= minsOf(a.eveningTime)) {
      await this.runEvening(now).catch((e: unknown) => console.error("Дела: ошибка автоматизации Evening", e));
    }
    if (a.weekly && !this.briefing && new Date(now).getDay() === 0 && this.autoState.weekDay !== localKey(now) && minsNow(now) >= minsOf(a.eveningTime)) {
      await this.runWeek(now).catch((e: unknown) => console.error("Дела: ошибка автоматизации Week", e));
    }
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

  /** Brain evidence: deterministic audit metrics, not a claim of model training. */
  automationEvidence() { return this.automationEngine.evidence(); }

  /** «Что сделала автоматика», newest first. */
  listLog(): AutoLogEntry[] { return this.automationEngine.listLog(); }

  private addLog(kind: AutoLogEntry["kind"], text: string, undo?: AutoLogEntry["undo"]) {
    this.automationEngine.addLog(kind, text, undo);
  }

  /** Takes back one action of the automation: due dates and marks as they were, created reminders and notes removed. */
  undoLog(id: string): Promise<AutoLogEntry> { return this.automationEngine.undoLog(id); }

  /** The brief runs once a day, from its time until 15:00 (a brief at night would be no use). */
  private briefDue(now: number): boolean {
    if (this.autoState.briefDay === localKey(now)) return false;
    const b = minsOf(this.automation.briefTime), mins = minsNow(now);
    return mins >= b && mins < Math.max(15 * 60, b + 60);
  }
  private dayKind(key: string): { work: boolean; short: boolean; label: string; note?: string; away?: DayOff } {
    const off = this.awayOn(key);
    if (off) return { work: false, short: false, label: (off.kind === "sick" ? "больничный" : "отпуск") + " до " + new Date(off.to + "T12:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long" }), away: off };
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
    // a working day starts with work: meetings, work deadlines and the answers waited for
    const work = dk.work ? todays.filter(this.isWork) : [];
    const waiting = dk.work ? open.filter((n) => n.status === "waiting" && this.isWork(n)) : [];
    if (work.length || waiting.length) {
      const meet = work.filter((n) => n.meeting && !dateOnly(n.dueAt!));
      const due = work.filter((n) => !meet.includes(n));
      const span = (n: Note) => hhmm(Date.parse(n.dueAt!)) + (n.estimateMinutes ? "–" + hhmm(Date.parse(n.dueAt!) + n.estimateMinutes * 60_000) : "");
      const parts = [
        meet.length ? "встречи: " + meet.slice(0, 4).map((n) => span(n) + " " + n.text).join("; ") : "",
        due.length ? "сроки: " + due.slice(0, 4).map(item).join("; ") : "",
        waiting.length ? `жду ответа: ${waiting.length} (` + waiting.slice(0, 2).map((n) => (n.waitingFor ? n.waitingFor + " — " : "") + n.text).join("; ") + ")" : "",
      ].filter(Boolean);
      lines.push("Работа: " + parts.join("; ") + ".");
    }
    const rest = work.length ? todays.filter((n) => !work.includes(n)) : todays;
    if (!work.length || rest.length) lines.push(rest.length ? `${work.length ? "Личные дела" : "Дела"} на сегодня (${rest.length}): ` + rest.slice(0, 5).map(item).join("; ") + (rest.length > 5 ? "…" : ".") : dk.work ? "На сегодня дел со сроком нет." : "Дел на сегодня нет.");
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
    if (!dk.work) lines.push(...this.dayOffAhead(now));
    const text = lines.join("\n").slice(0, MAX_AUTO_TEXT);
    const short = `Сегодня ${todays.length ? "дел: " + todays.length : "дел со сроком нет"}` + (overdue.length ? `, просрочено: ${overdue.length}` : "") + (rems.length ? `, напоминаний: ${rems.length}` : "") + ` · ${kind}`;
    return { text, short };
  }
  /** On a day off, a look ahead instead of «можно отдохнуть»: the next working day, a goal's next step, the next holiday. */
  private dayOffAhead(now: number): string[] {
    const out: string[] = [];
    let d = dayStart(now) + 86_400_000 + 3_600_000;
    for (let i = 0; i < 14 && !this.dayKind(localKey(d)).work; i++) d += 86_400_000;
    const key = localKey(d);
    const todos = this.notes.filter((n) => n.kind === "todo" && !n.done && n.dueAt && localKey(Date.parse(n.dueAt)) === key).sort((x, y) => x.dueAt!.localeCompare(y.dueAt!));
    const when = key === localKey(dayStart(now) + 86_400_000 + 3_600_000) ? "завтра" : new Date(d).toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
    out.push(`Следующий рабочий день — ${when}: ` + (todos.length ? `дел ${todos.length}, первое — ${todos[0]!.text}.` : "дел со сроком пока нет."));
    const g = this.missionBoard().find((m) => m.status === "active" && m.next);
    if (g) out.push(`Цель «${g.title}»: следующий шаг — ${g.next!.text}.`);
    const h = nextHoliday(localKey(now), 60);
    if (h) out.push(`Ближайший праздник: ${new Date(h.key + "T12:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}, ${h.note}, через ${h.days} ${dayWord(h.days)}.`);
    return out;
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
    // yesterday's «Итог дня» nobody pressed «Готово» on is out of date once today's rings
    if (!force) for (const r of this.reminders) if (r.source === kind && r.status === "due") r.status = "done";
    if (!force) this.reminders.push({ id: randomUUID(), text: ring.slice(0, MAX_TEXT), at: stamp, createdAt: stamp, status: "due", firedAt: stamp, source: kind });
    const what = kind === "brief" ? "утреннюю сводку" : kind === "evening" ? "итог дня" : "обзор недели";
    if (!force) this.addLog(kind, "Составила " + what, { created: [note.id] });
    this.reminderService.pruneDone();
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
      // the date and the kind of day are in the page's header already: the brief starts with what matters
      let body = facts.text.split("\n").slice(1).join("\n") || facts.text;
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
    const work = todos.filter((n) => this.isWork(n) && n.dueAt && Date.parse(n.dueAt) >= start && Date.parse(n.dueAt) < end);
    if (work.length) {
      const mins = (xs: Note[]) => xs.reduce((sum, n) => sum + (n.estimateMinutes ?? 30), 0);
      lines.push(`Рабочие часы: запланировано ${hoursText(mins(work))}, сделано ${hoursText(mins(work.filter((n) => n.done)))}.`);
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
    const cands = open.filter((n) => !this.notes.some((k) => k.parentId === n.id && !k.done) && !(dk.away && this.isWork(n)) && (
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
      this.record("move", n, { from: n.dueAt ?? null, to: p.start, auto: true });
      n.dueAt = p.start; delete n.rolled; delete n.remindedFor;
      undo[undo.length - 1]!.expectedDueAt = n.dueAt;
    }
    if (pick.length) { this.addLog("arrange", `Разложила день ${new Date(base + 12 * 3_600_000).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}: дел ${pick.length}`, { notes: undo }); await this.save(); }
    return { day, window, placed, left, applied: pick.length };
  }

  /** Moves to-dos to tomorrow or to the next working day after their own day, keeping their time. Logged, so it can be undone. */
  async moveTasks(ids: unknown, to: unknown, requestId?: unknown): Promise<Note[]> {
    if (requestId !== undefined && (typeof requestId !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId))) throw bad("Некорректный идентификатор операции");
    if (requestId && this.moveRequests.includes(requestId)) throw bad("Этот перенос уже выполнен", 409);
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || !ids.every((x) => typeof x === "string")) throw bad("Список дел: от 1 до 100");
    const toDay = typeof to === "string" && DAY_RE.test(to) && Number.isFinite(Date.parse(to + "T12:00")) ? to : null;
    if (to !== "tomorrow" && to !== "workday" && !toDay) throw bad("Куда: tomorrow, workday или день YYYY-MM-DD");
    const now = this.now(), undo: NonNullable<AutoLogEntry["undo"]>["notes"] = [], out: Note[] = [];
    for (const id of ids as string[]) {
      const n = this.notes.find((x) => x.id === id && x.kind === "todo" && !x.done);
      if (!n) continue;
      const from = n.dueAt ? new Date(n.dueAt) : new Date(dayStart(now) + (23 * 60 + 59) * 60_000);
      const d = toDay ? new Date(toDay + "T00:00") : new Date(Math.max(dayStart(from.getTime()), dayStart(now)));
      d.setHours(from.getHours(), from.getMinutes(), 0, 0);
      if (!toDay) d.setDate(d.getDate() + 1);
      // a work to-do never lands on a vacation or sick day
      const ok = (x: Date) => this.isWork(n) ? this.workDayFor(x) : this.workday(x);
      if (to === "workday") for (let i = 0; i < 400 && !ok(d); i++) d.setDate(d.getDate() + 1);
      undo.push({ id: n.id, dueAt: n.dueAt ?? null, rolled: n.rolled ?? null });
      this.record("move", n, { from: n.dueAt ?? null, to: d.toISOString() });
      n.dueAt = d.toISOString(); delete n.rolled; delete n.remindedFor;
      undo[undo.length - 1]!.expectedDueAt = n.dueAt;
      out.push({ ...n });
    }
    if (!out.length) throw bad("Нечего переносить", 409);
    const where = to === "tomorrow" ? "на завтра" : to === "workday" ? "на рабочий день" : "на " + new Date(toDay + "T12:00").toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
    this.addLog("move", `Перенесла ${where} (${out.length}): ` + this.names(out.map((n) => n.id)), { notes: undo });
    if (requestId) this.moveRequests = [...this.moveRequests, requestId].slice(-200);
    await this.save();
    return out;
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
