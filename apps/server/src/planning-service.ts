import type { AutoLogEntry, Automation, DayOff, Note, Reminder, TaskEvent } from "./organizer";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const bad = (message: string, status = 400) => Object.assign(new Error(message), { status });

const localKey = (time: number): string => {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const dayStart = (time: number): number => {
  const d = new Date(time);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const minsNow = (time: number): number => {
  const d = new Date(time);
  return d.getHours() * 60 + d.getMinutes();
};

const dateOnly = (iso: string): boolean => {
  const d = new Date(iso);
  return d.getHours() === 23 && d.getMinutes() === 59;
};

export interface PlanningDayKind {
  work: boolean;
  short: boolean;
  label: string;
  note?: string;
  away?: DayOff;
}

export interface PlanningServiceOptions {
  getNotes(): Note[];
  getReminders(): readonly Reminder[];
  getAutomation(): Automation;
  getMoveRequests(): string[];
  replaceMoveRequests(requests: string[]): void;
  now(): number;
  dayKind(day: string): PlanningDayKind;
  isWork(note: Note): boolean;
  workday(date: Date): boolean;
  workDayFor(date: Date): boolean;
  record(kind: TaskEvent["kind"], note: Note, extra?: Partial<TaskEvent>): void;
  addLog(kind: AutoLogEntry["kind"], text: string, undo?: AutoLogEntry["undo"]): void;
  describeNames(ids: string[]): string;
  save(): Promise<void>;
}

/**
 * Read-only planning plus explicit task rescheduling.
 * It does not own persistence or automation policy; Organizer injects those boundaries.
 */
export class PlanningService {
  constructor(private readonly options: PlanningServiceOptions) {}

  /** Advisory only: never modifies tasks or schedules. */
  planToday(now = this.options.now()) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const open = this.options.getNotes().filter((note) => note.kind === "todo" && !note.done);
    const due = (note: Note) => note.dueAt ? Date.parse(note.dueAt) : Infinity;
    const score = (note: Note) =>
      (note.priority === "high" ? 30 : note.priority === "low" ? 0 : 10) +
      (due(note) < now ? 50 : due(note) < end.getTime() ? 35 : 0);

    const ordered = [...open].sort(
      (a, b) => score(b) - score(a) || due(a) - due(b) || a.createdAt.localeCompare(b.createdAt),
    );

    return {
      generatedAt: new Date(now).toISOString(),
      total: open.length,
      overdue: open.filter((note) => due(note) < now).length,
      estimatedMinutes: open.reduce((sum, note) => sum + (note.estimateMinutes ?? 0), 0),
      suggested: ordered.slice(0, 10).map((note) => ({
        id: note.id,
        text: note.text,
        score: score(note),
        reason: due(note) < now
          ? "Просрочено"
          : due(note) < end.getTime()
            ? "Срок сегодня"
            : note.priority === "high"
              ? "Высокий приоритет"
              : "Очередь задач",
      })),
      advisoryOnly: true as const,
    };
  }

  /** Suggest a finite working-day schedule without modifying tasks or claiming external calendar availability. */
  timeBlocks(day: string, startHour = 9, endHour = 18) {
    if (!/^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])$/.test(day)) throw bad("День: YYYY-MM-DD");

    const date = new Date(day + "T12:00:00");
    if (
      Number.isNaN(date.getTime()) ||
      [date.getFullYear(), date.getMonth() + 1, date.getDate()].join("-") !== day.split("-").map(Number).join("-")
    ) throw bad("Недопустимая дата");

    if (
      !Number.isInteger(startHour) ||
      !Number.isInteger(endHour) ||
      startHour < 0 ||
      endHour > 24 ||
      endHour <= startHour
    ) throw bad("Неверные рабочие часы");

    const minutes = (endHour - startHour) * 60;
    const tasks = this.options.getNotes().filter(
      (note) => note.kind === "todo" && !note.done && !note.parentId,
    );
    const ordered = [...tasks].sort(
      (a, b) =>
        (b.priority === "high" ? 2 : b.priority === "normal" ? 1 : 0) -
          (a.priority === "high" ? 2 : a.priority === "normal" ? 1 : 0) ||
        (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"),
    );

    let used = 0;
    const blocks: { id: string; text: string; start: string; end: string; minutes: number }[] = [];

    for (const task of ordered) {
      const duration = task.estimateMinutes ?? 30;
      if (used + duration > minutes) continue;

      const from = new Date(date);
      from.setHours(startHour, used, 0, 0);
      const to = new Date(from.getTime() + duration * 60_000);
      blocks.push({
        id: task.id,
        text: task.text,
        start: from.toISOString(),
        end: to.toISOString(),
        minutes: duration,
      });
      used += duration;
    }

    return {
      day,
      workingMinutes: minutes,
      plannedMinutes: used,
      remainingMinutes: minutes - used,
      blocks,
      note: "Предложение по задачам; занятость внешнего календаря не проверялась",
      advisoryOnly: true as const,
    };
  }

  /** How full a day is: task minutes against configured capacity, plus safe candidates to move. */
  dayLoad(day: string, now = this.options.now()) {
    if (!DAY_RE.test(day)) throw bad("День: YYYY-MM-DD");

    const dayKind = this.options.dayKind(day);
    const hours = this.options.getAutomation().dayHours;
    const capacity = hours
      ? (dayKind.work ? (dayKind.short ? Math.max(1, hours - 1) : hours) : Math.ceil(hours / 2)) * 60
      : 0;

    const items = this.options.getNotes().filter(
      (note) =>
        note.kind === "todo" &&
        !note.done &&
        note.dueAt &&
        localKey(Date.parse(note.dueAt)) === day,
    );
    const minutes = (note: Note) => note.estimateMinutes ?? 30;
    const planned = items.reduce((sum, note) => sum + minutes(note), 0);
    const over = capacity > 0 && planned > capacity;
    const move: { id: string; text: string; minutes: number }[] = [];

    if (over) {
      const rank = (note: Note) =>
        (note.priority === "low" ? 0 : 1) * 2 +
        (note.dueAt && dateOnly(note.dueAt) ? 0 : 1);
      let rest = planned;
      for (const note of items
        .filter((item) => item.priority !== "high")
        .sort((a, b) => rank(a) - rank(b) || minutes(b) - minutes(a))) {
        if (rest <= capacity) break;
        move.push({ id: note.id, text: note.text, minutes: minutes(note) });
        rest -= minutes(note);
      }
    }

    void now;
    return {
      day,
      capacity,
      planned,
      over,
      count: items.length,
      work: dayKind.work,
      move,
    };
  }

  /**
   * Place flexible to-dos into free windows. Without apply this is advisory only.
   * With apply, only selected placements mutate dueAt and every mutation is undoable.
   */
  async arrangeDay(day: string, apply = false, ids?: string[]) {
    if (!DAY_RE.test(day)) throw bad("День: YYYY-MM-DD");

    const now = this.options.now();
    const today = localKey(now) === day;
    if (day < localKey(now)) throw bad("Этот день уже прошёл", 409);

    const dayKind = this.options.dayKind(day);
    const hours = this.options.getAutomation().dayHours || 8;
    const base = new Date(day + "T00:00").getTime();
    const from = dayKind.work ? 9 * 60 : 10 * 60;
    const lunch = dayKind.work && hours >= 6;
    const to = Math.min(
      23 * 60,
      from +
        (dayKind.work ? (dayKind.short ? hours - 1 : hours) : Math.ceil(hours / 2)) * 60 +
        (lunch ? 60 : 0),
    );

    const busy: [number, number][] = lunch ? [[13 * 60, 14 * 60]] : [];
    const minuteOf = (iso: string) => Math.round((Date.parse(iso) - base) / 60_000);
    const open = this.options.getNotes().filter((note) => note.kind === "todo" && !note.done);

    for (const note of open) {
      if (note.dueAt && !dateOnly(note.dueAt) && localKey(Date.parse(note.dueAt)) === day) {
        busy.push([
          minuteOf(note.dueAt),
          minuteOf(note.dueAt) + (note.estimateMinutes ?? 30),
        ]);
      }
    }

    for (const reminder of this.options.getReminders()) {
      if (
        reminder.status === "scheduled" &&
        !reminder.rule &&
        localKey(Date.parse(reminder.at)) === day
      ) {
        busy.push([minuteOf(reminder.at), minuteOf(reminder.at) + 15]);
      }
    }

    const dayStartMs = base;
    const reasonOf = (note: Note) =>
      note.dueAt && Date.parse(note.dueAt) < dayStart(now)
        ? "просрочено"
        : note.dueAt
          ? "срок в этот день"
          : note.priority === "high"
            ? "важное без срока"
            : "без срока";

    const order = (note: Note) =>
      note.dueAt && Date.parse(note.dueAt) < dayStartMs
        ? 0
        : note.dueAt
          ? 1
          : note.priority === "high"
            ? 2
            : note.priority === "low"
              ? 4
              : 3;

    const notes = this.options.getNotes();
    const candidates = open
      .filter((note) =>
        !notes.some((child) => child.parentId === note.id && !child.done) &&
        !(dayKind.away && this.options.isWork(note)) &&
        (
          (note.dueAt && dateOnly(note.dueAt) && localKey(Date.parse(note.dueAt)) === day) ||
          (today && note.dueAt && Date.parse(note.dueAt) < dayStart(now)) ||
          (!note.dueAt && note.priority !== "low")
        )
      )
      .sort((a, b) => order(a) - order(b) || a.createdAt.localeCompare(b.createdAt));

    let cursor = from;
    if (today) cursor = Math.max(from, Math.ceil((minsNow(now) + 5) / 15) * 15);

    const placed: { id: string; text: string; start: string; minutes: number; reason: string }[] = [];
    let left = 0;

    for (const note of candidates) {
      const duration = note.estimateMinutes ?? 30;
      let t = cursor;
      let fits = false;

      while (t + duration <= to) {
        const clash = busy.find(([start, end]) => t < end && t + duration > start);
        if (!clash) {
          fits = true;
          break;
        }
        t = Math.ceil(clash[1] / 15) * 15;
      }

      if (!fits) {
        left++;
        continue;
      }

      busy.push([t, t + duration]);
      placed.push({
        id: note.id,
        text: note.text,
        start: new Date(base + t * 60_000).toISOString(),
        minutes: duration,
        reason: reasonOf(note),
      });
    }

    placed.sort((a, b) => a.start.localeCompare(b.start));
    const window = {
      from: `${String(Math.floor(from / 60)).padStart(2, "0")}:${String(from % 60).padStart(2, "0")}`,
      to: `${String(Math.floor(to / 60)).padStart(2, "0")}:${String(to % 60).padStart(2, "0")}`,
    };

    if (!apply) return { day, window, placed, left, applied: 0 };

    const picked = ids ? placed.filter((item) => ids.includes(item.id)) : placed;
    const undo: NonNullable<AutoLogEntry["undo"]>["notes"] = [];

    for (const item of picked) {
      const note = this.options.getNotes().find((candidate) => candidate.id === item.id)!;
      undo.push({ id: note.id, dueAt: note.dueAt ?? null, rolled: note.rolled ?? null });
      this.options.record("move", note, {
        from: note.dueAt ?? null,
        to: item.start,
        auto: true,
      });
      note.dueAt = item.start;
      delete note.rolled;
      delete note.remindedFor;
      undo[undo.length - 1]!.expectedDueAt = note.dueAt;
    }

    if (picked.length) {
      this.options.addLog(
        "arrange",
        `Разложила день ${new Date(base + 12 * 3_600_000).toLocaleDateString("ru-RU", {
          day: "numeric",
          month: "long",
        })}: дел ${picked.length}`,
        { notes: undo },
      );
      await this.options.save();
    }

    return { day, window, placed, left, applied: picked.length };
  }

  /** Move to-dos while preserving local time. Logged so the move can be undone safely. */
  async moveTasks(ids: unknown, to: unknown, requestId?: unknown): Promise<Note[]> {
    if (
      requestId !== undefined &&
      (typeof requestId !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId))
    ) {
      throw bad("Некорректный идентификатор операции");
    }

    if (requestId && this.options.getMoveRequests().includes(requestId)) {
      throw bad("Этот перенос уже выполнен", 409);
    }

    if (
      !Array.isArray(ids) ||
      !ids.length ||
      ids.length > 100 ||
      !ids.every((id) => typeof id === "string")
    ) throw bad("Список дел: от 1 до 100");

    const toDay = typeof to === "string" && DAY_RE.test(to) && Number.isFinite(Date.parse(to + "T12:00"))
      ? to
      : null;
    if (to !== "tomorrow" && to !== "workday" && !toDay) {
      throw bad("Куда: tomorrow, workday или день YYYY-MM-DD");
    }

    const now = this.options.now();
    const undo: NonNullable<AutoLogEntry["undo"]>["notes"] = [];
    const moved: Note[] = [];

    for (const id of ids as string[]) {
      const note = this.options.getNotes().find(
        (item) => item.id === id && item.kind === "todo" && !item.done,
      );
      if (!note) continue;

      const from = note.dueAt
        ? new Date(note.dueAt)
        : new Date(dayStart(now) + (23 * 60 + 59) * 60_000);
      const target = toDay
        ? new Date(toDay + "T00:00")
        : new Date(Math.max(dayStart(from.getTime()), dayStart(now)));

      target.setHours(from.getHours(), from.getMinutes(), 0, 0);
      if (!toDay) target.setDate(target.getDate() + 1);

      const allowed = (date: Date) =>
        this.options.isWork(note)
          ? this.options.workDayFor(date)
          : this.options.workday(date);
      if (to === "workday") {
        for (let i = 0; i < 400 && !allowed(target); i++) target.setDate(target.getDate() + 1);
      }

      undo.push({
        id: note.id,
        dueAt: note.dueAt ?? null,
        rolled: note.rolled ?? null,
      });
      this.options.record("move", note, {
        from: note.dueAt ?? null,
        to: target.toISOString(),
      });
      note.dueAt = target.toISOString();
      delete note.rolled;
      delete note.remindedFor;
      undo[undo.length - 1]!.expectedDueAt = note.dueAt;
      moved.push({ ...note });
    }

    if (!moved.length) throw bad("Нечего переносить", 409);

    const where = to === "tomorrow"
      ? "на завтра"
      : to === "workday"
        ? "на рабочий день"
        : "на " + new Date(toDay + "T12:00").toLocaleDateString("ru-RU", {
          day: "numeric",
          month: "long",
        });

    this.options.addLog(
      "move",
      `Перенесла ${where} (${moved.length}): ` +
        this.options.describeNames(moved.map((note) => note.id)),
      { notes: undo },
    );

    if (requestId) {
      this.options.replaceMoveRequests(
        [...this.options.getMoveRequests(), requestId].slice(-200),
      );
    }

    await this.options.save();
    return moved;
  }
}
