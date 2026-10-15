import { randomUUID } from "node:crypto";
import type { AutoLogEntry, AutoRule, Automation, DayOff, Note, Reminder, TaskEvent } from "./organizer";

const MAX_LOG = 60;
const MAX_REMINDERS = 200;
const MAX_TEXT = 500;

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

const minsOf = (hm: string): number => {
  const [h, m] = hm.split(":").map(Number);
  return h! * 60 + m!;
};

const hhmm = (time: number): string =>
  new Date(time).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

const dateOnly = (iso: string): boolean => {
  const d = new Date(iso);
  return d.getHours() === 23 && d.getMinutes() === 59;
};

const ruleBefore = (minutes: number): string =>
  minutes === 1440 ? "сутки" : minutes >= 60 ? minutes / 60 + " ч" : minutes + " мин";

export interface AutomationState {
  briefDay?: string;
  rollDay?: string;
  eveningDay?: string;
  weekDay?: string;
}

export interface AutomationEngineOptions {
  getNotes(): Note[];
  replaceNotes(notes: Note[]): void;
  getReminders(): Reminder[];
  replaceReminders(reminders: Reminder[]): void;
  getAutomation(): Automation;
  getAutoState(): AutomationState;
  getLog(): AutoLogEntry[];
  replaceLog(log: AutoLogEntry[]): void;
  getAutoCount(): Partial<Record<AutoLogEntry["kind"], number>>;
  getHistory(): readonly TaskEvent[];
  save(): Promise<void>;
  now(): number;
  isQuiet(now: number): boolean;
  awayOn(day: string): DayOff | undefined;
  workDayFor(date: Date): boolean;
  isWork(note: Note): boolean;
  record(kind: TaskEvent["kind"], note: Note, extra?: Partial<TaskEvent>): void;
}

/**
 * Automatic task actions and their audit/undo journal.
 * Brief scheduling stays in Organizer; this engine only owns autonomous task/reminder mutations.
 */
export class AutomationEngine {
  constructor(private readonly options: AutomationEngineOptions) {}

  counts(): Partial<Record<AutoLogEntry["kind"], number>> {
    return { ...this.options.getAutoCount() };
  }

  evidence() {
    const log = this.options.getLog();
    const notes = this.options.getNotes();
    const automation = this.options.getAutomation();
    const active = log.filter((entry) => !entry.undone);
    const undone = log.filter((entry) => entry.undone);
    const automaticMoves = this.options.getHistory().filter((event) => event.kind === "move" && event.auto);
    const totals = {
      logged: log.length,
      active: active.length,
      undone: undone.length,
      automaticMoves: automaticMoves.length,
      taskCompletion: notes.filter((note) => note.kind === "todo" && note.done).length,
    };
    const warnings: string[] = [];
    if (automation.rollOverdue) {
      warnings.push("Автоперенос включён: просроченные сроки могут меняться без отдельного подтверждения");
    }
    const frequent = notes.filter((note) => note.kind === "todo" && !note.done && (note.rolled ?? 0) >= 3);
    if (frequent.length) warnings.push("Дела с тремя и более переносами: " + frequent.length);

    return {
      totals,
      permissions: {
        rollOverdue: automation.rollOverdue,
        reminders: automation.dueReminder !== "off",
        brief: automation.brief,
        rules: automation.rules.length,
      },
      warnings,
      evidence: "task-history-and-automation-log",
      advisoryOnly: true as const,
    };
  }

  listLog(): AutoLogEntry[] {
    return this.options.getLog().map((entry) => ({
      ...entry,
      ...(entry.undo ? {
        undo: {
          ...(entry.undo.notes ? { notes: entry.undo.notes.map((note) => ({ ...note })) } : {}),
          ...(entry.undo.reminders ? { reminders: [...entry.undo.reminders] } : {}),
          ...(entry.undo.created ? { created: [...entry.undo.created] } : {}),
        },
      } : {}),
    })).reverse();
  }

  addLog(kind: AutoLogEntry["kind"], text: string, undo?: AutoLogEntry["undo"]): void {
    const log = this.options.getLog();
    log.push({
      id: randomUUID(),
      at: new Date(this.options.now()).toISOString(),
      kind,
      text: text.slice(0, 300),
      ...(undo ? { undo } : {}),
    });

    const count = this.options.getAutoCount();
    count[kind] = (count[kind] ?? 0) + 1;

    if (log.length > MAX_LOG) this.options.replaceLog(log.slice(-MAX_LOG));
  }

