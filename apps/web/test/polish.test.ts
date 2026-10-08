import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ACCENTS } from "../src/accents";
import { contrast } from "../src/contrast";
import { dayLabel, previewOf, relTime, sameDay } from "../src/chat/helpers";

const now = new Date(2026, 9, 8, 15, 0, 0);
const at = (days: number, h = 12, min = 0) => new Date(2026, 9, 8 - days, h, min).getTime();

describe("relTime", () => {
  it("is compact and Russian", () => {
    expect(relTime(now.getTime() - 20_000, now)).toBe("сейчас");
    expect(relTime(now.getTime() - 5 * 60_000, now)).toBe("5 мин");
    expect(relTime(now.getTime() - 3 * 3_600_000, now)).toBe("3 ч");
    expect(relTime(at(1, 20), now)).toBe("вчера");
    expect(relTime(at(3), now)).toMatch(/^[а-я]{2}$/);
    expect(relTime(at(20), now)).toMatch(/^\d{1,2} [а-я]+$/);
  });
});
describe("dayLabel / sameDay", () => {
  it("labels today, yesterday and older days; adds the year only when it differs", () => {
    expect(dayLabel(at(0, 9), now)).toBe("Сегодня");
    expect(dayLabel(at(1), now)).toBe("Вчера");
    expect(dayLabel(at(10), now)).toBe("28 сентября");
    expect(dayLabel(new Date(2025, 11, 31).getTime(), now)).toBe("31 декабря 2025 г.");
  });
  it("sameDay compares calendar days, not 24h windows", () => {
    expect(sameDay(at(0, 0, 1), at(0, 23, 59))).toBe(true);
    expect(sameDay(at(1, 23, 59), at(0, 0, 1))).toBe(false);
  });
});
describe("previewOf", () => {
  it("skips notes, strips markdown, prefixes your own messages", () => {
    expect(previewOf([{ role: "user", content: "Привет" }, { role: "note", content: "Запомнено" }])).toBe("Вы: Привет");
    expect(previewOf([{ role: "user", content: "q" }, { role: "assistant", content: "## Ответ\n\nЭто **важно**" }])).toBe("Ответ Это важно");
    expect(previewOf([])).toBe("");
    expect(previewOf([{ role: "assistant", content: "а".repeat(500) }]).length).toBe(80);
  });
});

describe("accent presets keep WCAG contrast", () => {
  for (const a of ACCENTS) {
    for (const [name, v, bg] of [["light", a.light, "#ffffff"], ["dark", a.dark, "#212121"]] as const) {
      it(`${a.id}/${name}: accent on page >= 3:1 (rings, focus), text on accent >= 4.5:1`, () => {
        expect(contrast(v.brand, bg), "accent vs background").toBeGreaterThanOrEqual(3);
        expect(contrast(v.fg, v.brand), "text on accent").toBeGreaterThanOrEqual(4.5);
      });
    }
  }
  it("the gold preset mirrors the stylesheet defaults", () => {
    const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
    const gold = ACCENTS.find((a) => a.id === "gold")!;
    const brands = [...css.matchAll(/--brand:(#[0-9a-fA-F]{6})/g)].map((m) => m[1]!.toLowerCase());
    expect(brands).toContain(gold.light.brand);
    expect(brands).toContain(gold.dark.brand);
  });
});
