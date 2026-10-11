import { describe, expect, it } from "vitest";
import type { AchAward, AchNotice, AchPending } from "../src/api";
import { FOX_PATH, effectFor, filterAwards, foxPath, freshCount, freshNotices, galleryAwards, medalPips, needText, nextCelebration, nextSteps, quickDays, safeHex, sameData, wrapText } from "../src/pages/achievements-model";
import { tailAngle } from "../src/pages/tails";

const award = (o: Partial<AchAward>): AchAward => ({ id: "a", n: 1, emoji: "⭐", title: "A", tier: 0, group: "g", metric: "m", goal: "", nextGoal: null, levels: 4, hidden: false, riddle: null,
  repeat: null, level: 0, firstAt: null, lastAt: null, history: [], periods: 0, progress: 0, next: null, ...o } as AchAward);

describe("«Дела и достижения» в интерфейсе", () => {
  it("в стиль попадает только цвет вида #rrggbb", () => {
    expect(safeHex("#AABBCC")).toBe("#AABBCC");
    expect(safeHex("red;background:url(x)")).toBe("#e0a43a");
    expect(safeHex(undefined, "#000000")).toBe("#000000");
  });

  it("праздник — для самой редкой награды, остальные считаются", () => {
    expect(nextCelebration([])).toBeNull();
    const p = (award: string, tier: number, level: number, at = "2026-10-10T10:00:00Z") => ({ award, tier, level, at } as AchPending);
    const r = nextCelebration([p("a", 2, 1), p("b", 7, 1), p("c", 7, 3)]);
    expect(r?.first.award).toBe("c");
    expect(r?.more).toBe(2);
  });

  it("новая награда играет первый эффект уровня, улучшенная медаль — второй", () => {
    const tier = { effects: ["paws", "confetti"] as [string, string] };
    expect(effectFor(tier, 1)).toBe("paws");
    expect(effectFor(tier, 3)).toBe("confetti");
    expect(effectFor(undefined, 1)).toBe("confetti");
  });

  it("свежие заметки — только новее просмотренной, новые сверху", () => {
    const n = (at: string) => ({ at, emoji: "🦊", text: at, kind: "notice" } as AchNotice);
    const all = [n("2026-10-01"), n("2026-10-03"), n("2026-10-02")];
    expect(freshNotices(all, "2026-10-01").map((x) => x.at)).toEqual(["2026-10-03", "2026-10-02"]);
    expect(freshNotices(all, null)).toHaveLength(3);
  });

  it("книга: фильтры и порядок — полученные по дате, потом по прогрессу", () => {
    const xs = [award({ id: "x", level: 0, progress: 0.2, tier: 1 }), award({ id: "y", level: 2, firstAt: "2026-10-01", tier: 3 }), award({ id: "z", level: 1, firstAt: "2026-10-05", tier: 3, group: "h" }), award({ id: "w", level: 0, progress: 0.9, tier: 1 })];
    expect(filterAwards(xs, { tier: null, state: "all", group: null }).map((a) => a.id)).toEqual(["z", "y", "w", "x"]);
    expect(filterAwards(xs, { tier: 3, state: "all", group: null }).map((a) => a.id)).toEqual(["z", "y"]);
    expect(filterAwards(xs, { tier: null, state: "locked", group: null }).map((a) => a.id)).toEqual(["w", "x"]);
    expect(filterAwards(xs, { tier: null, state: "won", group: "h" }).map((a) => a.id)).toEqual(["z"]);
  });

  it("медали, быстрые дни, перенос текста и галерея", () => {
    expect(medalPips({ levels: 4, level: 2 })).toEqual(["on", "on", "off", "off"]);
    expect(medalPips({ levels: 0, level: 0 })).toEqual(["off"]);
    expect(quickDays(new Date(2026, 2, 31, 12)).map((d) => d.day)).toEqual(["2026-03-30", "2026-03-24", "2026-03-03", "2025-03-31"]);
    const lines = wrapText("раз два три четыре пять шесть семь восемь девять десять", 10, 2);
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.length <= 11)).toBe(true);
    expect(lines[1]!.endsWith("…")).toBe(true);
    expect(wrapText("коротко", 20)).toEqual(["коротко"]);
    const g = galleryAwards({ awards: [award({ id: "a", tier: 3, level: 1 }), award({ id: "b", tier: 6, level: 1 }), award({ id: "c", tier: 9, level: 0 }), award({ id: "d", tier: 4, level: 2 })] });
    expect(g.map((a) => a.id)).toEqual(["b", "d"]);
  });

  it("двенадцать хвостов — веер от −78° до +78°", () => {
    expect(tailAngle(0)).toBe(-78);
    expect(tailAngle(11)).toBe(78);
    expect(tailAngle(0, 1)).toBe(-78);
  });
});

describe("коллекция: туман, шаги, путь и новинки", () => {
  it("«Копим данные: …» становится предложением", () => {
    expect(needText("Копим данные: нужны выполненные дела")).toBe("Нужны выполненные дела");
    expect(needText("Копим данные: добавьте цель")).toBe("Добавьте цель");
  });
  it("следующие шаги: самые полезные действия первыми", () => {
    const w = (detail: string, title = "x") => ({ ready: false, detail: "Копим данные: " + detail, title });
    const s = nextSteps([w("поставьте цель"), w("добавьте цель или #проект"), w("нужны дела со сроком"), w("нужны выполненные дела"), { ready: true, detail: "", title: "y" }]);
    expect(s[0]).toMatchObject({ key: "goal", count: 2 });
    expect(s.map((x) => x.key)).toEqual(["goal", "due", "done"]);
  });
  it("путь кицунэ: двенадцать ступеней", () => {
    expect(FOX_PATH).toHaveLength(12);
    expect(foxPath(0)).toMatchObject({ index: 0, progress: 0 });
    expect(foxPath(5).index).toBe(1);
    expect(foxPath(1000)).toMatchObject({ index: 11, next: null, progress: 1 });
  });
  it("новое на вкладке считается только после первого визита", () => {
    const d = { awards: [{ level: 1, tier: 5, lastAt: "2026-10-11T10:00:00Z" }, { level: 0, tier: 5, lastAt: null }], records: [], titles: [], notices: [] } as never;
    expect(freshCount(d, "book", null)).toBe(0);
    expect(freshCount(d, "book", "2026-10-10T00:00:00Z")).toBe(1);
    expect(freshCount(d, "gallery", "2026-10-12T00:00:00Z")).toBe(0);
  });
  it("одинаковые данные не перерисовываются", () => {
    const a = { generatedAt: "1", stats: { won: 1 } } as never, b = { generatedAt: "2", stats: { won: 1 } } as never, c = { generatedAt: "3", stats: { won: 2 } } as never;
    expect(sameData(a, b)).toBe(true);
    expect(sameData(a, c)).toBe(false);
    expect(sameData(null, a)).toBe(false);
  });
});
