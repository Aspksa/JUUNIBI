import { describe, expect, it, vi } from "vitest";
import type { Note, Repeat, TaskEvent } from "./organizer";
import { TaskService } from "./task-service";

function make(now = Date.parse("2026-10-09T09:00:00Z")) {
  let notes: Note[] = [];
  const record = vi.fn<(kind: TaskEvent["kind"], note: Note, extra?: Partial<TaskEvent>) => void>();
  const save = vi.fn(async () => {});
  const service = new TaskService({
    getNotes: () => notes,
    replaceNotes: (next) => { notes = next; },
    save,
    now: () => now,
    makeRoom: () => true,
    record,
    workday: () => true,
    nextOccurrence: (at: number, _repeat: Repeat) => at + 86_400_000,
    cleanLinks: (value) => Array.isArray(value) ? value as never : undefined,
  });
  return { service, get notes() { return notes; }, record, save };
}

describe("TaskService", () => {
  it("owns task validation and status transitions", async () => {
    const x = make();
    const task = await x.service.addNote("todo", "  Отчёт  ");
    const updated = await x.service.updateTask(task.id, {
      priority: "high",
      status: "waiting",
      waitingFor: "Анна",
      followUpAt: "2026-10-10T09:00:00Z",
      estimateMinutes: 45,
    });

    expect(updated).toMatchObject({
      text: "Отчёт",
      priority: "high",
      status: "waiting",
      waitingFor: "Анна",
      estimateMinutes: 45,
    });
    expect(updated.statusAt).toBeTruthy();

    const reset = await x.service.updateTask(task.id, { status: "todo" });
    expect(reset.status).toBeUndefined();
    expect(reset.waitingFor).toBeUndefined();
    expect(reset.followUpAt).toBeUndefined();
  });

  it("creates and safely retracts an unchanged repeating occurrence", async () => {
    const x = make();
    const task = await x.service.addTask("Зарядка", {
      dueAt: "2026-10-09T18:00:00Z",
      repeat: "daily",
    });

    await x.service.setDone(task.id, true);
    expect(x.notes).toHaveLength(2);
    const generated = x.notes.find((note) => note.id !== task.id)!;
    expect(generated.repeat).toBe("daily");

    await x.service.setDone(task.id, false);
    expect(x.notes.map((note) => note.id)).toEqual([task.id]);
  });

  it("preserves a generated repeating occurrence after the owner edits it", async () => {
    const x = make();
    const task = await x.service.addTask("Отчёт", {
      dueAt: "2026-10-09T18:00:00Z",
      repeat: "daily",
    });

    await x.service.setDone(task.id, true);
    const generated = x.notes.find((note) => note.id !== task.id)!;
    await x.service.updateTask(generated.id, { priority: "high" });
    await x.service.setDone(task.id, false);

    expect(x.notes.find((note) => note.id === generated.id)?.priority).toBe("high");
  });

  it("turns subtasks into ordinary tasks when a parent is removed", async () => {
    const x = make();
    const parent = await x.service.addNote("todo", "Переезд");
    const child = await x.service.addNote("todo", "Упаковать книги");
    await x.service.updateTask(child.id, { parentId: parent.id });

    await x.service.removeNote(parent.id);
    expect(x.service.listNotes().find((note) => note.id === child.id)?.parentId).toBeUndefined();
  });

  it("rejects invalid planning metadata without mutating the task", async () => {
    const x = make();
    const task = await x.service.addNote("todo", "Дело");
    await expect(x.service.updateTask(task.id, { estimateMinutes: 12.5 })).rejects.toThrow(/1–1440/);
    await expect(x.service.updateTask(task.id, { parentId: task.id })).rejects.toThrow(/Родительское/);
    expect(x.service.listNotes()[0]).toMatchObject({ id: task.id, text: "Дело" });
  });
});
