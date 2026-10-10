import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export interface Note { id: string; kind: "note" | "todo"; text: string; done: boolean; createdAt: string }
/** How a reminder repeats: every day, Monday to Friday, or every week on the same weekday. */
export type Repeat = "daily" | "weekdays" | "weekly";
export const REPEATS: Repeat[] = ["daily", "weekdays", "weekly"];
export interface Reminder { id: string; text: string; at: string; createdAt: string; status: "scheduled" | "due" | "done"; firedAt?: string; repeat?: Repeat; seriesId?: string }
const MAX_NOTES = 500, MAX_REMINDERS = 200, MAX_TEXT = 500, MAX_DONE_REMINDERS = 100;
const YEAR = 366 * 86_400_000;
const bad = (message: string, status = 400) => Object.assign(new Error(message), { status });
const repeatOf = (v: unknown): Repeat | undefined => {
  if (v === undefined || v === null || v === "" || v === "none") return undefined;
  if (!REPEATS.includes(v as Repeat)) throw bad("Повтор: daily, weekdays, weekly или none");
  return v as Repeat;
};
/** The first occurrence of a repeating reminder strictly after `now`, keeping the local time of day of `at`. */
export function nextOccurrence(at: number, repeat: Repeat, now: number): number {
  const d = new Date(at);
  const step = () => d.setDate(d.getDate() + (repeat === "weekly" ? 7 : 1));
  const ok = () => repeat !== "weekdays" || (d.getDay() !== 0 && d.getDay() !== 6);
  do step(); while (d.getTime() <= now || !ok());
  return d.getTime();
}
/** A "weekdays" reminder set for a Saturday or Sunday starts on the next Monday instead. */
export function alignStart(at: number, repeat: Repeat | undefined): number {
  if (repeat !== "weekdays") return at;
  const d = new Date(at);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.getTime();
}
const text = (v: unknown, label: string) => {
  if (typeof v !== "string" || !v.trim() || v.trim().length > MAX_TEXT) throw bad(`${label}: от 1 до ${MAX_TEXT} символов`);
  return v.trim();
};

/** Notes, to-do items and reminders kept by the owner and (with approval) by the assistant. */
export class Organizer {
  private notes: Note[] = [];
  private reminders: Reminder[] = [];
  private writes: Promise<void> = Promise.resolve();
  constructor(private readonly file: string, private readonly now: () => number = Date.now) {}

  async load() {
    try {
      const raw = JSON.parse(await readFile(this.file, "utf8")) as { notes?: unknown; reminders?: unknown };
      if (Array.isArray(raw.notes)) this.notes = raw.notes.filter((n): n is Note => !!n && typeof n.id === "string" && (n.kind === "note" || n.kind === "todo") && typeof n.text === "string" && n.text.length <= MAX_TEXT && typeof n.done === "boolean" && typeof n.createdAt === "string").slice(-MAX_NOTES);
      if (Array.isArray(raw.reminders)) this.reminders = raw.reminders.filter((r): r is Reminder => !!r && typeof r.id === "string" && typeof r.text === "string" && r.text.length <= MAX_TEXT && !Number.isNaN(Date.parse(r.at)) && ["scheduled", "due", "done"].includes(r.status) && (r.repeat === undefined || REPEATS.includes(r.repeat))).slice(-MAX_REMINDERS);
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
  private save() {
    const data = JSON.stringify({ notes: this.notes, reminders: this.reminders });
    this.writes = this.writes.catch(() => {}).then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const tmp = this.file + "." + randomUUID() + ".tmp";
      await writeFile(tmp, data, { mode: 0o600 });
      await rename(tmp, this.file);
    });
    return this.writes;
  }
  flush() { return this.writes; }

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
  async editNote(id: string, body: unknown): Promise<Note> {
    const n = this.notes.find((x) => x.id === id);
    if (!n) throw bad("Запись не найдена", 404);
    n.text = text(body, "Текст");
    await this.save();
    return { ...n };
  }
  async setDone(id: string, done: boolean): Promise<Note> {
    const n = this.notes.find((x) => x.id === id);
    if (!n) throw bad("Запись не найдена", 404);
    if (n.kind !== "todo") throw bad("Отметить выполненным можно только дело", 409);
    n.done = done;
    await this.save();
    return { ...n };
  }
  async removeNote(id: string) {
    const n = this.notes.length;
    this.notes = this.notes.filter((x) => x.id !== id);
    if (this.notes.length === n) throw bad("Запись не найдена", 404);
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
    const ms = alignStart(this.when(at), rep);
    if (this.reminders.filter((r) => r.status !== "done").length >= MAX_REMINDERS) throw bad(`Достигнут предел: ${MAX_REMINDERS} активных напоминаний`, 409);
    const r: Reminder = { id: randomUUID(), text: t, at: new Date(ms).toISOString(), createdAt: new Date(this.now()).toISOString(), status: "scheduled", ...(rep ? { repeat: rep } : {}) };
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
    const at = new Date(alignStart(patch.at === undefined ? Date.parse(r.at) : this.when(patch.at), rep)).toISOString();
    r.text = t; r.at = at;
    if (rep) r.repeat = rep; else delete r.repeat;
    await this.save();
    return { ...r };
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
      r.at = new Date(nextOccurrence(Date.parse(r.at), r.repeat, now)).toISOString();
    }
    if (fired.length) { this.pruneDone(); await this.save(); }
    return fired;
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
