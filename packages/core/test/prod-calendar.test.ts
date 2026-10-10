import { describe, expect, it } from "vitest";
import { prodDay, prodStats } from "../src/prod-calendar";

// Working days per month and the year's norms as published by КонсультантПлюс
const OFFICIAL: Record<number, number[]> = {
  2026: [15, 19, 21, 22, 19, 21, 23, 21, 22, 22, 20, 22],
  2027: [15, 19, 22, 22, 19, 21, 22, 22, 22, 21, 20, 22],
};

describe("производственный календарь", () => {
  for (const [year, months] of Object.entries(OFFICIAL)) {
    it(`${year}: рабочие дни по месяцам и нормы часов`, () => {
      expect(months.map((_, i) => prodStats(`${year}-${String(i + 1).padStart(2, "0")}`)!.workDays)).toEqual(months);
      expect(prodStats(year)).toEqual({ workDays: 247, offDays: 118, shortDays: 4, hours: { 40: 1972, 36: 1774.4, 24: 1181.6 } });
    });
  }
  it("знает праздники, переносы, рабочие субботы и короткие дни", () => {
    expect(prodDay("2026-01-07")).toEqual({ kind: "holiday", note: "Рождество Христово" });
    expect(prodDay("2026-01-09")?.kind).toBe("off");
    expect(prodDay("2026-03-09")?.kind).toBe("off");
    expect(prodDay("2026-05-08")?.kind).toBe("short");
    expect(prodDay("2026-10-10")?.kind).toBe("weekend");
    expect(prodDay("2026-10-12")?.kind).toBe("work");
    expect(prodDay("2027-02-20")?.kind).toBe("short");
    expect(prodDay("2027-11-05")?.kind).toBe("off");
    expect(prodDay("2025-12-31")).toBeUndefined();
  });
});
