import { describe, expect, it, vi } from "vitest";
import type { Mission, Note } from "./organizer";
import { MissionService } from "./mission-service";

function make(start = Date.parse("2026-10-15T12:00:00Z")) {
  const missions: Mission[] = [];
  const notes: Note[] = [];
  const save = vi.fn(async () => {});

  const addNote = vi.fn(async (_kind: "todo", body: unknown) => {
    const note: Note = {
      id: "note-" + (notes.length + 1),
      kind: "todo",
      text: String(body),
      done: false,
      createdAt: new Date(start).toISOString(),
    };
    notes.push(note);
    return { ...note };
  });

  const updateTask = vi.fn(async (id: string, patch: Record<string, unknown>) => {
    const note = notes.find((item) => item.id === id)!;
    if (typeof patch.project === "string") note.project = patch.project;
    return { ...note };
  });

  const service = new MissionService({
    getMissions: () => missions,
    getNotes: () => notes,
    save,
    now: () => start,
    addNote,
    updateTask,
  });

  return { service, missions, notes, save, addNote, updateTask };
}

describe("MissionService", () => {
  it("creates missions case-insensitively and validates status", async () => {
    const x = make();
    const mission = await x.service.add("Улучшить JUUNIBI", "Надёжность");

    expect(mission).toMatchObject({
      title: "Улучшить JUUNIBI",
      description: "Надёжность",
      status: "active",
    });
    await expect(x.service.add("улучшить juunibi")).rejects.toMatchObject({ status: 409 });
    await expect(x.service.updateStatus(mission.id, "invalid")).rejects.toMatchObject({ status: 400 });
    expect((await x.service.updateStatus(mission.id, "paused")).status).toBe("paused");
  });

  it("uses tasks as the canonical stage/progress source", async () => {
    const x = make();
    const mission = await x.service.add("Релиз");
    const first = await x.service.addStage(mission.id, "Проверить тесты");
    const second = await x.service.addStage(mission.id, "Исправить ошибки");

    expect(x.service.board()[0]).toMatchObject({ total: 2, done: 0, percent: 0 });
    x.notes.find((note) => note.id === first.id)!.done = true;
    x.notes.find((note) => note.id === first.id)!.completedAt = "2026-10-15T12:00:00Z";

    expect(x.service.board()[0]).toMatchObject({
      total: 2,
      done: 1,
      percent: 50,
      next: { id: second.id },
    });
  });

  it("does not choose a blocked stage until its parent is done", async () => {
    const x = make();
    const mission = await x.service.add("Большой план");
    const parent = await x.service.addStage(mission.id, "Начало");
    const child = await x.service.addStage(mission.id, "Следующий этап");
    x.notes.find((note) => note.id === child.id)!.parentId = parent.id;

    expect(x.service.board()[0]).toMatchObject({
      blocked: 1,
      next: { id: parent.id },
    });

    x.notes.find((note) => note.id === parent.id)!.done = true;
    expect(x.service.board()[0]).toMatchObject({
      blocked: 0,
      next: { id: child.id },
    });
  });

  it("chooses the available stage by priority and then nearest due date", async () => {
    const x = make();
    const mission = await x.service.add("Запуск");
    const later = await x.service.addStage(mission.id, "Позже");
    const urgent = await x.service.addStage(mission.id, "Срочно");
    const soon = await x.service.addStage(mission.id, "Скоро");

    Object.assign(x.notes.find((note) => note.id === later.id)!, {
      priority: "normal",
      dueAt: "2026-10-20T12:00:00Z",
    });
    Object.assign(x.notes.find((note) => note.id === urgent.id)!, {
      priority: "high",
      dueAt: "2026-10-30T12:00:00Z",
    });
    Object.assign(x.notes.find((note) => note.id === soon.id)!, {
      priority: "normal",
      dueAt: "2026-10-16T12:00:00Z",
    });

    expect(x.service.board()[0]?.next?.id).toBe(urgent.id);
  });

  it("counts idle days from the latest stage creation or completion", async () => {
    const start = Date.parse("2026-10-20T12:00:00Z");
    const x = make(start);
    x.missions.push({
      id: "mission",
      title: "Ремонт",
      description: "",
      createdAt: "2026-10-10T12:00:00Z",
      status: "active",
    });
    x.notes.push({
      id: "stage",
      kind: "todo",
      text: "Плитка",
      done: true,
      project: "mission",
      createdAt: "2026-10-14T12:00:00Z",
      completedAt: "2026-10-16T12:00:00Z",
    });

    expect(x.service.board()[0]?.idleDays).toBe(4);
  });

  it("refuses new stages for paused missions", async () => {
    const x = make();
    const mission = await x.service.add("Пауза");
    await x.service.updateStatus(mission.id, "paused");
    await expect(x.service.addStage(mission.id, "Нельзя")).rejects.toMatchObject({ status: 409 });
  });
});
