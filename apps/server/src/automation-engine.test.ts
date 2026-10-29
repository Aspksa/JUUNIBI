import { describe, expect, it, vi } from "vitest";
import type { AutoLogEntry, Automation, Note, Reminder, TaskEvent } from "./organizer";
import { DEFAULT_AUTOMATION } from "./organizer";
import { AutomationEngine, type AutomationState } from "./automation-engine";

// Calendar scenarios use local wall-clock time in every host timezone.
function make(start = Date.parse("2026-10-15T10:00:00Z")) {
  let now = start;
  let notes: Note[] = [];
  let reminders: Reminder[] = [];
  let log: AutoLogEntry[] = [];
  const history: TaskEvent[] = [];
  const count: Partial<Record<AutoLogEntry["kind"], number>> = {};
  const state: AutomationState = {};
  let automation: Automation = {
    ...DEFAULT_AUTOMATION,
    brief: false,
    evening: false,
    weekly: false,
    rules: [],
  };
  const save = vi.fn(async () => {});

  const engine = new AutomationEngine({
    getNotes: () => notes,
    replaceNotes: (value) => { notes = value; },
    getReminders: () => reminders,
    replaceReminders: (value) => { reminders = value; },
    getAutomation: () => automation,
    getAutoState: () => state,
    getLog: () => log,
    replaceLog: (value) => { log = value; },
    getAutoCount: () => count,
    getHistory: () => history,
    save,
    now: () => now,
    isQuiet: () => false,
    awayOn: () => undefined,
    workDayFor: () => true,
    isWork: () => true,
    record: (kind, note, extra = {}) => {
      history.push({
        at: new Date(now).toISOString(),
        id: note.id,
        kind,
        text: note.text,
        todo: note.kind === "todo",
        ...extra,
      });
    },
  });

  return {
    engine,
    state,
    history,
    count,
    get notes() { return notes; },
    get reminders() { return reminders; },
    get log() { return log; },
    addNote(note: Note) { notes.push(note); },
    setNow(value: number) { now = value; },
    setAutomation(patch: Partial<Automation>) { automation = { ...automation, ...patch }; },
    save,
  };
}

const todo = (id: string, text: string, dueAt?: string): Note => ({
  id,
  kind: "todo",
  text,
  done: false,
  createdAt: "2026-10-14T09:00:00Z",
  ...(dueAt ? { dueAt } : {}),
});

describe("AutomationEngine", () => {
  it("rolls overdue tasks once per day and can undo the untouched move", async () => {
    const x = make();
    x.addNote(todo("a", "Отчёт", "2026-10-14T09:00:00Z"));

    const fired: Reminder[] = [];
    expect(x.engine.run(Date.parse("2026-10-15T10:00:00Z"), fired)).toBe(true);
    expect(x.notes[0]).toMatchObject({ rolled: 1 });
    expect(x.history[0]).toMatchObject({ kind: "move", auto: true, from: "2026-10-14T09:00:00Z" });
    expect(x.engine.listLog()[0]?.kind).toBe("roll");

    expect(x.engine.run(Date.parse("2026-10-15T11:00:00Z"), fired)).toBe(false);
    const entry = x.engine.listLog()[0]!;
    await x.engine.undoLog(entry.id);
    expect(x.notes[0]?.dueAt).toBe("2026-10-14T09:00:00Z");
    expect(x.notes[0]?.rolled).toBeUndefined();
  });

  it("refuses undo after the owner changes an automatically moved task", async () => {
    const x = make();
    x.addNote(todo("a", "Отчёт", "2026-10-14T09:00:00Z"));
    x.engine.run(Date.parse("2026-10-15T10:00:00Z"), []);
    const entry = x.engine.listLog()[0]!;
    x.notes[0]!.dueAt = "2026-10-16T12:00:00Z";
    await expect(x.engine.undoLog(entry.id)).rejects.toMatchObject({ status: 409 });
  });

  it("creates due and waiting-for reminders without repeating them", () => {
    const x = make(Date.parse("2026-10-15T09:50:00"));
    x.addNote(todo("due", "Созвон", "2026-10-15T10:00:00"));
    x.addNote({
      ...todo("wait", "Ответ по договору"),
      status: "waiting",
      waitingFor: "Анна",
      followUpAt: "2026-10-15T09:45:00",
    });

    const fired: Reminder[] = [];
    x.engine.run(Date.parse("2026-10-15T09:50:00"), fired);
    expect(fired.map((item) => item.text)).toEqual([
      "Срок в 10:00: Созвон",
      "Спросить у Анна: Ответ по договору",
    ]);
    expect(x.engine.run(Date.parse("2026-10-15T09:55:00"), fired)).toBe(false);
    expect(fired).toHaveLength(2);
  });

  it("applies rules once and undo restores an earlier priority", async () => {
    const x = make();
    x.setAutomation({
      rules: [
        { id: "imp", match: "word", value: "налог", action: "important" },
        { id: "buy", match: "tag", value: "покупки", action: "weekday", weekday: 6, time: "10:00" },
      ],
    });
    x.addNote(todo("tax", "Заплатить налог"));
    x.addNote(todo("milk", "Молоко #покупки"));

    expect(x.engine.run(Date.parse("2026-10-14T12:00:00Z"), [])).toBe(true);
    expect(x.notes.find((note) => note.id === "tax")?.priority).toBe("high");
    expect(x.reminders.filter((reminder) => reminder.rule === "buy")).toHaveLength(1);

    x.engine.run(Date.parse("2026-10-14T12:01:00Z"), []);
    expect(x.reminders.filter((reminder) => reminder.rule === "buy")).toHaveLength(1);

    const entry = x.engine.listLog().find((item) => item.text.includes("важным"))!;
    await x.engine.undoLog(entry.id);
    expect(x.notes.find((note) => note.id === "tax")?.priority).toBeUndefined();
  });

  it("keeps audit counts and evidence grounded in real state", () => {
    const x = make();
    x.addNote({ ...todo("done", "Готово"), done: true });
    x.engine.addLog("quiet", "Тест");
    const evidence = x.engine.evidence();
    expect(x.engine.counts().quiet).toBe(1);
    expect(evidence).toMatchObject({
      totals: { logged: 1, active: 1, taskCompletion: 1 },
      advisoryOnly: true,
      evidence: "task-history-and-automation-log",
    });
  });
});
