import { describe, expect, it } from "vitest";
import type { AchAward, AchNotice, AchPending } from "../src/api";
import { effectFor, filterAwards, freshNotices, galleryAwards, medalPips, nextCelebration, quickDays, safeHex, wrapText } from "../src/pages/achievements-model";
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
