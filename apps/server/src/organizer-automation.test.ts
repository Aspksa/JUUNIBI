import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_AUTOMATION, Organizer, nextOccurrence } from "./organizer";
import { isWorkday } from "@juunibi/core";
import { parseSteps } from "./task-helpers";

const local = (m: number, d: number, h = 9, min = 0, y = 2026) => new Date(y, m - 1, d, h, min).getTime();
async function setup(start: number) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "juunibi-auto-"));
  let t = start;
  const o = new Organizer(path.join(dir, "o.json"), () => t);
  await o.load();
  return { o, file: path.join(dir, "o.json"), set: (ms: number) => { t = ms; }, done: () => rm(dir, { recursive: true, force: true }) };
}

describe("автоматизация дел", () => {
  it("утренняя сводка: один раз в день после своего времени, заметка заменяется, приходит уведомление", async () => {
    const { o, set, done } = await setup(local(10, 12, 8));
    try {
      await o.addTask("Позвонить маме", { dueAt: new Date(local(10, 12, 20)).toISOString() });
      await o.tick();
      expect(o.listNotes().some((n) => n.auto === "brief")).toBe(false); // 08:00 — ещё рано
      set(local(10, 12, 9, 1)); await o.tick();
      const brief = o.listNotes().filter((n) => n.auto === "brief");
      expect(brief).toHaveLength(1);
      expect(brief[0]!.text).toMatch(/Понедельник, 12 октября — рабочий день/);
      expect(brief[0]!.text).toMatch(/20:00 Позвонить маме/);
      expect(o.listReminders().filter((r) => r.source === "brief" && r.status === "due")).toHaveLength(1);
      set(local(10, 12, 10)); await o.tick();
      expect(o.listReminders().filter((r) => r.source === "brief")).toHaveLength(1); // не повторяется в тот же день
      set(local(10, 13, 9, 30)); await o.tick();
      expect(o.listNotes().filter((n) => n.auto === "brief")).toHaveLength(1); // вчерашняя заменена
      set(local(10, 14, 21)); await o.tick();
      expect(o.listReminders().filter((r) => r.source === "brief")).toHaveLength(2); // вечером не приходит
    } finally { await done(); }
  });

  it("сводку можно написать словами помощницы, а при сбое остаётся простая", async () => {
    const { o, set, done } = await setup(local(10, 12, 9, 5));
    try {
      o.composeBrief = async (facts) => "Доброе утро! " + facts.split("\n")[0];
      await o.tick();
      expect(o.listNotes().find((n) => n.auto === "brief")!.text).toMatch(/^Доброе утро! Понедельник/);
      o.composeBrief = async () => { throw new Error("сеть"); };
      set(local(10, 13, 9, 5)); await o.tick();
      expect(o.listNotes().find((n) => n.auto === "brief")!.text).toMatch(/^Вторник, 13 октября/);
    } finally { await done(); }
  });

  it("просроченное переносится на сегодня с пометкой, и только раз в день", async () => {
    const { o, set, done } = await setup(local(10, 12, 7));
    try {
      await o.setAutomation({ brief: false });
      const a = await o.addTask("Отчёт", { dueAt: new Date(local(10, 12, 18)).toISOString() });
      const b = await o.addTask("Оплатить", { dueAt: new Date(local(10, 12, 23, 59)).toISOString() });
      set(local(10, 14, 7)); await o.tick();
      const [na, nb] = [a, b].map((x) => o.listNotes().find((n) => n.id === x.id)!);
      expect(new Date(na!.dueAt!).getTime()).toBe(local(10, 14, 18));
      expect(na!.rolled).toBe(1);
      expect(new Date(nb!.dueAt!).getTime()).toBe(local(10, 14, 23, 59));
      // отключено — не трогает
      await o.setAutomation({ rollOverdue: false });
      set(local(10, 16, 7)); await o.tick();
      expect(new Date(o.listNotes().find((n) => n.id === a.id)!.dueAt!).getTime()).toBe(local(10, 14, 18));
      // время, которое сегодня уже прошло, становится концом дня
      await o.setAutomation({ rollOverdue: true });
      set(local(10, 16, 20)); await o.tick();
      expect(new Date(o.listNotes().find((n) => n.id === a.id)!.dueAt!).getTime()).toBe(local(10, 16, 23, 59));
      // ручная смена срока снимает пометку
      expect((await o.updateTask(a.id, { dueAt: new Date(local(10, 20, 10)).toISOString() })).rolled).toBeUndefined();
      expect(o.listNotes().find((n) => n.id === a.id)!.rolled).toBeUndefined();
      // и срок можно убрать совсем
      await o.updateTask(a.id, { dueAt: null });
      expect(o.listNotes().find((n) => n.id === a.id)!.dueAt).toBeUndefined();
    } finally { await done(); }
  });

  it("напоминание о сроке дела: за 15 минут, один раз, и снова после переноса", async () => {
    const { o, set, done } = await setup(local(10, 12, 7));
    try {
      await o.setAutomation({ brief: false });
      const t = await o.addTask("Созвон", { dueAt: new Date(local(10, 12, 11)).toISOString() });
      await o.addTask("Без времени", { dueAt: new Date(local(10, 12, 23, 59)).toISOString() });
      set(local(10, 12, 10, 40)); expect(await o.tick()).toEqual([]);
      set(local(10, 12, 10, 46)); const fired = await o.tick();
      expect(fired.map((r) => r.text)).toEqual(["Срок в 11:00: Созвон"]);
      expect(fired[0]!.source).toBe(t.id);
      set(local(10, 12, 10, 50)); expect(await o.tick()).toEqual([]);
      await o.updateTask(t.id, { dueAt: new Date(local(10, 12, 15)).toISOString() });
      set(local(10, 12, 14, 50)); expect((await o.tick()).map((r) => r.text)).toEqual(["Срок в 15:00: Созвон"]);
      await o.setAutomation({ dueReminder: "off" });
      await o.updateTask(t.id, { dueAt: new Date(local(10, 12, 16)).toISOString() });
      set(local(10, 12, 15, 50)); expect(await o.tick()).toEqual([]);
    } finally { await done(); }
  });

  it("повторяющееся дело: после отметки появляется следующее, отмена отметки его убирает", async () => {
    const { o, set, done } = await setup(local(10, 20, 10));
    try {
      await o.setAutomation({ brief: false });
      const t = await o.addTask("Оплатить квартиру", { dueAt: new Date(local(10, 25, 23, 59)).toISOString(), repeat: "monthly" });
      await o.setDone(t.id, true);
      const next = o.listNotes().find((n) => n.id !== t.id)!;
      expect(next).toMatchObject({ text: "Оплатить квартиру", done: false, repeat: "monthly" });
      expect(new Date(next.dueAt!).getTime()).toBe(local(11, 25, 23, 59));
      await o.setDone(t.id, true); // повторная отметка ничего не дублирует
      expect(o.listNotes()).toHaveLength(2);
      await o.setDone(t.id, false);
      expect(o.listNotes().map((n) => n.id)).toEqual([t.id]);
      set(local(11, 3, 10));
      await o.setDone(t.id, true); // отмечено поздно: следующее — после сегодняшнего дня
      expect(new Date(o.listNotes().find((n) => n.id !== t.id)!.dueAt!).getTime()).toBe(local(11, 25, 23, 59));
    } finally { await done(); }
  });

  it("«по будням» пропускает праздники и знает рабочие субботы; ежегодный повтор", () => {
    expect(new Date(nextOccurrence(local(12, 30, 10), "weekdays", local(12, 30, 11), undefined, isWorkday)).getTime()).toBe(local(1, 11, 10, 0, 2027)); // 31.12 — перенос, 1–8.01 — каникулы, 9–10 — выходные
    expect(new Date(nextOccurrence(local(2, 19, 10, 0, 2027), "weekdays", local(2, 19, 11, 0, 2027), undefined, isWorkday)).getTime()).toBe(local(2, 20, 10, 0, 2027));
    expect(new Date(nextOccurrence(local(12, 30, 10), "weekdays", local(12, 30, 11))).getTime()).toBe(local(12, 31, 10));
    expect(nextOccurrence(local(3, 5, 9), "yearly", local(3, 5, 10))).toBe(local(3, 5, 9, 0, 2027));
    expect(nextOccurrence(local(2, 28, 9, 0, 2027), "yearly", local(2, 28, 10, 0, 2027), 29, undefined, 1)).toBe(local(2, 29, 9, 0, 2028));
  });

  it("настройки автоматики сохраняются и проверяются", async () => {
    const { o, file, done } = await setup(local(10, 12, 7));
    try {
      expect(o.getAutomation()).toEqual(DEFAULT_AUTOMATION);
      await o.setAutomation({ briefTime: "08:30", dueReminder: "morning" });
      await expect(o.setAutomation({ briefTime: "25:00" })).rejects.toMatchObject({ status: 400 });
      await expect(o.setAutomation({ dueReminder: "5" })).rejects.toMatchObject({ status: 400 });
      const again = new Organizer(file, () => local(10, 12, 7)); await again.load();
      expect(again.getAutomation()).toMatchObject({ briefTime: "08:30", dueReminder: "morning" });
    } finally { await done(); }
  });
});

describe("шаги от помощницы", () => {
  it("понимает JSON-массив и нумерованный список", () => {
    expect(parseSteps('Вот: ["Собрать коробки", "Позвонить грузчикам", "Позвонить грузчикам"]')).toEqual(["Собрать коробки", "Позвонить грузчикам"]);
    expect(parseSteps("1. Купить билеты\n2) Забронировать отель\n- Собрать вещи\nУдачи!")).toEqual(["Купить билеты", "Забронировать отель", "Собрать вещи"]);
    expect(parseSteps("не знаю")).toEqual([]);
  });
});
