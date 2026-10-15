import { describe, expect, it, vi } from "vitest";
import type { AutoLogEntry, Automation, DayOff, Note, Reminder } from "./organizer";
import { DEFAULT_AUTOMATION } from "./organizer";
import { BriefService, type BriefMission } from "./brief-service";
import type { AutomationState } from "./automation-engine";

function make(start = new Date(2026, 9, 13, 8, 0).getTime()) {
  let notes: Note[] = [];
  const reminders: Reminder[] = [];
  const state: AutomationState = {};
  let automation: Automation = { ...DEFAULT_AUTOMATION, rules: [] };
  const logs: AutoLogEntry["kind"][] = [];
  let composer: ((facts: string) => Promise<string | null>) | undefined;
  const missions: BriefMission[] = [];
  const save = vi.fn(async () => {});

  const service = new BriefService({
    getNotes: () => notes,
    replaceNotes: (value) => { notes = value; },
    getReminders: () => reminders,
    getAutomation: () => automation,
    getAutoState: () => state,
    now: () => start,
    awayOn: () => undefined,
    isWork: (note) => note.area === "work",
    dayLoad: () => ({ planned: 0, capacity: 480, over: false }),
    missionBoard: () => missions,
    addLog: (kind) => logs.push(kind),
    pruneReminders: () => {},
    save,
    getComposer: () => composer,
  });

  return {
    service,
    reminders,
    state,
    logs,
    missions,
    save,
    get notes() { return notes; },
    set notes(value: Note[]) { notes = value; },
    setComposer(value: typeof composer) { composer = value; },
    setAutomation(patch: Partial<Automation>) { automation = { ...automation, ...patch }; },
  };
}

const todo = (id: string, text: string, patch: Partial<Note> = {}): Note => ({
  id,
  kind: "todo",
  text,
  done: false,
  createdAt: "2026-10-12T09:00:00Z",
  ...patch,
});

describe("BriefService", () => {
  it("puts work meetings/deadlines/waiting before personal tasks", () => {
    const now = new Date(2026, 9, 13, 8, 0).getTime();
    const x = make(now);
    x.notes = [
      todo("meet", "Планёрка", {
        area: "work",
        meeting: true,
        estimateMinutes: 30,
        dueAt: new Date(2026, 9, 13, 10, 0).toISOString(),
      }),
      todo("wait", "Смета", { area: "work", status: "waiting", waitingFor: "Олег" }),
      todo("home", "Забрать посылку", { dueAt: new Date(2026, 9, 13, 19, 0).toISOString() }),
    ];

    const lines = x.service.briefFacts(now).text.split("\n");
    expect(lines[1]).toBe("Работа: встречи: 10:00–10:30 Планёрка; жду ответа: 1 (Олег — Смета).");
    expect(lines[2]).toBe("Личные дела на сегодня (1): 19:00 Забрать посылку.");
  });

  it("keeps deterministic facts and only lets the model rephrase the morning body", async () => {
    const now = new Date(2026, 9, 12, 9, 5).getTime();
    const x = make(now);
    x.setComposer(async (facts) => "Доброе утро! " + facts.split("\n")[0]);

    const note = await x.service.runBrief(now);
    expect(note?.text).toMatch(/^Доброе утро!/);
    expect(x.logs).toEqual(["brief"]);
    expect(x.reminders).toHaveLength(1);
    expect(x.state.briefDay).toBe("2026-10-12");
    expect(await x.service.runBrief(now)).toBeNull();
  });

  it("builds evening and weekly facts from recorded task state", () => {
    const now = new Date(2026, 9, 18, 21, 0).getTime();
    const x = make(now);
    x.notes = [
      todo("done", "Отчёт", {
        done: true,
        completedAt: new Date(2026, 9, 18, 18, 0).toISOString(),
        area: "work",
        estimateMinutes: 120,
        dueAt: new Date(2026, 9, 18, 12, 0).toISOString(),
      }),
      todo("left", "Купить хлеб", { dueAt: new Date(2026, 9, 18, 23, 59).toISOString() }),
      todo("tomorrow", "Встреча", { dueAt: new Date(2026, 9, 19, 11, 0).toISOString() }),
    ];

    expect(x.service.eveningFacts(now).text).toMatch(/Сделано: 1 — Отчёт/);
    expect(x.service.eveningFacts(now).text).toMatch(/Не успели: 1 — Купить хлеб/);
    expect(x.service.weekFacts(now).text).toContain("Рабочие часы: запланировано 2 ч, сделано 2 ч.");
  });

  it("exposes deterministic schedule gates and production-calendar warning", () => {
    const morning = new Date(2026, 9, 12, 9, 1).getTime();
    const x = make(morning);
    expect(x.service.shouldRunBrief(morning)).toBe(true);
    x.state.briefDay = "2026-10-12";
    expect(x.service.shouldRunBrief(morning)).toBe(false);

    const beforeShortDay = new Date(2026, 10, 2, 9, 0).getTime();
    expect(x.service.tomorrowWarning(beforeShortDay)).toMatch(/^Завтра сокращённый рабочий день/);
  });

  it("replaces the prior auto note while force mode avoids notification/log side effects", async () => {
    const now = new Date(2026, 9, 18, 21, 0).getTime();
    const x = make(now);
    x.notes = [todo("old", "Старый", { kind: "note", auto: "evening" } as Partial<Note>)];

    const first = await x.service.runEvening(now, true);
    expect(first?.auto).toBe("evening");
    expect(x.notes.filter((note) => note.auto === "evening")).toHaveLength(1);
    expect(x.reminders).toHaveLength(0);
    expect(x.logs).toHaveLength(0);
  });
});
