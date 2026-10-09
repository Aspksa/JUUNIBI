import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export interface Note { id: string; kind: "note" | "todo"; text: string; done: boolean; createdAt: string }
export interface Reminder { id: string; text: string; at: string; createdAt: string; status: "scheduled" | "due" | "done"; firedAt?: string }
const MAX_NOTES = 500, MAX_REMINDERS = 200, MAX_TEXT = 500;
const YEAR = 366 * 86_400_000;
const bad = (message: string, status = 400) => Object.assign(new Error(message), { status });
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
      if (Array.isArray(raw.reminders)) this.reminders = raw.reminders.filter((r): r is Reminder => !!r && typeof r.id === "string" && typeof r.text === "string" && r.text.length <= MAX_TEXT && !Number.isNaN(Date.parse(r.at)) && ["scheduled", "due", "done"].includes(r.status)).slice(-MAX_REMINDERS);
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
  async addReminder(body: unknown, at: unknown): Promise<Reminder> {
    const t = text(body, "Текст");
    const ms = typeof at === "string" ? Date.parse(at) : NaN;
    if (Number.isNaN(ms)) throw bad("Время: дата и время в формате ISO 8601, например 2026-10-10T10:00:00+03:00");
    if (ms < this.now() - 60_000) throw bad("Это время уже прошло");
    if (ms > this.now() + YEAR) throw bad("Дальше чем на год вперёд напоминания не ставятся");
    if (this.reminders.filter((r) => r.status !== "done").length >= MAX_REMINDERS) throw bad(`Достигнут предел: ${MAX_REMINDERS} активных напоминаний`, 409);
    const r: Reminder = { id: randomUUID(), text: t, at: new Date(ms).toISOString(), createdAt: new Date(this.now()).toISOString(), status: "scheduled" };
    this.reminders.push(r);
    await this.save();
    return { ...r };
  }
  async dismissReminder(id: string): Promise<Reminder> {
    const r = this.reminders.find((x) => x.id === id);
    if (!r) throw bad("Напоминание не найдено", 404);
    r.status = "done";
    await this.save();
    return { ...r };
  }
  async removeReminder(id: string) {
    const n = this.reminders.length;
    this.reminders = this.reminders.filter((x) => x.id !== id);
    if (this.reminders.length === n) throw bad("Напоминание не найдено", 404);
    await this.save();
  }
  /** Marks reminders whose time has come as "due" and returns the newly due ones. Safe to call as often as you like. */
  async tick(): Promise<Reminder[]> {
    const fired: Reminder[] = [];
    for (const r of this.reminders) if (r.status === "scheduled" && Date.parse(r.at) <= this.now()) { r.status = "due"; r.firedAt = new Date(this.now()).toISOString(); fired.push({ ...r }); }
    if (fired.length) await this.save();
    return fired;
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
