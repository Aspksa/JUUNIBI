import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Organizer, areaOf } from "../src/organizer";

const dirs: string[] = [];
afterEach(async () => { for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true }); });
async function tmp() { const d = await mkdtemp(path.join(os.tmpdir(), "juunibi-work-")); dirs.push(d); return path.join(d, "o.json"); }
/** A local moment: «2026-10-13 10:00» (a Tuesday, a working day). */
const at = (day: string, hm = "12:00") => new Date(`${day}T${hm}:00`).getTime();

describe("«Дела»: work to-dos", () => {
  it("knows the sphere from the to-do, its project or a project named работа", () => {
    expect(areaOf({ project: "работа" })).toBe("work");
    expect(areaOf({ project: "дом" })).toBe("personal");
    expect(areaOf({ project: "Cloud.ru" }, [{ name: "cloud.ru", area: "work" }])).toBe("work");
    expect(areaOf({ project: "работа", area: "personal" })).toBe("personal");
    expect(areaOf({})).toBe("personal");
  });

  it("keeps status, waiting and meeting fields and drops the waiting ones when the status changes", async () => {
    const file = await tmp();
    const o = new Organizer(file);
    const n = await o.addNote("todo", "Договор");
    const w = await o.updateTask(n.id, { waitingFor: "Иван", followUpAt: "2026-10-14T10:00:00+03:00", area: "work" });
    expect(w).toMatchObject({ status: "waiting", waitingFor: "Иван", area: "work" });
    const d = await o.updateTask(n.id, { status: "doing" });
    expect(d.status).toBe("doing");
    expect(d.waitingFor).toBeUndefined();
    expect(d.followUpAt).toBeUndefined();
    await expect(o.updateTask(n.id, { status: "later" })).rejects.toThrow(/Статус/);
    const m = await o.updateTask(n.id, { meeting: true, estimateMinutes: 60 });
    expect(m.meeting).toBe(true);
    await o.flush();
    const again = new Organizer(file);
    await again.load();
    expect(again.listNotes()[0]).toMatchObject({ status: "doing", meeting: true, area: "work" });
  });

  it("reminds to ask again once, at the chosen moment", async () => {
    let now = at("2026-10-13", "10:00");
    const o = new Organizer(await tmp(), () => now);
    await o.setAutomation({ brief: false, evening: false, weekly: false, rollOverdue: false, dueReminder: "off" });
    const n = await o.addNote("todo", "Счёт за сентябрь");
    await o.updateTask(n.id, { waitingFor: "бухгалтерия", followUpAt: new Date(at("2026-10-13", "15:00")).toISOString() });
    expect(await o.tick()).toEqual([]);
    now = at("2026-10-13", "15:01");
    const fired = await o.tick();
    expect(fired.map((r) => r.text)).toEqual(["Спросить у бухгалтерия: Счёт за сентябрь"]);
    now = at("2026-10-13", "15:05");
    expect(await o.tick()).toEqual([]);
  });

  it("stores project colour, deadline and sphere, and forgets a project with nothing set", async () => {
    const o = new Organizer(await tmp());
    await o.setProject("Cloud.ru", { color: "blue", dueAt: "2026-12-01", area: "work" });
    expect(o.listProjects()).toEqual([{ name: "Cloud.ru", color: "blue", dueAt: "2026-12-01", area: "work" }]);
    await expect(o.setProject("Cloud.ru", { color: "pink" })).rejects.toThrow(/Цвет/);
    await o.setProject("cloud.ru", { color: null, dueAt: null, area: null });
    expect(o.listProjects()).toEqual([]);
  });

  it("keeps templates without duplicates", async () => {
    const o = new Organizer(await tmp());
    const t = await o.addTemplate("отчёт по пятницам в 17:00 #работа");
    await expect(o.addTemplate("Отчёт по пятницам в 17:00 #работа")).rejects.toThrow(/уже есть/);
    expect(o.listTemplates()).toHaveLength(1);
    await o.removeTemplate(t.id);
    expect(o.listTemplates()).toEqual([]);
  });

  it("a vacation reports the work to-dos inside it, and «на рабочий день» skips it for work only", async () => {
    const now = at("2026-10-12", "10:00"); // Monday
    const o = new Organizer(await tmp(), () => now);
    const work = await o.addNote("todo", "Отчёт");
    await o.updateTask(work.id, { area: "work", dueAt: new Date(at("2026-10-14", "11:00")).toISOString() });
    const home = await o.addNote("todo", "Купить хлеб");
    await o.updateTask(home.id, { dueAt: new Date(at("2026-10-14", "11:00")).toISOString() });
    const r = await o.addDayOff("2026-10-13", "2026-10-16", "vacation");
    expect(r.clash).toEqual([work.id]);
    await expect(o.addDayOff("2026-10-15", "2026-10-20", "sick")).rejects.toThrow(/уже отмечены/);
    const moved = await o.moveTasks([work.id, home.id], "workday");
    const day = (id: string) => { const d = new Date(moved.find((n) => n.id === id)!.dueAt!); return d.getDate(); };
    expect(day(work.id)).toBe(19); // the Monday after the vacation
    expect(day(home.id)).toBe(15); // a personal to-do just goes to the next day
  });

  it("on a vacation day an overdue work to-do rolls past the vacation, a personal one to today", async () => {
    let now = at("2026-10-12", "10:00");
    const o = new Organizer(await tmp(), () => now);
    await o.setAutomation({ brief: false, evening: false, weekly: false, dueReminder: "off" });
    await o.addDayOff("2026-10-13", "2026-10-14", "sick");
    const work = await o.addNote("todo", "Сдать отчёт");
    await o.updateTask(work.id, { project: "работа", dueAt: new Date(at("2026-10-12", "17:00")).toISOString() });
    const home = await o.addNote("todo", "Позвонить маме");
    await o.updateTask(home.id, { dueAt: new Date(at("2026-10-12", "17:00")).toISOString() });
    now = at("2026-10-13", "09:00");
    await o.tick();
    const due = (id: string) => new Date(o.listNotes().find((n) => n.id === id)!.dueAt!);
    expect(due(work.id).getDate()).toBe(15);
    expect(due(work.id).getHours()).toBe(17);
    expect(due(home.id).getDate()).toBe(13);
  });

  it("moves to-dos to a given day", async () => {
    const o = new Organizer(await tmp(), () => at("2026-10-12"));
    const n = await o.addNote("todo", "Встреча");
    await o.updateTask(n.id, { dueAt: new Date(at("2026-10-12", "15:30")).toISOString() });
    const [m] = await o.moveTasks([n.id], "2026-10-20");
    expect(new Date(m!.dueAt!).getDate()).toBe(20);
    expect(new Date(m!.dueAt!).getHours()).toBe(15);
    await expect(o.moveTasks([n.id], "someday")).rejects.toThrow(/Куда/);
  });

  it("the morning brief of a working day starts with work: meetings, deadlines, waiting", async () => {
    const now = at("2026-10-13", "08:00");
    const o = new Organizer(await tmp(), () => now);
    const meet = await o.addNote("todo", "Планёрка");
    await o.updateTask(meet.id, { area: "work", meeting: true, estimateMinutes: 30, dueAt: new Date(at("2026-10-13", "10:00")).toISOString() });
    const wait = await o.addNote("todo", "Смета");
    await o.updateTask(wait.id, { area: "work", waitingFor: "Олег" });
    const home = await o.addNote("todo", "Забрать посылку");
    await o.updateTask(home.id, { dueAt: new Date(at("2026-10-13", "19:00")).toISOString() });
    const lines = o.briefFacts(now).text.split("\n");
    expect(lines[1]).toBe("Работа: встречи: 10:00–10:30 Планёрка; жду ответа: 1 (Олег — Смета).");
    expect(lines[2]).toBe("Личные дела на сегодня (1): 19:00 Забрать посылку.");
  });

  it("the week review counts work hours", async () => {
    const now = at("2026-10-18", "21:00"); // Sunday
    const o = new Organizer(await tmp(), () => now);
    const a = await o.addNote("todo", "Отчёт");
    await o.updateTask(a.id, { area: "work", estimateMinutes: 120, dueAt: new Date(at("2026-10-14")).toISOString() });
    await o.setDone(a.id, true);
    const b = await o.addNote("todo", "Презентация");
    await o.updateTask(b.id, { area: "work", estimateMinutes: 60, dueAt: new Date(at("2026-10-16")).toISOString() });
    expect(o.weekFacts(now).text).toContain("Рабочие часы: запланировано 3 ч, сделано 2 ч.");
  });
});
