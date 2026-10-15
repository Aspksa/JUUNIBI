import { describe, expect, it } from "vitest";
import type { Automation, Note } from "./organizer";
import { DEFAULT_AUTOMATION } from "./organizer";
import type { MissionBoardItem } from "./mission-service";
import { SmartPriorityService } from "./smart-priority-service";

const todo = (id: string, text: string, patch: Partial<Note> = {}): Note => ({
  id,
  kind: "todo",
  text,
  done: false,
  createdAt: "2026-10-10T09:00:00Z",
  ...patch,
});

const mission = (
  id: string,
  title: string,
  patch: Partial<MissionBoardItem> = {},
): MissionBoardItem => ({
  id,
  title,
  description: "",
  createdAt: "2026-10-01T09:00:00Z",
  status: "active",
  total: 1,
  done: 0,
  percent: 0,
  idleDays: 0,
  blocked: 0,
  next: null,
  stages: [],
  ...patch,
});

function make(
  notes: Note[],
  options: {
    now?: number;
    automation?: Partial<Automation>;
    missions?: MissionBoardItem[];
    workIds?: string[];
    workDay?: boolean;
  } = {},
) {
  const now = options.now ?? new Date(2026, 9, 15, 10, 0).getTime();
  const automation: Automation = {
    ...DEFAULT_AUTOMATION,
    rules: [],
    ...options.automation,
  };
  const workIds = new Set(options.workIds ?? []);

  return new SmartPriorityService({
    getNotes: () => notes,
    getAutomation: () => automation,
    getMissions: () => options.missions ?? [],
    isWork: (note) => workIds.has(note.id),
    workDayFor: () => options.workDay ?? true,
    now: () => now,
  });
}

describe("SmartPriorityService", () => {
  it("puts overdue/high/doing work ahead during working hours", () => {
    const now = new Date(2026, 9, 15, 10, 0).getTime();
    const notes = [
      todo("urgent", "Срочный отчёт", {
        priority: "high",
        status: "doing",
        dueAt: new Date(2026, 9, 15, 9, 0).toISOString(),
        estimateMinutes: 30,
      }),
      todo("later", "Купить продукты", {
        dueAt: new Date(2026, 9, 17, 18, 0).toISOString(),
        estimateMinutes: 15,
      }),
    ];

    const result = make(notes, { now, workIds: ["urgent"] }).rank();
    expect(result.mode).toBe("work");
    expect(result.recommended[0]).toMatchObject({
      id: "urgent",
      primaryReason: "Просрочено",
      area: "work",
      status: "doing",
    });
    expect(result.recommended[0]?.reasons).toContain("Высокий приоритет");
    expect(result.advisoryOnly).toBe(true);
  });

  it("excludes waiting tasks, blocked stages, inactive missions and future meetings", () => {
    const now = new Date(2026, 9, 15, 10, 0).getTime();
    const notes = [
      todo("wait", "Жду ответ", { status: "waiting" }),
      todo("parent", "Сначала это"),
      todo("child", "Потом это", { parentId: "parent" }),
      todo("paused", "Этап паузы", { project: "m1" }),
      todo("meeting", "Встреча вечером", {
        meeting: true,
        dueAt: new Date(2026, 9, 15, 17, 0).toISOString(),
      }),
    ];
    const missions = [mission("m1", "Пауза", { status: "paused" })];

    const result = make(notes, { now, missions }).rank();
    expect(result.excluded).toEqual({
      waiting: 1,
      blocked: 1,
      inactiveMission: 1,
      scheduledLater: 1,
    });
    expect(result.recommended.map((item) => item.id)).toEqual(["parent"]);
  });

  it("boosts the next step of a stale active mission", () => {
    const notes = [
      todo("goal", "Сделать API", { project: "m1", priority: "normal" }),
      todo("plain", "Обычное дело", { priority: "normal" }),
    ];
    const missions = [
      mission("m1", "Запуск", {
        idleDays: 5,
        next: { id: "goal", text: "Сделать API", reason: "Доступный этап" },
      }),
    ];

    const result = make(notes, { missions }).rank();
    expect(result.recommended[0]?.id).toBe("goal");
    expect(result.recommended[0]?.reasons).toContain("Следующий шаг цели «Запуск»");
    expect(result.recommended[0]?.reasons).toContain("Цель стоит 5 дней");
  });

  it("prefers personal work outside the configured working window", () => {
    const now = new Date(2026, 9, 15, 20, 0).getTime();
    const notes = [
      todo("work", "Рабочее"),
      todo("home", "Личное"),
    ];

    const result = make(notes, { now, workIds: ["work"] }).rank();
    expect(result.mode).toBe("personal");
    expect(result.recommended[0]?.id).toBe("home");
    expect(result.recommended[0]?.reasons).toContain("Подходит для личного времени");
  });

  it("rewards quick wins but urgency remains stronger", () => {
    const now = new Date(2026, 9, 15, 10, 0).getTime();
    const notes = [
      todo("quick", "Пять минут", { estimateMinutes: 5 }),
      todo("late", "Просроченное большое", {
        estimateMinutes: 240,
        dueAt: new Date(2026, 9, 14, 18, 0).toISOString(),
      }),
    ];

    const result = make(notes, { now }).rank();
    expect(result.recommended[0]?.id).toBe("late");
    expect(result.recommended.find((item) => item.id === "quick")?.reasons)
      .toContain("Можно закрыть за 15 минут");
  });

  it("is read-only, stable and limits the result", () => {
    const notes = Array.from({ length: 12 }, (_, index) =>
      todo(String(index), "Дело " + index, { estimateMinutes: 30 }),
    );
    const before = structuredClone(notes);
    const service = make(notes);

    const first = service.rank(3);
    const second = service.rank(3);
    expect(first.recommended).toHaveLength(3);
    expect(second).toEqual(first);
    expect(notes).toEqual(before);
  });
});
