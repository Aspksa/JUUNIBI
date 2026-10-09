import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Organizer, buildBrief } from "./organizer";

async function setup(start = Date.parse("2026-10-09T05:00:00+03:00")) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "juunibi-org-"));
  let t = start;
  const o = new Organizer(path.join(dir, "o.json"), () => t);
  await o.load();
  return { o, dir, advance: (ms: number) => { t += ms; }, file: path.join(dir, "o.json"), done: () => rm(dir, { recursive: true, force: true }) };
}

describe("заметки и дела", () => {
  it("добавление, отметка выполненным, удаление; заметку нельзя «выполнить»", async () => {
    const { o, done } = await setup();
    try {
      const todo = await o.addNote("todo", "  Купить чай ");
      const note = await o.addNote("note", "Пароль от wifi в сейфе");
      expect(todo).toMatchObject({ text: "Купить чай", done: false });
      expect((await o.setDone(todo.id, true)).done).toBe(true);
      await expect(o.setDone(note.id, true)).rejects.toMatchObject({ status: 409 });
      await expect(o.setDone("нет", true)).rejects.toMatchObject({ status: 404 });
      await o.removeNote(note.id);
      expect(o.listNotes()).toHaveLength(1);
      await expect(o.removeNote(note.id)).rejects.toMatchObject({ status: 404 });
      for (const bad of ["", "   ", "x".repeat(501), 5]) await expect(o.addNote("todo", bad)).rejects.toMatchObject({ status: 400 });
      await expect(o.addNote("task", "x")).rejects.toMatchObject({ status: 400 });
    } finally { await done(); }
  });
  it("сохраняется на диск и переживает перезапуск; битые записи отбрасываются", async () => {
    const { o, dir, file, done } = await setup();
    try {
      await o.addNote("todo", "Дело");
      await o.addReminder("Позвонить", "2026-10-10T10:00:00+03:00");
      await o.flush();
      const again = new Organizer(file);
      await again.load();
      expect(again.listNotes()).toHaveLength(1);
      expect(again.listReminders()).toHaveLength(1);
      await writeFile(path.join(dir, "bad.json"), JSON.stringify({ notes: [{ id: 1 }, { id: "a", kind: "todo", text: "ok", done: false, createdAt: "x" }], reminders: [{ id: "r", text: "x", at: "не дата", status: "scheduled" }] }));
      const broken = new Organizer(path.join(dir, "bad.json")); await broken.load();
      expect(broken.listNotes()).toHaveLength(1);
      expect(broken.listReminders()).toHaveLength(0);
    } finally { await done(); }
  });
});

describe("напоминания", () => {
  it("срабатывают по времени один раз, затем закрываются", async () => {
    const { o, advance, done } = await setup();
    try {
      const r = await o.addReminder("Позвонить маме", "2026-10-09T10:00:00+03:00");
      expect(r.status).toBe("scheduled");
      expect(await o.tick()).toEqual([]);
      advance(5 * 3600_000 + 1);
      const fired = await o.tick();
      expect(fired).toHaveLength(1);
      expect(fired[0]).toMatchObject({ text: "Позвонить маме", status: "due" });
      expect(await o.tick()).toEqual([]); // повторно не срабатывает
      expect((await o.dismissReminder(r.id)).status).toBe("done");
      await expect(o.dismissReminder("нет")).rejects.toMatchObject({ status: 404 });
    } finally { await done(); }
  });
  it("проверяет время: формат, прошлое, слишком далёкое будущее", async () => {
    const { o, done } = await setup();
    try {
      for (const at of ["завтра в 10", "", 5, "2020-01-01T00:00:00Z"]) await expect(o.addReminder("x", at)).rejects.toMatchObject({ status: 400 });
      await expect(o.addReminder("x", "2030-01-01T00:00:00Z")).rejects.toMatchObject({ status: 400 });
      await expect(o.addReminder("", "2026-10-10T10:00:00Z")).rejects.toMatchObject({ status: 400 });
      expect((await o.addReminder("сейчас", "2026-10-09T05:00:30+03:00")).status).toBe("scheduled");
    } finally { await done(); }
  });
  it("список отсортирован по времени; удаление работает", async () => {
    const { o, done } = await setup();
    try {
      const b = await o.addReminder("позже", "2026-10-12T10:00:00+03:00");
      await o.addReminder("раньше", "2026-10-10T10:00:00+03:00");
      expect(o.listReminders().map((r) => r.text)).toEqual(["раньше", "позже"]);
      await o.removeReminder(b.id);
      expect(o.listReminders()).toHaveLength(1);
      await expect(o.removeReminder(b.id)).rejects.toMatchObject({ status: 404 });
    } finally { await done(); }
  });
});

describe("сводка дня", () => {
  it("собирает просроченные, сегодняшние, дела и счётчик внимания", async () => {
    const { o, advance, done } = await setup(Date.parse("2026-10-09T05:00:00"));
    try {
      await o.addReminder("утром", "2026-10-09T09:00:00");
      await o.addReminder("вечером", "2026-10-09T20:00:00");
      await o.addReminder("завтра", "2026-10-10T09:00:00");
      await o.addNote("todo", "Дело 1"); const d2 = await o.addNote("todo", "Дело 2"); await o.addNote("note", "просто заметка");
      await o.setDone(d2.id, true);
      advance(5 * 3600_000); await o.tick(); // 10:00 — «утром» уже наступило
      const b = buildBrief({ now: Date.parse("2026-10-09T10:00:00"), reminders: o.listReminders(), notes: o.listNotes(), plansRunning: 2, memoryPending: 3, modulesFailed: ["scenes"], updateAvailable: true });
      expect(b.due.map((r) => r.text)).toEqual(["утром"]);
      expect(b.today.map((r) => r.text)).toEqual(["вечером"]);
      expect(b.openTodos).toMatchObject({ count: 1, first: [{ text: "Дело 1" }] });
      expect(b).toMatchObject({ plansRunning: 2, memoryPending: 3, modulesFailed: ["scenes"], updateAvailable: true, attention: 4 });
    } finally { await done(); }
  });
  it("в спокойный день внимание равно нулю", () => {
    expect(buildBrief({ now: Date.now(), reminders: [], notes: [], plansRunning: 0, memoryPending: 0, modulesFailed: [], updateAvailable: false }).attention).toBe(0);
  });
});
