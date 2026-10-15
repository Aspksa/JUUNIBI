import { isWorkday } from "@juunibi/core";
import { OrganizerRepository } from "./organizer-repository";
import { TaskService } from "./task-service";
import { ReminderService } from "./reminder-service";
import { AutomationEngine } from "./automation-engine";
import { PlanningService } from "./planning-service";
import { BriefService } from "./brief-service";
import { MissionService } from "./mission-service";
import {
  WorkspaceService,
  areaOf,
  PROJECT_COLORS,
  MAX_PROJECTS,
  MAX_TEMPLATES,
  MAX_DAYS_OFF,
  DAY_RE,
  type Area,
  type ProjectMeta,
  type TaskTemplate,
  type DayOff,
} from "./workspace-service";

export { areaOf, PROJECT_COLORS } from "./workspace-service";
export type { Area, ProjectMeta, TaskTemplate, DayOff } from "./workspace-service";
export type TaskStatus = "doing" | "waiting";

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
  private readonly briefService: BriefService;
  private readonly missionService: MissionService;
  private readonly planningService: PlanningService;
  private readonly workspaceService: WorkspaceService;
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
  /**
   * Writes the morning brief in words (the assistant, when Cloud.ru is configured); returns null to keep the plain one.
   * Set by the server after the assistant is ready.
   */
  composeBrief?: (facts: string) => Promise<string | null>;
  constructor(file: string, private readonly now: () => number = Date.now) {
    this.repository = new OrganizerRepository(file);
    this.workspaceService = new WorkspaceService({
      getProjects: () => this.projects,
      replaceProjects: (projects) => { this.projects = projects; },
      getTemplates: () => this.templates,
      replaceTemplates: (templates) => { this.templates = templates; },
      getDaysOff: () => this.daysOff,
      replaceDaysOff: (daysOff) => { this.daysOff = daysOff; },
      getNotes: () => this.notes,
      save: () => this.save(),
      workday: (date) => this.workday(date),
      cleanLinks,
    });
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
    this.missionService = new MissionService({
      getMissions: () => this.missions,
      getNotes: () => this.notes,
      save: () => this.save(),
      now: this.now,
      addNote: (_kind, body) => this.taskService.addNote("todo", body),
      updateTask: (id, patch) => this.taskService.updateTask(id, patch),
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
    let planning!: PlanningService;
    this.briefService = new BriefService({
      getNotes: () => this.notes,
      replaceNotes: (notes) => { this.notes = notes; },
      getReminders: () => this.reminders,
      getAutomation: () => this.automation,
      getAutoState: () => this.autoState,
      now: this.now,
      awayOn: (day) => this.awayOn(day),
      isWork: (note) => this.isWork(note),
      dayLoad: (day, now) => planning.dayLoad(day, now),
      missionBoard: () => this.missionBoard(),
      addLog: (kind, text, undo) => this.automationEngine.addLog(kind, text, undo),
      pruneReminders: () => this.reminderService.pruneDone(),
      save: () => this.save(),
      getComposer: () => this.composeBrief,
    });
    planning = new PlanningService({
      getNotes: () => this.notes,
      getReminders: () => this.reminders,
      getAutomation: () => this.automation,
      getMoveRequests: () => this.moveRequests,
      replaceMoveRequests: (requests) => { this.moveRequests = requests; },
      now: this.now,
      dayKind: (day) => this.briefService.dayKind(day),
      isWork: (note) => this.isWork(note),
      workday: (date) => this.workday(date),
      workDayFor: (date) => this.workDayFor(date),
      record: (kind, note, extra) => this.record(kind, note, extra),
      addLog: (kind, text, undo) => this.automationEngine.addLog(kind, text, undo),
      describeNames: (ids) => this.automationEngine.describeNames(ids),
      save: () => this.save(),
    });
    this.planningService = planning;
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
  listMissions(): Mission[] { return this.missionService.list(); }
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
  missionBoard() { return this.missionService.board(); }

  addMission(title: unknown, description: unknown = ""): Promise<Mission> {
    return this.missionService.add(title, description);
  }

  updateMission(id: string, status: unknown): Promise<Mission> {
    return this.missionService.updateStatus(id, status);
  }

  addMissionStage(id: string, description: unknown): Promise<Note> {
    return this.missionService.addStage(id, description);
  }

  // ---------- projects, templates, days away ----------
  listProjects(): ProjectMeta[] { return this.workspaceService.listProjects(); }
  setProject(name: unknown, patch: Record<string, unknown>): Promise<ProjectMeta> {
    return this.workspaceService.setProject(name, patch);
  }
  listTemplates(): TaskTemplate[] { return this.workspaceService.listTemplates(); }
  addTemplate(body: unknown): Promise<TaskTemplate> { return this.workspaceService.addTemplate(body); }
  removeTemplate(id: string): Promise<void> { return this.workspaceService.removeTemplate(id); }
  listDaysOff(): DayOff[] { return this.workspaceService.listDaysOff(); }
  addDayOff(from: unknown, to: unknown, kind: unknown): Promise<{ dayOff: DayOff; clash: string[] }> {
    return this.workspaceService.addDayOff(from, to, kind);
  }
  removeDayOff(id: string): Promise<void> { return this.workspaceService.removeDayOff(id); }
  /** The vacation or sick leave on a local day, if any. */
  awayOn(key: string): DayOff | undefined { return this.workspaceService.awayOn(key); }
  /** A working day for work to-dos: production calendar plus explicit days away. */
  private workDayFor = (date: Date) => this.workspaceService.workDayFor(date);
  private isWork = (note: Note) => this.workspaceService.isWork(note);

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
  planToday(now = this.now()) { return this.planningService.planToday(now); }

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

  /** Suggest a finite working-day schedule without modifying tasks or schedules. */
  timeBlocks(day: string, startHour = 9, endHour = 18) {
    return this.planningService.timeBlocks(day, startHour, endHour);
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

    if (a.brief && this.briefService.shouldRunBrief(now)) {
      await this.runBrief(now).catch((e: unknown) => console.error("Дела: ошибка автоматизации Brief", e));
    }
    if (a.evening && this.briefService.shouldRunEvening(now)) {
      await this.runEvening(now).catch((e: unknown) => console.error("Дела: ошибка автоматизации Evening", e));
    }
    if (a.weekly && this.briefService.shouldRunWeek(now)) {
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

  /** Takes back one action of the automation: due dates and marks as they were, created reminders and notes removed. */
  undoLog(id: string): Promise<AutoLogEntry> { return this.automationEngine.undoLog(id); }

  /** Facts for the morning brief, in plain Russian. */
  briefFacts(now = this.now()): { text: string; short: string } {
    return this.briefService.briefFacts(now);
  }

  /** «Завтра праздник…» when tomorrow is a holiday, moved day off or short day. */
  tomorrowWarning(now = this.now()): string | null {
    return this.briefService.tomorrowWarning(now);
  }

  runBrief(now = this.now(), force = false): Promise<Note | null> {
    return this.briefService.runBrief(now, force);
  }

  eveningFacts(now = this.now()): { text: string; short: string; left: number } {
    return this.briefService.eveningFacts(now);
  }

  runEvening(now = this.now(), force = false): Promise<Note | null> {
    return this.briefService.runEvening(now, force);
  }

  weekFacts(now = this.now()): { text: string; short: string } {
    return this.briefService.weekFacts(now);
  }

  runWeek(now = this.now(), force = false): Promise<Note | null> {
    return this.briefService.runWeek(now, force);
  }

  /** How full a day is: task minutes against configured capacity. */
  dayLoad(day: string, now = this.now()) { return this.planningService.dayLoad(day, now); }

  /** «Разложить день»: advisory by default, explicit apply mutates selected tasks. */
  arrangeDay(day: string, apply = false, ids?: string[]) {
    return this.planningService.arrangeDay(day, apply, ids);
  }

  /** Move to-dos while preserving their time; logged so the move can be undone. */
  moveTasks(ids: unknown, to: unknown, requestId?: unknown): Promise<Note[]> {
    return this.planningService.moveTasks(ids, to, requestId);
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