  async undoLog(id: string): Promise<AutoLogEntry> {
    const entry = this.options.getLog().find((item) => item.id === id);
    if (!entry) throw bad("Запись журнала не найдена", 404);
    if (entry.undone) throw bad("Уже отменено", 409);
    if (!entry.undo) throw bad("Это действие нельзя отменить", 409);

    const notes = this.options.getNotes();
    for (const undo of entry.undo.notes ?? []) {
      const note = notes.find((item) => item.id === undo.id);
      if (
        !note ||
        note.done ||
        (undo.expectedDueAt !== undefined && (note.dueAt ?? null) !== undo.expectedDueAt)
      ) {
        throw bad("Отмена невозможна: дело изменено после действия. Проверьте его вручную.", 409);
      }
    }

    for (const undo of entry.undo.notes ?? []) {
      const note = notes.find((item) => item.id === undo.id);
      if (!note || note.done) continue;
      if (undo.dueAt === null) delete note.dueAt;
      else note.dueAt = undo.dueAt;
      if (undo.rolled === null) delete note.rolled;
      else note.rolled = undo.rolled;
      if (undo.priority !== undefined) {
        if (undo.priority === null) delete note.priority;
        else note.priority = undo.priority;
      }
      delete note.remindedFor;
    }

    const reminderIds = new Set(entry.undo.reminders ?? []);
    if (reminderIds.size) {
      this.options.replaceReminders(
        this.options.getReminders().filter((reminder) => !reminderIds.has(reminder.id)),
      );
    }

    const created = new Set(entry.undo.created ?? []);
    if (created.size) {
      this.options.replaceNotes(this.options.getNotes().filter((note) => !created.has(note.id)));
    }

    entry.undone = true;
    await this.options.save();
    return { ...entry };
  }

  /** Run one deterministic automation pass. Persistence is coordinated by Organizer.tick(). */
  run(now: number, fired: Reminder[]): boolean {
    const automation = this.options.getAutomation();
    const today = localKey(now);
    const start = dayStart(now);
    const state = this.options.getAutoState();
    let changed = false;

    if (automation.rollOverdue && state.rollDay !== today) {
      state.rollDay = today;
      changed = true;
      const undo: NonNullable<AutoLogEntry["undo"]>["notes"] = [];
      const away = this.options.awayOn(today);

      let moveBase = start;
      if (away) {
        const d = new Date(start + 12 * 3_600_000);
        for (let i = 0; i < 400 && !this.options.workDayFor(d); i++) d.setDate(d.getDate() + 1);
        moveBase = dayStart(d.getTime());
      }

      for (const note of this.options.getNotes()) {
        if (note.kind !== "todo" || note.done || !note.dueAt || Date.parse(note.dueAt) >= start) continue;
        undo.push({ id: note.id, dueAt: note.dueAt, rolled: note.rolled ?? null });

        const due = new Date(note.dueAt);
        const target = new Date(away && this.options.isWork(note) ? moveBase : start);
        target.setHours(due.getHours(), due.getMinutes(), 0, 0);

        const before = note.dueAt;
        note.dueAt = (
          target.getTime() < now
            ? new Date(start + (23 * 60 + 59) * 60_000)
            : target
        ).toISOString();
        note.rolled = (note.rolled ?? 0) + 1;
        undo[undo.length - 1]!.expectedDueAt = note.dueAt;
        this.options.record("move", note, { from: before, to: note.dueAt, auto: true });
        if (note.repeat) note.streak = 0;
        delete note.remindedFor;
      }

      if (undo.length) {
        this.addLog(
          "roll",
          `Перенесла на сегодня просроченные (${undo.length}): ` + this.names(undo.map((item) => item.id)),
          { notes: undo },
        );
      }
    }

    if (automation.dueReminder !== "off" && !this.options.isQuiet(now)) {
      for (const note of this.options.getNotes()) {
        if (
          note.kind !== "todo" ||
          note.done ||
          !note.dueAt ||
          dateOnly(note.dueAt) ||
          note.remindedFor === note.dueAt
        ) continue;

        const due = Date.parse(note.dueAt);
        const remindAt = automation.dueReminder === "morning"
          ? dayStart(due) + minsOf(automation.briefTime) * 60_000
          : due - Number(automation.dueReminder) * 60_000;
        if (now < remindAt) continue;

        note.remindedFor = note.dueAt;
        changed = true;
        if (now > due) continue;

        const when = localKey(due) === today
          ? "в " + hhmm(due)
          : new Date(due).toLocaleDateString("ru-RU", { day: "numeric", month: "long" }) + " в " + hhmm(due);
        const reminder: Reminder = {
          id: randomUUID(),
          text: `Срок ${when}: ${note.text}`.slice(0, MAX_TEXT),
          at: new Date(now).toISOString(),
          createdAt: new Date(now).toISOString(),
          status: "due",
          firedAt: new Date(now).toISOString(),
          source: note.id,
        };
        this.options.getReminders().push(reminder);
        fired.push({ ...reminder });
        this.addLog("remind", "Напомнила о сроке: " + note.text, { reminders: [reminder.id] });
      }
    }

    if (!this.options.isQuiet(now)) {
      for (const note of this.options.getNotes()) {
        if (
          note.kind !== "todo" ||
          note.done ||
          note.status !== "waiting" ||
          !note.followUpAt ||
          note.followedUp === note.followUpAt ||
          Date.parse(note.followUpAt) > now
        ) continue;

        note.followedUp = note.followUpAt;
        changed = true;
        const reminder: Reminder = {
          id: randomUUID(),
          text: (`Спросить${note.waitingFor ? " у " + note.waitingFor : ""}: ${note.text}`).slice(0, MAX_TEXT),
          at: new Date(now).toISOString(),
          createdAt: new Date(now).toISOString(),
          status: "due",
          firedAt: new Date(now).toISOString(),
          source: note.id,
        };
        this.options.getReminders().push(reminder);
        fired.push({ ...reminder });
        this.addLog("remind", "Напомнила спросить ответ: " + note.text, { reminders: [reminder.id] });
      }
    }

    if (automation.rules.length && this.applyRules(now, automation.rules)) changed = true;
    return changed;
  }

