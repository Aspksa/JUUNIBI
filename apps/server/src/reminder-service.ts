import { randomUUID } from "node:crypto";
import type { Automation, Note, Reminder, Repeat } from "./organizer";

const MAX_REMINDERS = 200;
const MAX_DONE_REMINDERS = 100;
const MAX_TEXT = 500;
const YEAR = 366 * 86_400_000;
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

const minsOf = (hm: string): number => {
  const [h, m] = hm.split(":").map(Number);
  return h! * 60 + m!;
};

export interface ReminderServiceOptions {
  getReminders(): Reminder[];
  replaceReminders(reminders: Reminder[]): void;
  getNotes(): readonly Note[];
  getAutomation(): Automation;
  save(): Promise<void>;
  now(): number;
  workday(date: Date): boolean;
  alignStart(at: number, repeat: Repeat | undefined, workday: (date: Date) => boolean): number;
  nextOccurrence(
    at: number,
    repeat: Repeat,
    now: number,
    anchorDay?: number,
    workday?: (date: Date) => boolean,
    anchorMonth?: number,
  ): number;
  inQuiet(time: number, from: string, to: string): boolean;
}

export interface ReminderTickResult {
  fired: Reminder[];
  changed: boolean;
  releasedFromQuiet: number;
}

/**
 * Reminder lifecycle and recurrence.
 *
 * Organizer still coordinates task automation and briefs around this service, but CRUD, snooze,
 * dismissal, pruning and scheduled/repeating reminder firing live here.
 */
export class ReminderService {
  constructor(private readonly options: ReminderServiceOptions) {}

  list(): Reminder[] {
    return this.options.getReminders()
      .map((reminder) => ({ ...reminder }))
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }

  async add(body: unknown, at: unknown, repeat?: unknown): Promise<Reminder> {
    const value = text(body, "Текст");
    const rep = repeatOf(repeat);
    const ms = this.options.alignStart(this.when(at), rep, this.options.workday);

    if (this.options.getReminders().filter((reminder) => reminder.status !== "done").length >= MAX_REMINDERS) {
      throw bad(`Достигнут предел: ${MAX_REMINDERS} активных напоминаний`, 409);
    }

    const reminder: Reminder = {
      id: randomUUID(),
      text: value,
      at: new Date(ms).toISOString(),
      createdAt: new Date(this.options.now()).toISOString(),
      status: "scheduled",
      ...(rep ? {
        repeat: rep,
        ...(rep === "monthly" || rep === "yearly" ? { repeatDay: new Date(ms).getDate() } : {}),
        ...(rep === "yearly" ? { repeatMonth: new Date(ms).getMonth() } : {}),
      } : {}),
    };
    this.options.getReminders().push(reminder);
    await this.options.save();
    return { ...reminder };
  }

  async edit(id: string, patch: { text?: unknown; at?: unknown; repeat?: unknown }): Promise<Reminder> {
    const reminder = this.options.getReminders().find((item) => item.id === id);
    if (!reminder) throw bad("Напоминание не найдено", 404);
    if (reminder.status !== "scheduled") {
      throw bad("Изменить можно только запланированное напоминание", 409);
    }

    const value = patch.text === undefined ? reminder.text : text(patch.text, "Текст");
    const rep = patch.repeat === undefined ? reminder.repeat : repeatOf(patch.repeat);
    const at = new Date(this.options.alignStart(
      patch.at === undefined ? Date.parse(reminder.at) : this.when(patch.at),
      rep,
      this.options.workday,
    )).toISOString();

    reminder.text = value;
    reminder.at = at;
    delete reminder.repeatDay;
    delete reminder.repeatMonth;
    if (rep) {
      reminder.repeat = rep;
      if (rep === "monthly" || rep === "yearly") reminder.repeatDay = new Date(at).getDate();
      if (rep === "yearly") reminder.repeatMonth = new Date(at).getMonth();
    } else {
      delete reminder.repeat;
    }

    await this.options.save();
    return { ...reminder };
  }

