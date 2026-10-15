import { randomUUID } from "node:crypto";
import type { FileLink, Note, Repeat, TaskEvent } from "./organizer";

const MAX_NOTES = 500;
const MAX_TEXT = 500;
const REPEATS: Repeat[] = ["daily", "weekdays", "weekly", "monthly", "every3days", "yearly"];

const bad = (message: string, status = 400) => Object.assign(new Error(message), { status });

const text = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > MAX_TEXT) {
    throw bad(`${label}: от 1 до ${MAX_TEXT} символов`);
  }
  return value.trim();
};

const repeatOf = (value: unknown): Repeat | undefined => {
  if (value === undefined || value === null || value === "" || value === "none") return undefined;
  if (!REPEATS.includes(value as Repeat)) {
    throw bad("Повтор: daily, weekdays, weekly, monthly, every3days, yearly или none");
  }
  return value as Repeat;
};

const dayStart = (time: number): number => {
  const d = new Date(time);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export interface TaskServiceOptions {
  getNotes(): Note[];
  replaceNotes(notes: Note[]): void;
  save(): Promise<void>;
  now(): number;
  makeRoom(): boolean;
  record(kind: TaskEvent["kind"], note: Note, extra?: Partial<TaskEvent>): void;
  workday(date: Date): boolean;
  nextOccurrence(
    at: number,
    repeat: Repeat,
    now: number,
    anchorDay?: number,
    workday?: (date: Date) => boolean,
  ): number;
  cleanLinks(value: unknown): FileLink[] | undefined;
}

/**
 * Domain mutations for notes and to-dos.
 *
 * Organizer still owns shared state during the migration; this service owns task mutation rules.
 * Calendar, reminders, projects and automation consume the same state without being coupled to
 * task validation and recurrence mechanics.
 */
export class TaskService {
  constructor(private readonly options: TaskServiceOptions) {}

  listNotes(): Note[] {
    return this.options.getNotes().map((note) => ({ ...note }));
  }

  async addNote(kind: unknown, body: unknown): Promise<Note> {
    if (kind !== "note" && kind !== "todo") throw bad("Тип: note или todo");
    const value = text(body, "Текст");
    if (!this.options.makeRoom()) throw bad(`Достигнут предел: ${MAX_NOTES} записей`, 409);

    const note: Note = {
      id: randomUUID(),
      kind,
      text: value,
      done: false,
      createdAt: new Date(this.options.now()).toISOString(),
    };
    this.options.getNotes().push(note);
    this.options.record("add", note);
    await this.options.save();
    return { ...note };
  }

  /** A to-do with its date, importance and repeat in one step (the assistant's add_note). */
  async addTask(
    body: unknown,
    opts: { dueAt?: unknown; priority?: unknown; repeat?: unknown } = {},
  ): Promise<Note> {
    const note = await this.addNote("todo", body);
    const patch: Record<string, unknown> = {};
    if (opts.dueAt !== undefined && opts.dueAt !== null && opts.dueAt !== "") patch.dueAt = opts.dueAt;
    if (opts.priority === "high" || opts.priority === "low" || opts.priority === "normal") patch.priority = opts.priority;
    if (opts.repeat !== undefined && opts.repeat !== "none") patch.repeat = opts.repeat;
    if (!Object.keys(patch).length) return note;

    try {
      return await this.updateTask(note.id, patch);
    } catch (error) {
      await this.removeNote(note.id);
      throw error;
    }
  }

  async editNote(id: string, body: unknown): Promise<Note> {
    const note = this.options.getNotes().find((item) => item.id === id);
    if (!note) throw bad("Запись не найдена", 404);
    const value = text(body, "Текст");
    if (value !== note.text) {
      note.text = value;
      this.options.record("edit", note);
    }
    await this.options.save();
    return { ...note };
  }

  /** Optional task details; older stored notes remain readable without migration. */
  async updateTask(id: string, patch: Record<string, unknown>): Promise<Note> {
    const notes = this.options.getNotes();
    const note = notes.find((item) => item.id === id);
    if (!note) throw bad("Дело не найдено", 404);
    if (note.kind !== "todo") throw bad("Поля планирования доступны только делам", 409);

    const next = { ...note };

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
      else if (typeof patch.dueAt === "string" && Number.isFinite(Date.parse(patch.dueAt))) {
        next.dueAt = new Date(patch.dueAt).toISOString();
      } else {
        throw bad("Некорректный срок");
      }
      // A date set by hand is a fresh start.
      if (next.dueAt !== note.dueAt) {
        delete next.rolled;
        delete next.remindedFor;
      }
    }

    if ("estimateMinutes" in patch) {
      if (patch.estimateMinutes === null) delete next.estimateMinutes;
      else if (
        Number.isInteger(patch.estimateMinutes) &&
        Number(patch.estimateMinutes) >= 1 &&
        Number(patch.estimateMinutes) <= 1440
      ) next.estimateMinutes = Number(patch.estimateMinutes);
      else throw bad("Оценка времени: 1–1440 минут");
    }

    if ("repeat" in patch) {
      const repeat = repeatOf(patch.repeat);
      if (repeat) {
        next.repeat = repeat;
        const base = next.dueAt ? new Date(next.dueAt) : new Date(this.options.now());
        if (repeat === "monthly" || repeat === "yearly") next.repeatDay = base.getDate();
        else delete next.repeatDay;
      } else {
        delete next.repeat;
        delete next.repeatDay;
      }
    }

    if ("area" in patch) {
      if (patch.area === null || patch.area === "") delete next.area;
      else if (patch.area === "work" || patch.area === "personal") next.area = patch.area;
      else throw bad("Сфера: work или personal");
    }

    if ("status" in patch) {
      if (patch.status === null || patch.status === "" || patch.status === "todo") delete next.status;
      else if (patch.status === "doing" || patch.status === "waiting") next.status = patch.status;
      else throw bad("Статус: todo, doing или waiting");
    }

    if ("waitingFor" in patch) {
      if (patch.waitingFor === null || patch.waitingFor === "") delete next.waitingFor;
      else if (
        typeof patch.waitingFor === "string" &&
        patch.waitingFor.trim() &&
        patch.waitingFor.trim().length <= 80
      ) next.waitingFor = patch.waitingFor.trim();
      else throw bad("От кого ответ: до 80 символов");
    }

    if ("followUpAt" in patch) {
      if (patch.followUpAt === null || patch.followUpAt === "") delete next.followUpAt;
      else if (typeof patch.followUpAt === "string" && Number.isFinite(Date.parse(patch.followUpAt))) {
        next.followUpAt = new Date(patch.followUpAt).toISOString();
      } else {
        throw bad("Когда спросить снова: дата и время");
      }
      if (next.followUpAt !== note.followUpAt) delete next.followedUp;
    }

    if ((next.waitingFor || next.followUpAt) && !("status" in patch)) next.status = "waiting";
    if (next.status !== "waiting") {
      delete next.waitingFor;
      delete next.followUpAt;
      delete next.followedUp;
    }

    if ((next.status ?? null) !== (note.status ?? null)) {
      if (next.status) next.statusAt = new Date(this.options.now()).toISOString();
      else delete next.statusAt;
    }

    if ("files" in patch) {
      if (patch.files !== null && !Array.isArray(patch.files)) throw bad("Файлы: список");
      const files = this.options.cleanLinks(patch.files);
      if (files) next.files = files;
      else delete next.files;
    }

    if ("meeting" in patch) {
      if (patch.meeting === true) next.meeting = true;
      else if (patch.meeting === false || patch.meeting === null) delete next.meeting;
      else throw bad("Встреча: true или false");
    }

    if ("parentId" in patch) {
      if (patch.parentId === null || patch.parentId === "") delete next.parentId;
      else if (
        typeof patch.parentId === "string" &&
        patch.parentId !== id &&
        notes.some((item) => item.id === patch.parentId && item.kind === "todo" && !item.parentId)
      ) next.parentId = patch.parentId;
      else throw bad("Родительское дело не найдено или вложенность недопустима");
    }

    // Fields removed above must disappear from stored state too.
    for (const key of Object.keys(note) as (keyof Note)[]) {
      if (!(key in next)) delete note[key];
    }

    const moved = (note.dueAt ?? null) !== (next.dueAt ?? null)
      ? { from: note.dueAt ?? null, to: next.dueAt ?? null }
      : null;
    Object.assign(note, next);
    if (moved) this.options.record("move", note, moved);

    await this.options.save();
    return { ...note };
  }

  /** The board's order: to-dos of one column in drag order (ranks 0, 1, 2…). */
  async orderTasks(ids: unknown): Promise<{ ok: true }> {
    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 500 ||
      !ids.every((id) => typeof id === "string")
    ) throw bad("Порядок: от 1 до 500 дел");

    let rank = 0;
    for (const id of ids as string[]) {
      const note = this.options.getNotes().find((item) => item.id === id && item.kind === "todo");
      if (note) note.rank = rank++;
    }
    await this.options.save();
    return { ok: true };
  }

  async setDone(id: string, done: boolean): Promise<Note> {
    let notes = this.options.getNotes();
    const note = notes.find((item) => item.id === id);
    if (!note) throw bad("Запись не найдена", 404);
    if (note.kind !== "todo") throw bad("Отметить выполненным можно только дело", 409);
    if (note.done === done) return { ...note };

    note.done = done;
    this.options.record(done ? "done" : "undone", note);

    if (done) {
      note.completedAt = new Date(this.options.now()).toISOString();
      if (note.repeat && !note.nextId && this.options.makeRoom()) {
        // makeRoom may replace Organizer's notes array, so read it again.
        notes = this.options.getNotes();
        const now = this.options.now();
        const from = note.dueAt
          ? Date.parse(note.dueAt)
          : dayStart(now) + (23 * 60 + 59) * 60_000;
        const nextAt = this.options.nextOccurrence(
          from,
          note.repeat,
          Math.max(now, from),
          note.repeatDay,
          this.options.workday,
        );
        const onTime = !note.dueAt || now < dayStart(Date.parse(note.dueAt)) + 86_400_000;
        const streak = onTime ? (note.streak ?? 0) + 1 : 1;
        const copy: Note = {
          id: randomUUID(),
          kind: "todo",
          text: note.text,
          done: false,
          createdAt: new Date(now).toISOString(),
          dueAt: new Date(nextAt).toISOString(),
          repeat: note.repeat,
          streak,
          ...(note.repeatDay ? { repeatDay: note.repeatDay } : {}),
          ...(note.priority ? { priority: note.priority } : {}),
          ...(note.project ? { project: note.project } : {}),
          ...(note.estimateMinutes ? { estimateMinutes: note.estimateMinutes } : {}),
          ...(note.parentId ? { parentId: note.parentId } : {}),
          ...(note.area ? { area: note.area } : {}),
          ...(note.meeting ? { meeting: true as const } : {}),
          ...(note.files ? { files: note.files.map((file) => ({ ...file })) } : {}),
        };
        notes.push(copy);
        note.nextId = copy.id;
        note.nextSnapshot = JSON.stringify(copy);
      }
    } else {
      delete note.completedAt;
      const next = note.nextId ? notes.find((item) => item.id === note.nextId) : undefined;
      // User-modified generated occurrences are preserved.
      if (next && note.nextSnapshot && JSON.stringify(next) === note.nextSnapshot) {
        this.options.replaceNotes(notes.filter((item) => item !== next));
        notes = this.options.getNotes();
      }
      delete note.nextId;
      delete note.nextSnapshot;
    }

    await this.options.save();
    return { ...note };
  }

  async removeNote(id: string): Promise<void> {
    const notes = this.options.getNotes();
    const gone = notes.find((item) => item.id === id);
    if (!gone) throw bad("Запись не найдена", 404);

    const kept = notes.filter((item) => item !== gone);
    this.options.replaceNotes(kept);
    this.options.record(
      "remove",
      gone,
      gone.kind === "todo" && gone.done ? { from: gone.completedAt ?? null } : {},
    );

    // Subtasks of a removed to-do become ordinary to-dos.
    for (const item of kept) {
      if (item.parentId === id) delete item.parentId;
    }

    await this.options.save();
  }
}
