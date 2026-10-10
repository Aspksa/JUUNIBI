import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Organizer } from "./organizer";
import { Achievements, computeMetrics, dayKey, directionOf, plural } from "./achievements";
import { EFFECTS, METRICS, TIERS } from "./achievements-catalog";

const local = (m: number, d: number, h = 9, min = 0, y = 2026) => new Date(y, m - 1, d, h, min).getTime();
const iso = (ms: number) => new Date(ms).toISOString();

async function setup(start: number) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "juunibi-ach-"));
  let t = start;
  const o = new Organizer(path.join(dir, "o.json"), () => t);
  await o.load();
  await o.setAutomation({ brief: false, evening: false, weekly: false, rollOverdue: false, dueReminder: "off" });
  const source = () => ({ now: t, notes: o.listNotes(), reminders: o.listReminders(), missions: o.listMissions(), history: o.listHistory(), autoCount: o.autoCounts() });
  const a = new Achievements(path.join(dir, "a.json"), source, () => t);
  await a.load();
  return { o, a, dir, set: (ms: number) => { t = ms; }, source, done: () => rm(dir, { recursive: true, force: true }) };
}

describe("каталог достижений", () => {
  it("60 показателей в 10 группах по 6, без повторов; 12 уровней редкости и 24 разных эффекта", () => {
    expect(METRICS).toHaveLength(60);
    expect(new Set(METRICS.map((m) => m.id)).size).toBe(60);
    expect(METRICS.map((m) => m.n)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
    const groups = new Map<string, number>();
    for (const m of METRICS) groups.set(m.group, (groups.get(m.group) ?? 0) + 1);
    expect([...groups.values()]).toEqual(Array(10).fill(6));
    expect(TIERS).toHaveLength(12);
    expect(EFFECTS).toHaveLength(24);
    const used = TIERS.flatMap((t) => t.effects);
    expect(new Set(used).size).toBe(24);
    for (const e of used) expect(EFFECTS.some((x) => x.id === e)).toBe(true);
    for (const m of METRICS) { expect(m.tier).toBeGreaterThanOrEqual(0); expect(m.tier).toBeLessThan(12); expect(m.levels.length).toBeGreaterThan(0); }
  });
  it("направления и склонения", () => {
    expect(directionOf({ text: "Позвонить маме" })).toBe("people");
    expect(directionOf({ text: "Оплатить интернет" })).toBe("money");
    expect(directionOf({ text: "Пробежка 5 км" })).toBe("health");
    expect(directionOf({ text: "Что-то", repeat: "daily" })).toBe("discipline");
    expect(directionOf({ text: "Что-то" })).toBe("");
    expect([1, 2, 5, 11, 21, 22, 25].map((n) => plural(n, ["день", "дня", "дней"]))).toEqual(["день", "дня", "дней", "дней", "день", "дня", "дней"]);
  });
});

describe("показатели из настоящих дел", () => {
  it("пустой список: все 60 показателей есть, без ошибок, где нечего считать — «копим данные»", () => {
    const { metrics, tails } = computeMetrics({ now: local(10, 10, 12), notes: [], reminders: [], missions: [], history: [], autoCount: {}, recordsThisWeek: 0, awardsInBook: [] });
    expect(metrics).toHaveLength(60);
    expect(metrics.filter((m) => !m.ready).every((m) => m.detail.startsWith("Копим данные"))).toBe(true);
    expect(metrics.every((m) => !m.detail.startsWith("Копим данные: не удалось"))).toBe(true);
    expect(tails).toHaveLength(12);
  });

  it("история дел, рекорды, награды и машина времени", async () => {
    const { o, a, set, done } = await setup(local(9, 1, 9));
    try {
      // a month of to-dos: some on time, one waited long, one moved twice, a goal with steps
      const ids: string[] = [];
      for (let d = 1; d <= 20; d++) {
        set(local(9, d, 9));
        const n = await o.addTask(`Позвонить маме ${d}`, { dueAt: iso(local(9, d, 18)) });
        ids.push(n.id);
        set(local(9, d, 10 + (d % 3)));
        if (d % 5) await o.setDone(n.id, true);
      }
      set(local(9, 2, 9));
      const old = await o.addTask("Оплатить налог");
      await o.updateTask(old.id, { dueAt: iso(local(9, 5, 12)) });
      await o.updateTask(old.id, { dueAt: iso(local(9, 12, 12)) });
      const goal = await o.addMission("Ремонт кухни");
      const steps = [];
      for (const s of ["Выбрать плитку", "Купить плитку", "Положить плитку"]) steps.push(await o.addMissionStage(goal.id, s));
      set(local(9, 22, 8));
      for (const s of steps) await o.setDone(s.id, true);
      await o.updateMission(goal.id, "complete");
      set(local(9, 25, 7, 30));
      await o.setDone(old.id, true);
      const note = await o.addNote("note", "Идея: купить новый чайник");
      void note;
      await o.addTask("Купить чайник на кухню");
      const removed = await o.addTask("Ненужное дело");
      await o.removeNote(removed.id);

      expect(o.listHistory().filter((e) => e.kind === "move" && e.id === old.id)).toHaveLength(2);
      expect(o.listHistory().some((e) => e.kind === "remove" && e.text === "Ненужное дело")).toBe(true);

      const v = await a.refresh();
      const m = (id: string) => v.metrics.find((x) => x.id === id)!;
      expect(m("octopus").ready).toBe(true);
      expect(m("boomerang").value).toBe("1 раз"); // the first date is not a move
      expect(m("boomerang").detail).toContain("Оплатить налог");
      expect(m("hardfoe").value).toBe("3 этапа");
      expect(m("dropped").value).toBe("1");
      expect(m("bloom").value).toBe("1");
      expect(m("early").value).toBe("07:30");
      // goals name their threshold instead of a bare «N»
      const aw = (id: string) => v.awards.find((x) => x.id === id)!;
      expect(aw("early").goal).toBe("N дел до 8 утра (N = 1)");
      expect(aw("rare").goal).toMatch(aw("rare").level ? /^день продуктивнее обычного: ×\d/ : /^$/); // a secret one shows no goal
      expect(v.awards.filter((x) => /\bN\b/.test(x.goal) && !x.goal.includes("(N = "))).toEqual([]);
      expect(m("firstpage").detail).toContain("Позвонить маме 1");
      expect(m("twelve").value).toMatch(/из 12/);
      // the first look grants quietly and leaves one celebration
      expect(v.stats.won).toBeGreaterThan(5);
      expect(v.pending).toHaveLength(1);
      expect(v.notices[0]!.text).toMatch(/нашла \d+ наград/);
      expect(v.awards.find((x) => x.id === "firstpage")!.level).toBe(1);
      expect(v.awards.find((x) => x.id === "legend")!.title).toBe("???"); // hidden until won
      expect(v.records.length).toBeGreaterThan(0);

      // later: a record is beaten and an award grows — JUUNIBI notices both
      set(local(9, 26, 9));
      for (let i = 0; i < 8; i++) { const n = await o.addTask("Разобрать почту " + i); await o.setDone(n.id, true); }
      const v2 = await a.refresh();
      expect(v2.notices.some((n) => n.kind === "record" && n.text.includes("Многорукий мастер"))).toBe(true);
      expect(v2.notices.some((n) => n.kind === "award")).toBe(true);
      const oct = v2.records.find((r) => r.id === "octopus")!;
      expect(oct.history.length).toBeGreaterThanOrEqual(2);
      expect(oct.best.value).toBe(8);

      // the patience record: «вы завершили задачу, которую откладывали N дней»
      set(local(10, 25, 9)); // 30 days, longer than «Оплатить налог» (23)
      const lazy = o.listNotes().find((n) => n.text === "Купить чайник на кухню")!;
      await o.setDone(lazy.id, true);
      const v3 = await a.refresh();
      expect(v3.notices.some((n) => /откладывали 30 дней/.test(n.text))).toBe(true);

      const shown = (await a.refresh()).pending.map((x) => x!.award);
      expect(shown.length).toBeGreaterThan(0);
      await a.seen(shown);
      expect((await a.refresh()).pending.filter((x) => shown.includes(x!.award))).toHaveLength(0);

      // the time machine
      const day = a.day("2026-09-25");
      expect(day.counts.done).toBeGreaterThanOrEqual(1);
      expect(day.story).toContain("Завершено");
      expect(day.lines.some((l) => l.kind === "remove")).toBe(true);
      expect(a.day("2026-08-01").story).toMatch(/тихо/);
      expect(() => a.day("вчера")).toThrow();
    } finally { await done(); }
  });

  it("награды переживают перезапуск и обновление; титул выбирается только полученный", async () => {
    const { o, a, dir, set, source, done } = await setup(local(9, 1, 9));
    try {
      const n = await o.addTask("Первое дело");
      set(local(9, 1, 10));
      await o.setDone(n.id, true);
      await a.refresh();
      const again = new Achievements(path.join(dir, "a.json"), source, () => local(9, 1, 11));
      await again.load();
      const v = await again.refresh();
      expect(v.awards.find((x) => x.id === "firstpage")!.level).toBe(1);
      await expect(again.setTitle("dragons")).rejects.toThrow(/не получен/);
      const raw = JSON.parse(await readFile(path.join(dir, "a.json"), "utf8"));
      expect(raw.awards.firstpage.level).toBe(1);
    } finally { await done(); }
  });

  it("при пределе записей уходят старые выполненные дела, а повторяющееся дело не перестаёт повторяться", async () => {
    const { o, set, done } = await setup(local(9, 1, 9));
    try {
      for (let i = 0; i < 499; i++) { const n = await o.addNote("todo", "Дело " + i); if (i < 300) await o.setDone(n.id, true); }
      const r = await o.addTask("Зарядка", { dueAt: iso(local(9, 1, 20)), repeat: "daily" });
      expect(o.listNotes()).toHaveLength(500);
      set(local(9, 1, 12));
      await o.setDone(r.id, true);
      expect(o.listNotes().filter((n) => n.text === "Зарядка" && !n.done)).toHaveLength(1);
      expect(o.listNotes().some((n) => n.text === "Дело 0")).toBe(false);
      await o.addNote("note", "ещё одна");
      expect(o.listNotes()).toHaveLength(500);
      expect(dayKey(local(9, 1, 23, 59))).toBe("2026-09-01");
    } finally { await done(); }
  });
});