  async snooze(id: string, minutes: unknown): Promise<Reminder> {
    if (
      minutes !== "tomorrow" &&
      (!Number.isInteger(minutes) || ![5, 10, 15, 30, 60, 180, 1440].includes(Number(minutes)))
    ) {
      throw bad("Отложить можно на 5, 10, 15, 30 минут, 1 или 3 часа, сутки или до завтра");
    }

    const reminder = this.options.getReminders().find((item) => item.id === id);
    if (!reminder) throw bad("Напоминание не найдено", 404);
    if (reminder.status !== "due") throw bad("Отложить можно только сработавшее напоминание", 409);

    const now = this.options.now();
    const briefTime = this.options.getAutomation().briefTime;
    reminder.at = new Date(
      minutes === "tomorrow"
        ? dayStart(now) + 86_400_000 + minsOf(briefTime) * 60_000
        : now + Number(minutes) * 60_000,
    ).toISOString();
    reminder.status = "scheduled";
    delete reminder.firedAt;

    await this.options.save();
    return { ...reminder };
  }

  async dismiss(id: string): Promise<Reminder> {
    const reminder = this.options.getReminders().find((item) => item.id === id);
    if (!reminder) throw bad("Напоминание не найдено", 404);
    reminder.status = "done";
    this.pruneDone();
    await this.options.save();
    return { ...reminder };
  }

  async remove(id: string): Promise<void> {
    const reminders = this.options.getReminders();
    const next = reminders.filter((item) => item.id !== id);
    if (next.length === reminders.length) throw bad("Напоминание не найдено", 404);
    this.options.replaceReminders(next);
    await this.options.save();
  }

  /**
   * Marks scheduled reminders that reached their time as due.
   * Automatic reminders wait through quiet hours; repeating series emit a one-off due copy.
   * Task automation is intentionally outside this method.
   */
  processDue(now = this.options.now()): ReminderTickResult {
    const fired: Reminder[] = [];
    const firedAt = new Date(now).toISOString();
    const automation = this.options.getAutomation();
    const quiet = automation.quiet && this.options.inQuiet(now, automation.quietFrom, automation.quietTo);
    let releasedFromQuiet = 0;
    let changed = false;

    for (const reminder of [...this.options.getReminders()]) {
      if (reminder.status !== "scheduled" || Date.parse(reminder.at) > now) continue;

      // A rule-created reminder is obsolete when its source task is done or removed.
      if (reminder.rule) {
        const note = this.options.getNotes().find((item) => item.id === reminder.source);
        if (!note || note.done) {
          reminder.status = "done";
          reminder.firedAt = firedAt;
          changed = true;
          continue;
        }
      }

      if (reminder.source && quiet) continue;
      if (
        reminder.source &&
        automation.quiet &&
        this.options.inQuiet(Date.parse(reminder.at), automation.quietFrom, automation.quietTo)
      ) {
        releasedFromQuiet++;
      }

      if (!reminder.repeat) {
        reminder.status = "due";
        reminder.firedAt = firedAt;
        fired.push({ ...reminder });
        continue;
      }

      const copy: Reminder = {
        id: randomUUID(),
        text: reminder.text,
        at: reminder.at,
        createdAt: firedAt,
        status: "due",
        firedAt,
        seriesId: reminder.id,
      };
      this.options.getReminders().push(copy);
      fired.push({ ...copy });

      reminder.at = new Date(this.options.nextOccurrence(
        Date.parse(reminder.at),
        reminder.repeat,
        now,
        reminder.repeatDay,
        this.options.workday,
        reminder.repeatMonth,
      )).toISOString();
    }

    return { fired, changed, releasedFromQuiet };
  }

  pruneDone(): void {
    const reminders = this.options.getReminders();
    const done = reminders.filter((reminder) => reminder.status === "done");
    if (done.length <= MAX_DONE_REMINDERS) return;

    const drop = new Set(
      done
        .sort((a, b) => Date.parse(a.firedAt ?? a.at) - Date.parse(b.firedAt ?? b.at))
        .slice(0, done.length - MAX_DONE_REMINDERS)
        .map((reminder) => reminder.id),
    );
    this.options.replaceReminders(reminders.filter((reminder) => !drop.has(reminder.id)));
  }

  private when(at: unknown): number {
    const ms = typeof at === "string" ? Date.parse(at) : NaN;
    if (Number.isNaN(ms)) {
      throw bad("Время: дата и время в формате ISO 8601, например 2026-10-10T10:00:00+03:00");
    }
    if (ms < this.options.now() - 60_000) throw bad("Это время уже прошло");
    if (ms > this.options.now() + YEAR) throw bad("Дальше чем на год вперёд напоминания не ставятся");
    return ms;
  }
}
