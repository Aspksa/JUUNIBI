import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Organizer } from "../src/organizer";

const dirs: string[] = [];
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
async function tmp() { const d = await mkdtemp(path.join(os.tmpdir(), "juunibi-org-")); dirs.push(d); return path.join(d, "o.json"); }

describe("Дела: subtasks and stored data", () => {
  it("deleting a to-do turns its subtasks into ordinary to-dos", async () => {
    const o = new Organizer(await tmp());
    const parent = await o.addNote("todo", "Переезд");
    const child = await o.addNote("todo", "Упаковать книги");
    await o.updateTask(child.id, { parentId: parent.id });
    expect(o.listNotes().find((n) => n.id === child.id)?.parentId).toBe(parent.id);
    await o.removeNote(parent.id);
    expect(o.listNotes().find((n) => n.id === child.id)?.parentId).toBeUndefined();
  });

  it("rejects a fractional time estimate instead of failing", async () => {
    const o = new Organizer(await tmp());
    const n = await o.addNote("todo", "Отчёт");
    await expect(o.updateTask(n.id, { estimateMinutes: 12.5 })).rejects.toThrow(/1–1440/);
  });

  it("cleans broken fields and orphaned subtasks when loading", async () => {
    const file = await tmp();
    const t = "2026-10-01T10:00:00.000Z";
    await writeFile(file, JSON.stringify({ notes: [
      { id: "a", kind: "todo", text: "Дело", done: false, createdAt: t, priority: "urgent", dueAt: "never", estimateMinutes: 2.5, parentId: "gone" },
      { id: "b", kind: "note", text: "Заметка", done: false, createdAt: t, priority: "high", dueAt: t },
    ] }));
    const o = new Organizer(file);
    await o.load();
    const [a, b] = o.listNotes();
    expect(a).toEqual({ id: "a", kind: "todo", text: "Дело", done: false, createdAt: t });
    expect(b).toEqual({ id: "b", kind: "note", text: "Заметка", done: false, createdAt: t });
  });
});
