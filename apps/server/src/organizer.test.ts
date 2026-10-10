import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Organizer, alignStart, buildBrief, nextOccurrence } from "./organizer";

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
      await o.setAutomation({ brief: false }); // the morning brief has its own tests
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

describe("правка и повторы", () => {
  const local = (d: number, h = 9, m = 0) => new Date(2026, 9, d, h, m).getTime(); // октябрь 2026, местное время
  it("текст заметки и напоминания меняется; сработавшее напоминание не правится", async () => {
    const { o, advance, done } = await setup(local(9, 5));
    try {
      const n = await o.addNote("todo", "Купить чай");
      expect((await o.editNote(n.id, " Купить кофе ")).text).toBe("Купить кофе");
      await expect(o.editNote(n.id, "")).rejects.toMatchObject({ status: 400 });
      await expect(o.editNote("нет", "x")).rejects.toMatchObject({ status: 404 });
      const r = await o.addReminder("Позвонить", new Date(local(9, 10)).toISOString());
      const e = await o.editReminder(r.id, { text: "Позвонить маме", at: new Date(local(9, 11)).toISOString(), repeat: "daily" });
      expect(e).toMatchObject({ text: "Позвонить маме", repeat: "daily", at: new Date(local(9, 11)).toISOString() });
      expect((await o.editReminder(r.id, { repeat: "none" })).repeat).toBeUndefined();
      advance(7 * 3600_000);
      await o.tick();
      await expect(o.editReminder(r.id, { text: "x" })).rejects.toMatchObject({ status: 409 });
    } finally { await done(); }
  });
  it("следующий раз: каждый день, по будням (без выходных), каждую неделю; в то же местное время", () => {
    const fri = local(9, 9); // 9 октября 2026 — пятница
    expect(new Date(fri).getDay()).toBe(5);
    expect(nextOccurrence(fri, "daily", fri)).toBe(local(10, 9));
    expect(nextOccurrence(fri, "weekdays", fri)).toBe(local(12, 9));
    expect(nextOccurrence(fri, "weekly", fri)).toBe(local(16, 9));
    // пропущенные дни не копятся: сразу ближайший будущий раз
    expect(nextOccurrence(fri, "daily", local(14, 12))).toBe(local(15, 9));
    expect(alignStart(local(10, 9), "weekdays")).toBe(local(12, 9));
    expect(alignStart(local(10, 9), "daily")).toBe(local(10, 9));
  });
  it("повторяющееся срабатывает копией и переходит на следующий раз; пропуски срабатывают один раз", async () => {
    const { o, advance, done } = await setup(local(9, 8));
    try {
      const r = await o.addReminder("Пить воду", new Date(local(9, 9)).toISOString(), "daily");
      advance(3600_000 + 1);
      const fired = await o.tick();
      expect(fired).toHaveLength(1);
      expect(fired[0]).toMatchObject({ text: "Пить воду", status: "due", seriesId: r.id });
      expect(fired[0]!.repeat).toBeUndefined();
      const series = o.listReminders().find((x) => x.id === r.id)!;
      expect(series).toMatchObject({ status: "scheduled", repeat: "daily", at: new Date(local(10, 9)).toISOString() });
      advance(3 * 86_400_000); // JUUNIBI был закрыт три дня
      expect(await o.tick()).toHaveLength(1);
      expect(o.listReminders().find((x) => x.id === r.id)!.at).toBe(new Date(local(13, 9)).toISOString());
      // отмена серии
      expect((await o.dismissReminder(r.id)).status).toBe("done");
      advance(86_400_000);
      expect(await o.tick()).toEqual([]);
    } finally { await done(); }
  });
  it("старые выполненные напоминания не копятся бесконечно", async () => {
    const { o, advance, done } = await setup(local(1, 8));
    try {
      const r = await o.addReminder("Каждый день", new Date(local(1, 9)).toISOString(), "daily");
      for (let i = 0; i < 130; i++) {
        advance(86_400_000);
        for (const f of await o.tick()) await o.dismissReminder(f.id);
      }
      const all = o.listReminders();
      expect(all.filter((x) => x.status === "done").length).toBeLessThanOrEqual(100);
      expect(all.find((x) => x.id === r.id)?.status).toBe("scheduled");
    } finally { await done(); }
  }, 60_000); // 130 days = ~260 file writes: seconds on Windows with an antivirus or OneDrive
  it("повтор проверяется", async () => {
    const { o, done } = await setup(local(9, 5));
    try { await expect(o.addReminder("x", new Date(local(9, 9)).toISOString(), "hourly")).rejects.toMatchObject({ status: 400 }); }
    finally { await done(); }
  });
});
