import { describe, expect, it, vi } from "vitest";
import type { AutoLogEntry, Automation, Note, Reminder, TaskEvent } from "./organizer";
import { DEFAULT_AUTOMATION } from "./organizer";
import { PlanningService } from "./planning-service";

function make(start = Date.parse("2026-10-12T07:00:00Z")) {
  let notes: Note[] = [];
  const reminders: Reminder[] = [];
  let moveRequests: string[] = [];
  const events: TaskEvent[] = [];
  const logs: { kind: AutoLogEntry["kind"]; text: string; undo?: AutoLogEntry["undo"] }[] = [];
  let automation: Automation = { ...DEFAULT_AUTOMATION, dayHours: 8, rules: [] };
  const save = vi.fn(async () => {});

  const service = new PlanningService({
    getNotes: () => notes,
    getReminders: () => reminders,
    getAutomation: () => automation,
    getMoveRequests: () => moveRequests,
    replaceMoveRequests: (value) => { moveRequests = value; },
    now: () => start,
    dayKind: () => ({ work: true, short: false, label: "рабочий день" }),
    isWork: (note) => note.area === "work",
    workday: (date) => date.getDay() !== 0 && date.getDay() !== 6,
    workDayFor: (date) => date.getDay() !== 0 && date.getDay() !== 6,
    record: (kind, note, extra = {}) => {
      events.push({
        at: new Date(start).toISOString(),
        id: note.id,
        kind,
        text: note.text,
        todo: note.kind === "todo",
        ...extra,
      });
    },
    addLog: (kind, text, undo) => logs.push({ kind, text, ...(undo ? { undo } : {}) }),
    describeNames: (ids) => ids.map((id) => notes.find((note) => note.id === id)?.text).filter(Boolean).join(", "),
    save,
  });

  return {
    service,
    reminders,
    events,
    logs,
    save,
    get notes() { return notes; },
    set notes(value: Note[]) { notes = value; },
    get moveRequests() { return moveRequests; },
    setAutomation(patch: Partial<Automation>) { automation = { ...automation, ...patch }; },
  };
}

const todo = (id: string, text: string, patch: Partial<Note> = {}): Note => ({
  id,
  kind: "todo",
  text,
  done: false,
  createdAt: "2026-10-10T09:00:00Z",
  ...patch,
});

describe("PlanningService", () => {
  it("builds deterministic advisory priority and time-block plans without mutation", () => {
    const x = make();
    x.notes = [
      todo("a", "Просрочено", { dueAt: "2026-10-11T10:00:00Z", estimateMinutes: 60 }),
      todo("b", "Важное", { priority: "high", estimateMinutes: 90 }),
    ];

    const before = structuredClone(x.notes);
    expect(x.service.planToday().suggested[0]?.id).toBe("a");
    const blocks = x.service.timeBlocks("2026-10-12");
    expect(blocks).toMatchObject({ plannedMinutes: 150, remainingMinutes: 390, advisoryOnly: true });
    expect(x.notes).toEqual(before);
  });

  it("detects overload and suggests non-high-priority work to move", () => {
    const x = make();
    x.setAutomation({ dayHours: 2 });
    x.notes = [
      todo("big", "Большой отчёт", { dueAt: "2026-10-12T23:59:00Z", estimateMinutes: 90 }),
      todo("high", "Важный звонок", { dueAt: "2026-10-12T11:00:00Z", estimateMinutes: 60, priority: "high" }),
    ];

    expect(x.service.dayLoad("2026-10-12")).toMatchObject({
      capacity: 120,
      planned: 150,
      over: true,
      move: [{ id: "big", text: "Большой отчёт", minutes: 90 }],
    });
  });

  it("arranges around fixed work and lunch, applying only selected placements", async () => {
    const x = make();
    x.notes = [
      todo("fixed", "Созвон", { dueAt: "2026-10-12T09:00:00Z" }),
      todo("letters", "Письма", { dueAt: "2026-10-12T23:59:00Z", estimateMinutes: 60 }),
      todo("gift", "Купить подарок", { priority: "high", estimateMinutes: 180 }),
    ];

    const plan = await x.service.arrangeDay("2026-10-12");
    expect(plan.placed.map((item) => [item.id, new Date(item.start).getUTCHours()])).toEqual([
      ["letters", 9],
      ["gift", 14],
    ]);

    await x.service.arrangeDay("2026-10-12", true, ["letters"]);
    expect(x.notes.find((note) => note.id === "letters")?.dueAt).toBe(plan.placed[0]?.start);
    expect(x.notes.find((note) => note.id === "gift")?.dueAt).toBeUndefined();
    expect(x.logs.at(-1)?.kind).toBe("arrange");
    expect(x.events.at(-1)).toMatchObject({ kind: "move", auto: true });
  });

  it("moves tasks idempotently by request id and keeps local task time", async () => {
    const x = make();
    x.notes = [
      todo("a", "Встреча", { dueAt: "2026-10-12T15:30:00Z" }),
    ];

    const moved = await x.service.moveTasks(["a"], "2026-10-20", "request_1234");
    expect(new Date(moved[0]!.dueAt!).getUTCDate()).toBe(20);
    expect(new Date(moved[0]!.dueAt!).getUTCHours()).toBe(15);
    expect(x.moveRequests).toEqual(["request_1234"]);
    await expect(x.service.moveTasks(["a"], "tomorrow", "request_1234")).rejects.toMatchObject({ status: 409 });
  });

  it("validates dates, working windows and move targets", async () => {
    const x = make();
    expect(() => x.service.timeBlocks("2026-02-30")).toThrow(/Недопустимая дата/);
    expect(() => x.service.timeBlocks("2026-10-12", 19, 9)).toThrow(/рабочие часы/);
    await expect(x.service.arrangeDay("2026-10-11")).rejects.toMatchObject({ status: 409 });
    await expect(x.service.moveTasks(["missing"], "someday")).rejects.toThrow(/Куда/);
  });
});
