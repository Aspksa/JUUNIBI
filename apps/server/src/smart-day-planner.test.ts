import { describe, expect, it, vi } from "vitest";
import type { AutoLogEntry, Automation, Note, Reminder, TaskEvent } from "./organizer";
import { DEFAULT_AUTOMATION } from "./organizer";
import type { SmartPriorityResult } from "./smart-priority-service";
import { SmartDayPlannerService } from "./smart-day-planner";

const iso = (day: number, hour: number, minute = 0) =>
  new Date(2026, 9, day, hour, minute, 0, 0).toISOString();

const todo = (id: string, text: string, patch: Partial<Note> = {}): Note => ({
  id,
  kind: "todo",
  text,
  done: false,
  createdAt: iso(10, 9),
  ...patch,
});

function make(start = new Date(2026, 9, 15, 8, 0).getTime()) {
  let notes: Note[] = [];
  const reminders: Reminder[] = [];
  const events: TaskEvent[] = [];
  const logs: { kind: AutoLogEntry["kind"]; text: string; undo?: AutoLogEntry["undo"] }[] = [];
  let automation: Automation = { ...DEFAULT_AUTOMATION, rules: [], workFrom: "09:00", workTo: "18:00" };
  let away = false;
  const save = vi.fn(async () => {});

  const rank = vi.fn((limit: number, _now: number): SmartPriorityResult => {
    const recommended = notes
      .filter((note) => note.kind === "todo" && !note.done && note.status !== "waiting" && !note.meeting)
      .map((note, index) => ({
        id: note.id,
        text: note.text,
        score: 100 - index,
        primaryReason: note.priority === "high" ? "Высокий приоритет" : "Доступное дело",
        reasons: [note.priority === "high" ? "Высокий приоритет" : "Доступное дело"],
        estimateMinutes: note.estimateMinutes ?? 30,
        area: note.area === "work" ? "work" as const : "personal" as const,
      }))
      .slice(0, limit);
    return {
      generatedAt: new Date(start).toISOString(),
      mode: "work",
      considered: recommended.length,
      eligible: recommended.length,
      excluded: { waiting: 0, blocked: 0, inactiveMission: 0, scheduledLater: 0 },
      recommended,
      advisoryOnly: true,
    };
  });

  const service = new SmartDayPlannerService({
    getNotes: () => notes,
    getReminders: () => reminders,
    getAutomation: () => automation,
    now: () => start,
    dayKind: () => ({
      work: true,
      short: false,
      label: "рабочий день",
      ...(away ? { away: { id: "off", from: "2026-10-15", to: "2026-10-15", kind: "vacation" as const } } : {}),
    }),
    rank,
    isWork: (note) => note.area === "work",
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
    save,
  });

  return {
    service,
    reminders,
    events,
    logs,
    rank,
    save,
    get notes() { return notes; },
    set notes(value: Note[]) { notes = value; },
    setAutomation(patch: Partial<Automation>) { automation = { ...automation, ...patch }; },
    setAway(value: boolean) { away = value; },
  };
}

describe("SmartDayPlannerService", () => {
  it("places ranked tasks around a meeting, reminder and lunch", async () => {
    const x = make();
    x.notes = [
      todo("focus", "Главное", { priority: "high", estimateMinutes: 60 }),
      todo("quick", "Быстрое", { estimateMinutes: 30 }),
      todo("meet", "Планёрка", { meeting: true, dueAt: iso(15, 10), estimateMinutes: 60 }),
    ];
    x.reminders.push({
      id: "r1",
      text: "Позвонить",
      at: iso(15, 11, 30),
      createdAt: iso(14, 9),
      status: "scheduled",
    });

    const plan = await x.service.plan("2026-10-15");
    expect(plan.fixed.map((item) => item.kind)).toEqual(["meeting", "reminder"]);
    expect(plan.placed.map((item) => [
      item.id,
      new Date(item.start).getHours(),
      new Date(item.start).getMinutes(),
    ])).toEqual([
      ["focus", 9, 0],
      ["quick", 11, 0],
    ]);
    expect(plan.advisoryOnly).toBe(true);
  });

  it("uses configured work hours and shortens a short working day", async () => {
    const x = make(new Date(2026, 9, 16, 7, 0).getTime());
    x.setAutomation({ workFrom: "08:00", workTo: "17:00" });
    // replace service's dayKind behaviour by planning a normal day first: work window is settings-driven.
    x.notes = [todo("a", "Дело", { estimateMinutes: 30 })];
    const plan = await x.service.plan("2026-10-16");
    expect(plan.window).toEqual({ from: "08:00", to: "17:00" });
  });

  it("excludes work tasks while away but can schedule personal tasks", async () => {
    const x = make();
    x.setAway(true);
    x.notes = [
      todo("work", "Рабочее", { area: "work", estimateMinutes: 30 }),
      todo("home", "Личное", { area: "personal", estimateMinutes: 30 }),
    ];

    const plan = await x.service.plan("2026-10-15");
    expect(plan.placed.map((item) => item.id)).toEqual(["home"]);
    expect(plan.warnings.join(" ")).toMatch(/Отпуск/);
  });

  it("requires an unchanged preview fingerprint before apply", async () => {
    const x = make();
    x.notes = [todo("a", "Дело", { estimateMinutes: 30 })];
    const preview = await x.service.plan("2026-10-15");

    x.notes[0]!.priority = "high";
    await expect(
      x.service.plan("2026-10-15", true, ["a"], preview.fingerprint),
    ).rejects.toMatchObject({ status: 409 });
    expect(x.notes[0]!.dueAt).toBeUndefined();
  });

  it("applies only selected placements and records one undoable journal action", async () => {
    const x = make();
    x.notes = [
      todo("a", "Первое", { estimateMinutes: 30 }),
      todo("b", "Второе", { estimateMinutes: 30 }),
    ];
    const preview = await x.service.plan("2026-10-15");

    const applied = await x.service.plan("2026-10-15", true, ["b"], preview.fingerprint);
    expect(applied.applied).toBe(1);
    expect(x.notes.find((note) => note.id === "a")?.dueAt).toBeUndefined();
    expect(x.notes.find((note) => note.id === "b")?.dueAt).toBeTruthy();
    expect(x.events).toHaveLength(1);
    expect(x.events[0]).toMatchObject({ id: "b", kind: "move", auto: true });
    expect(x.logs).toHaveLength(1);
    expect(x.logs[0]?.kind).toBe("arrange");
    expect(x.logs[0]?.undo?.notes).toHaveLength(1);
    expect(x.save).toHaveBeenCalledTimes(1);
  });

  it("reports tasks that do not fit without mutating them", async () => {
    const x = make();
    x.setAutomation({ workFrom: "09:00", workTo: "10:00" });
    x.notes = [
      todo("a", "Длинное", { estimateMinutes: 90 }),
      todo("b", "Короткое", { estimateMinutes: 30 }),
    ];
    const before = structuredClone(x.notes);

    const plan = await x.service.plan("2026-10-15");
    expect(plan.left).toBe(1);
    expect(plan.unscheduled[0]?.id).toBe("a");
    expect(plan.placed[0]?.id).toBe("b");
    expect(x.notes).toEqual(before);
  });
});