  private names(ids: string[]): string {
    const names = ids
      .map((id) => this.options.getNotes().find((note) => note.id === id)?.text)
      .filter(Boolean) as string[];
    return names.slice(0, 3).map((name) => "«" + name.slice(0, 40) + "»").join(", ") +
      (names.length > 3 ? ` и ещё ${names.length - 3}` : "");
  }

  private ruleMatches(rule: AutoRule, note: Note): boolean {
    const value = rule.value.toLowerCase();
    if (rule.match === "important") return note.priority === "high";
    if (rule.match === "tag") {
      return note.project?.toLowerCase() === value || note.text.toLowerCase().includes("#" + value);
    }
    return note.text.toLowerCase().includes(value);
  }

  private applyRules(now: number, rules: AutoRule[]): boolean {
    let changed = false;

    for (const note of this.options.getNotes()) {
      if (note.kind !== "todo" || note.done) continue;

      for (const rule of rules) {
        const key = `${rule.id}@${note.dueAt ?? ""}`;
        if (note.ruled?.includes(key) || !this.ruleMatches(rule, note)) continue;

        note.ruled = [
          ...(note.ruled ?? []).filter((item) => !item.startsWith(rule.id + "@")),
          key,
        ].slice(-20);
        changed = true;

        if (rule.action === "important") {
          if (note.priority === "high") continue;
          this.addLog("rule", "Правило: отметила важным " + note.text, {
            notes: [{
              id: note.id,
              dueAt: note.dueAt ?? null,
              rolled: note.rolled ?? null,
              priority: note.priority ?? null,
            }],
          });
          note.priority = "high";
          continue;
        }

        let at: number;
        if (rule.action === "before") {
          if (!note.dueAt || dateOnly(note.dueAt)) continue;
          at = Date.parse(note.dueAt) - rule.minutes! * 60_000;
        } else {
          const d = new Date(now);
          const [h, m] = rule.time!.split(":").map(Number);
          d.setHours(h!, m!, 0, 0);
          while (d.getDay() !== rule.weekday || d.getTime() <= now) d.setDate(d.getDate() + 1);
          at = d.getTime();
        }

        if (
          at <= now ||
          this.options.getReminders().filter((reminder) => reminder.status !== "done").length >= MAX_REMINDERS
        ) continue;

        this.options.replaceReminders(
          this.options.getReminders().filter((reminder) =>
            !(reminder.rule === rule.id && reminder.source === note.id && reminder.status === "scheduled")
          ),
        );

        const label = rule.action === "before" ? `Через ${ruleBefore(rule.minutes!)} срок: ` : "";
        const reminder: Reminder = {
          id: randomUUID(),
          text: (label + note.text).slice(0, MAX_TEXT),
          at: new Date(at).toISOString(),
          createdAt: new Date(now).toISOString(),
          status: "scheduled",
          source: note.id,
          rule: rule.id,
        };
        this.options.getReminders().push(reminder);
        this.addLog(
          "rule",
          `Правило: напомню ${new Date(at).toLocaleString("ru-RU", {
            weekday: "short",
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })} — ${note.text}`,
          { reminders: [reminder.id] },
        );
      }
    }

    return changed;
  }
}
