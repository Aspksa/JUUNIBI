import { createHash } from "node:crypto";
import type { AutoLogEntry, Automation, Note, Reminder, TaskEvent } from "./organizer";
import type { PlanningDayKind } from "./planning-service";
import type { SmartPriorityResult } from "./smart-priority-service";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const bad = (message: string, status = 400) => Object.assign(new Error(message), { status });

const localKey = (time: number): string => {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const minsOf = (hm: string): number => {
  const [h, m] = hm.split(":").map(Number);
  return h! * 60 + m!;
};

const minsNow = (time: number): number => {
  const d = new Date(time);
  return d.getHours() * 60 + d.getMinutes();
};

const dateOnly = (iso: string): boolean => {
  const d = new Date(iso);
  return d.getHours() === 23 && d.getMinutes() === 59;
};

const ceilQuarter = (minute: number): number => Math.ceil(minute / 15) * 15;
const hhmm = (minute: number): string =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

export interface SmartDayFixedBlock {
  id: string;
  text: string;
  start: string;
  end: string;
  minutes: number;
  kind: "meeting" | "task" | "reminder";
}

export interface SmartDayPlacement {
  id: string;
  text: string;
  start: string;
  end: string;
  minutes: number;
  score: number;
  reason: string;
  reasons: string[];
  area: "work" | "personal";
}

export interface SmartDayPlan {
  day: string;
  generatedAt: string;
  fingerprint: string;
  mode: SmartPriorityResult["mode"];
  window: { from: string; to: string };
  fixed: SmartDayFixedBlock[];
  placed: SmartDayPlacement[];
  left: number;
  unscheduled: { id: string; text: string; reason: string }[];
  applied: number;
  warnings: string[];
  advisoryOnly: boolean;
}

export interface SmartDayPlannerOptions {
  getNotes(): Note[];
  getReminders(): readonly Reminder[];
  getAutomation(): Automation;
  now(): number;
  dayKind(day: string): PlanningDayKind;
  rank(limit: number, now: number): SmartPriorityResult;
  isWork(note: Note): boolean;
  record(kind: TaskEvent["kind"], note: Note, extra?: Partial<TaskEvent>): void;
  addLog(kind: AutoLogEntry["kind"], text: string, undo?: AutoLogEntry["undo"]): void;
  save(): Promise<void>;
}

/**
 * Explainable day scheduling built on SmartPriority.
 *
 * Preview is read-only. Apply requires the preview fingerprint, so changed tasks/reminders cannot
 * silently receive a different schedule than the one the owner confirmed.
 */
export class SmartDayPlannerService {
  constructor(private readonly options: SmartDayPlannerOptions) {}

  async plan(
    day: string,
    apply = false,
    ids?: string[],
    expectedFingerprint?: string,
  ): Promise<SmartDayPlan> {
    this.validDay(day);
    const now = this.options.now();
    const today = localKey(now);
    if (day < today) throw bad("Этот день уже прошёл", 409);

    const automation = this.options.getAutomation();
    const kind = this.options.dayKind(day);
    const base = new Date(day + "T00:00:00").getTime();

    let from: number;
    let to: number;
    if (kind.work) {
      from = minsOf(automation.workFrom);
      to = minsOf(automation.workTo) - (kind.short ? 60 : 0);
    } else {
      from = 10 * 60;
      const personalHours = Math.max(2, Math.ceil((automation.dayHours || 8) / 2));
      to = Math.min(22 * 60, from + personalHours * 60);
    }
    if (to <= from) {
      from = kind.work ? 9 * 60 : 10 * 60;
      to = kind.work ? 18 * 60 : 14 * 60;
    }

    const reference = day === today ? now : base + from * 60_000;
    const ranked = this.options.rank(100, reference);
    const notes = this.options.getNotes();
    const notesById = new Map(notes.map((note) => [note.id, note]));

    const fixed: SmartDayFixedBlock[] = [];
    const busy: [number, number][] = [];

    const addBusy = (
      id: string,
      text: string,
      start: number,
      minutes: number,
      blockKind: SmartDayFixedBlock["kind"],
    ) => {
      const startMinute = Math.round((start - base) / 60_000);
      const endMinute = startMinute + minutes;
      busy.push([startMinute, endMinute]);
      fixed.push({
        id,
        text,
        start: new Date(base + startMinute * 60_000).toISOString(),
        end: new Date(base + endMinute * 60_000).toISOString(),
        minutes,
        kind: blockKind,
      });
    };

    for (const note of notes) {
      if (
        note.kind !== "todo" ||
        note.done ||
        !note.dueAt ||
        dateOnly(note.dueAt) ||
        localKey(Date.parse(note.dueAt)) !== day
      ) continue;
      addBusy(
        note.id,
        note.text,
        Date.parse(note.dueAt),
        note.estimateMinutes ?? 30,
        note.meeting ? "meeting" : "task",
      );
    }

    for (const reminder of this.options.getReminders()) {
      if (
        reminder.status !== "scheduled" ||
        reminder.rule ||
        localKey(Date.parse(reminder.at)) !== day
      ) continue;
      addBusy(reminder.id, reminder.text, Date.parse(reminder.at), 15, "reminder");
    }

    const lunch = kind.work && to - from >= 6 * 60 && from < 14 * 60 && to > 13 * 60;
    if (lunch) busy.push([13 * 60, 14 * 60]);

    let cursor = from;
    if (day === today) cursor = Math.max(from, ceilQuarter(minsNow(now) + 5));

    const rankedItems = ranked.recommended;
    const candidates = rankedItems
      .map((item) => ({ item, note: notesById.get(item.id) }))
      .filter((entry): entry is { item: (typeof rankedItems)[number]; note: Note } => !!entry.note)
      .filter(({ note }) => {
        if (note.kind !== "todo" || note.done || note.meeting) return false;
        if (kind.away && this.options.isWork(note)) return false;
        if (!note.dueAt) return true;
        const due = Date.parse(note.dueAt);
        if (dateOnly(note.dueAt)) return true;
        // Timed tasks on this day are fixed above. Future timed commitments stay untouched.
        return due < base;
      });

    const placed: SmartDayPlacement[] = [];
    const unscheduled: SmartDayPlan["unscheduled"] = [];

    const findSlot = (duration: number): number | null => {
      let at = cursor;
      while (at + duration <= to) {
        const clash = [...busy]
          .sort((a, b) => a[0] - b[0])
          .find(([start, end]) => at < end && at + duration > start);
        if (!clash) return at;
        at = ceilQuarter(clash[1]);
      }
      return null;
    };

    for (const { item, note } of candidates) {
      const duration = note.estimateMinutes ?? 30;
      const at = findSlot(duration);
      if (at === null) {
        unscheduled.push({ id: note.id, text: note.text, reason: "Не поместилось в свободные окна" });
        continue;
      }

      busy.push([at, at + duration]);
      placed.push({
        id: note.id,
        text: note.text,
        start: new Date(base + at * 60_000).toISOString(),
        end: new Date(base + (at + duration) * 60_000).toISOString(),
        minutes: duration,
        score: item.score,
        reason: item.primaryReason,
        reasons: [...item.reasons],
        area: item.area,
      });
    }

    fixed.sort((a, b) => a.start.localeCompare(b.start));
    placed.sort((a, b) => a.start.localeCompare(b.start));

    const fingerprint = this.fingerprint({
      day,
      kind: { work: kind.work, short: kind.short, away: kind.away?.id ?? null },
      window: [from, to],
      cursor,
      mode: ranked.mode,
      placed: placed.map((item) => ({ id: item.id, start: item.start, end: item.end })),
      unscheduled: unscheduled.map((item) => item.id),
      notes: notes
        .filter((note) => note.kind === "todo" && !note.done)
        .map((note) => ({
          id: note.id,
          dueAt: note.dueAt ?? null,
          priority: note.priority ?? null,
          estimateMinutes: note.estimateMinutes ?? null,
          parentId: note.parentId ?? null,
          status: note.status ?? null,
          meeting: note.meeting ?? false,
          project: note.project ?? null,
          area: note.area ?? null,
          rolled: note.rolled ?? null,
        })),
      reminders: this.options.getReminders()
        .filter((reminder) => reminder.status === "scheduled")
        .map((reminder) => ({
          id: reminder.id,
          at: reminder.at,
          rule: reminder.rule ?? null,
        })),
      ranking: rankedItems.map((item) => ({
        id: item.id,
        score: item.score,
        reasons: item.reasons,
      })),
    });

    const warnings = ["Внешний календарь не проверялся."];
    if (kind.away) {
      warnings.push(kind.away.kind === "sick"
        ? "Больничный: рабочие дела исключены."
        : "Отпуск: рабочие дела исключены.");
    }
    if (unscheduled.length) warnings.push(`Не поместилось дел: ${unscheduled.length}.`);

    const result = (applied: number, advisoryOnly: boolean): SmartDayPlan => ({
      day,
      generatedAt: new Date(now).toISOString(),
      fingerprint,
      mode: ranked.mode,
      window: { from: hhmm(from), to: hhmm(to) },
      fixed,
      placed,
      left: unscheduled.length,
      unscheduled,
      applied,
      warnings,
      advisoryOnly,
    });

    if (!apply) return result(0, true);
    if (!expectedFingerprint || expectedFingerprint !== fingerprint) {
      throw bad("План дня изменился. Обновите предпросмотр перед применением.", 409);
    }

    const selected = ids ? new Set(ids) : new Set(placed.map((item) => item.id));
    const undo: NonNullable<AutoLogEntry["undo"]>["notes"] = [];
    let applied = 0;

    for (const item of placed) {
      if (!selected.has(item.id)) continue;
      const note = notesById.get(item.id);
      if (!note || note.kind !== "todo" || note.done) continue;

      undo.push({
        id: note.id,
        dueAt: note.dueAt ?? null,
        rolled: note.rolled ?? null,
      });
      this.options.record("move", note, {
        from: note.dueAt ?? null,
        to: item.start,
        auto: true,
      });
      note.dueAt = item.start;
      delete note.rolled;
      delete note.remindedFor;
      undo[undo.length - 1]!.expectedDueAt = note.dueAt;
      applied++;
    }

    if (applied) {
      this.options.addLog(
        "arrange",
        `Умный план дня: расставлено дел ${applied}`,
        { notes: undo },
      );
      await this.options.save();
    }

    return result(applied, false);
  }

  private validDay(day: string): Date {
    if (!DAY_RE.test(day)) throw bad("День: YYYY-MM-DD");
    const date = new Date(day + "T12:00:00");
    const [year, month, value] = day.split("-").map(Number);
    if (
      Number.isNaN(date.getTime()) ||
      date.getFullYear() !== year ||
      date.getMonth() + 1 !== month ||
      date.getDate() !== value
    ) throw bad("Недопустимая дата");
    return date;
  }

  private fingerprint(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 20);
  }
}
