import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Organizer, inQuiet } from "./organizer";

const local = (m: number, d: number, h = 9, min = 0, y = 2026) => new Date(y, m - 1, d, h, min).getTime();
const iso = (ms: number) => new Date(ms).toISOString();
async function setup(start: number) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "juunibi-smart-"));
  let t = start;
  const o = new Organizer(path.join(dir, "o.json"), () => t);
  await o.load();
  await o.setAutomation({ brief: false, evening: false, weekly: false });
  return { o, file: path.join(dir, "o.json"), set: (ms: number) => { t = ms; }, done: () => rm(dir, { recursive: true, force: true }) };
}

describe("умная автоматика", () => {
  it("тихие часы: через полночь; автоматические напоминания ждут утра, свои приходят вовремя", async () => {
    expect(inQuiet(local(10, 12, 23, 30), "23:00", "08:00")).toBe(true);
    expect(inQuiet(local(10, 12, 7, 59), "23:00", "08:00")).toBe(true);
    expect(inQuiet(local(10, 12, 8), "23:00", "08:00")).toBe(false);
    expect(inQuiet(local(10, 12, 14), "13:00", "15:00")).toBe(true);
    const { o, set, done } = await setup(local(10, 12, 22));
    try {
      await o.setAutomation({ rules: [{ id: "r1", match: "word", value: "таблетк", action: "before", minutes: 60 }] });
      await o.addTask("Выпить таблетки", { dueAt: iso(local(10, 13, 0, 30)) });
      await o.addReminder("Выключить духовку", iso(local(10, 12, 23, 40)));
      await o.tick(); // правило создало напоминание на 23:30
      expect(o.listReminders().find((r) => r.rule === "r1")).toBeTruthy();
      set(local(10, 12, 23, 45));
      expect((await o.tick()).map((r) => r.text)).toEqual(["Выключить духовку"]); // своё — вовремя, правило — ждёт
      set(local(10, 13, 8, 1));
      expect((await o.tick()).map((r) => r.text)).toEqual(["Через 1 ч срок: Выпить таблетки"]);
      expect(o.listLog().some((e) => e.kind === "quiet")).toBe(true);
    } finally { await done(); }
  });

  it("отложить до завтра — на время утренней сводки", async () => {
    const { o, set, done } = await setup(local(10, 12, 15));
    try {
      const r = await o.addReminder("Позвонить", iso(local(10, 12, 15, 5)));
      set(local(10, 12, 15, 6)); await o.tick();
      const s = await o.snoozeReminder(r.id, "tomorrow");
      expect(Date.parse(s.at)).toBe(local(10, 13, 9));
      await expect(o.snoozeReminder(r.id, 7)).rejects.toMatchObject({ status: 400 });
    } finally { await done(); }
  });

  it("итог дня вечером и обзор недели в воскресенье", async () => {
    const { o, set, done } = await setup(local(10, 18, 10));
    try {
      await o.setAutomation({ evening: true, weekly: true });
      const a = await o.addTask("Отчёт", { dueAt: iso(local(10, 18, 18)) });
      await o.addTask("Купить хлеб", { dueAt: iso(local(10, 18, 23, 59)) });
      await o.addTask("Встреча", { dueAt: iso(local(10, 19, 11)) });
      await o.setDone(a.id, true);
      set(local(10, 18, 20)); await o.tick();
      expect(o.listNotes().some((n) => n.auto)).toBe(false); // ещё рано
      set(local(10, 18, 21, 1)); await o.tick();
      const eve = o.listNotes().find((n) => n.auto === "evening")!;
      expect(eve.text).toMatch(/Сделано: 1 — Отчёт/);
      expect(eve.text).toMatch(/Не успели: 1 — Купить хлеб/);
      expect(eve.text).toMatch(/Завтра рабочий день: дел 1 — Встреча/);
      expect(o.listNotes().find((n) => n.auto === "week")!.text).toMatch(/Обзор недели: 12 октября — 18 октября\.\nСделано дел: 1/);
      expect(o.listReminders().filter((r) => r.source === "evening" || r.source === "week")).toHaveLength(2);
      set(local(10, 18, 22)); await o.tick();
      expect(o.listReminders().filter((r) => r.source === "evening")).toHaveLength(1); // раз в день
    } finally { await done(); }
  });

  it("серии повторяющихся дел, застрявшие дела и цели в сводке", async () => {
    const { o, set, done } = await setup(local(10, 12, 10));
    try {
      const z = await o.addTask("Зарядка", { dueAt: iso(local(10, 12, 23, 59)), repeat: "daily" });
      await o.setDone(z.id, true);
      let next = o.listNotes().find((n) => !n.done && n.text === "Зарядка")!;
      expect(next.streak).toBe(1);
      set(local(10, 13, 10)); await o.setDone(next.id, true);
      set(local(10, 14, 10)); next = o.listNotes().find((n) => !n.done && n.text === "Зарядка")!; await o.setDone(next.id, true);
      next = o.listNotes().find((n) => !n.done && n.text === "Зарядка")!;
      expect(next.streak).toBe(3);
      const s = await o.addTask("Разобрать балкон", { dueAt: iso(local(10, 14, 23, 59)) });
      const g = await o.addMission("Ремонт", "");
      await o.addMissionStage(g.id, "Выбрать плитку");
      set(local(10, 15, 9)); await o.tick();
      set(local(10, 16, 9)); await o.tick();
      set(local(10, 17, 9)); await o.tick();
      expect(o.listNotes().find((n) => n.id === s.id)!.rolled).toBe(3);
      expect(o.listNotes().find((n) => !n.done && n.text === "Зарядка")!.streak).toBe(0); // пропуск обнуляет серию
      set(local(10, 19, 9)); // понедельник, цель создана в среду
      const text = o.briefFacts().text;
      expect(text).toMatch(/Застряло: «Разобрать балкон» \(перенесено 3 раза\)/);
      expect(text).toMatch(/Цель «Ремонт» стоит 4 дня\. Следующий шаг: Выбрать плитку/);
    } finally { await done(); }
  });

  it("предупреждает о празднике и сокращённом дне накануне; в выходной сводка короткая", async () => {
    const { o, set, done } = await setup(local(11, 2, 9));
    try {
      expect(o.tomorrowWarning()).toMatch(/^Завтра сокращённый рабочий день/);
      await o.addTask("Сдать отчёт", { dueAt: iso(local(11, 4, 12)) });
      set(local(11, 3, 9));
      expect(o.tomorrowWarning()).toMatch(/^Завтра праздник \(.+\)\. На него назначено дел: 1/);
      set(local(10, 17, 10)); // суббота
      expect(o.briefFacts().text).toMatch(/Суббота, 17 октября — выходной\.\nДел на сегодня нет, можно отдохнуть\.[\s\S]*Хорошего выходного!/);
    } finally { await done(); }
  });

  it("нагрузка дня и перенос лишнего на рабочий день с отменой", async () => {
    const { o, done } = await setup(local(10, 16, 9)); // пятница
    try {
      await o.setAutomation({ dayHours: 2 });
      const big = await o.addTask("Большой отчёт", { dueAt: iso(local(10, 16, 23, 59)) });
      await o.updateTask(big.id, { estimateMinutes: 90 });
      const imp = await o.addTask("Важный звонок", { dueAt: iso(local(10, 16, 11)), priority: "high" });
      await o.updateTask(imp.id, { estimateMinutes: 60 });
      const load = o.dayLoad("2026-10-16");
      expect(load).toMatchObject({ capacity: 120, planned: 150, over: true });
      expect(load.move.map((m) => m.text)).toEqual(["Большой отчёт"]);
      expect(o.insights("2026-10").heavyDays).toEqual(["2026-10-16"]);
      const moved = await o.moveTasks(load.move.map((m) => m.id), "workday");
      expect(Date.parse(moved[0]!.dueAt!)).toBe(local(10, 19, 23, 59)); // через выходные — в понедельник
      const entry = o.listLog()[0]!;
      expect(entry.kind).toBe("move");
      await o.undoLog(entry.id);
      expect(Date.parse(o.listNotes().find((n) => n.id === big.id)!.dueAt!)).toBe(local(10, 16, 23, 59));
      await expect(o.undoLog(entry.id)).rejects.toMatchObject({ status: 409 });
    } finally { await done(); }
  });

  it("«Разложить день»: дела без времени — в свободные окна, мимо обеда и занятого", async () => {
    const { o, done } = await setup(local(10, 12, 7));
    try {
      await o.addTask("Созвон", { dueAt: iso(local(10, 12, 9)) }); // 9:00–9:30 занято
      const a = await o.addTask("Письма", { dueAt: iso(local(10, 12, 23, 59)) });
      await o.updateTask(a.id, { estimateMinutes: 60 });
      const b = await o.addTask("Купить подарок", { priority: "high" });
      await o.updateTask(b.id, { estimateMinutes: 180 });
      await o.addTask("Когда-нибудь", { priority: "low" });
      const plan = await o.arrangeDay("2026-10-12");
      expect(plan.window).toEqual({ from: "09:00", to: "18:00" });
      expect(plan.placed.map((p) => [p.text, new Date(p.start).getHours() + ":" + new Date(p.start).getMinutes()])).toEqual([["Письма", "9:30"], ["Купить подарок", "14:0"]]);
      expect(o.listNotes().find((n) => n.id === a.id)!.dueAt).toBe(iso(local(10, 12, 23, 59))); // только предложение
      const r = await o.arrangeDay("2026-10-12", true, [a.id]);
      expect(r.applied).toBe(1);
      expect(o.listNotes().find((n) => n.id === a.id)!.dueAt).toBe(iso(local(10, 12, 9, 30)));
      expect(o.listLog()[0]!.kind).toBe("arrange");
      await expect(o.arrangeDay("2026-10-11")).rejects.toMatchObject({ status: 409 });
    } finally { await done(); }
  });

  it("правила «если — то»: напомнить в субботу, отметить важным, проверка", async () => {
    const { o, set, done } = await setup(local(10, 14, 12)); // среда
    try {
      await o.setAutomation({ rules: [
        { id: "buy", match: "tag", value: "#покупки", action: "weekday", weekday: 6, time: "10:00" },
        { id: "imp", match: "word", value: "налог", action: "important" },
      ] });
      expect(o.getAutomation().rules[0]!.value).toBe("покупки");
      await o.addTask("Молоко #покупки");
      const t = await o.addTask("Заплатить налог");
      await o.tick();
      const r = o.listReminders().find((x) => x.rule === "buy")!;
      expect(Date.parse(r.at)).toBe(local(10, 17, 10));
      expect(o.listNotes().find((n) => n.id === t.id)!.priority).toBe("high");
      await o.tick();
      expect(o.listReminders().filter((x) => x.rule === "buy")).toHaveLength(1); // один раз
      // отмена правила «важное» возвращает как было
      const e = o.listLog().find((x) => x.text.includes("важным"))!;
      await o.undoLog(e.id);
      expect(o.listNotes().find((n) => n.id === t.id)!.priority).toBeUndefined();
      // дело сделано — напоминание правила не приходит
      await o.setDone(o.listNotes().find((n) => n.text.startsWith("Молоко"))!.id, true);
      set(local(10, 17, 10, 1));
      expect(await o.tick()).toEqual([]);
      await expect(o.setAutomation({ rules: [{ id: "x", match: "tag", value: "", action: "important" }] })).rejects.toMatchObject({ status: 400 });
    } finally { await done(); }
  });
});
