import { describe, expect, it } from "vitest";
import { nextHoliday, nextLongRest, prodDay, prodStats } from "../src/prod-calendar";

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

describe("next holiday and long rest", () => {
  it("finds the November holiday from October", () => {
    expect(nextHoliday("2026-10-11")).toEqual({ key: "2026-11-04", note: "День народного единства", days: 24 });
  });
  it("finds the New Year run, three days or longer", () => {
    // 2026-11-04 is a Wednesday, so the next run of 3+ days off is the New Year one starting 31 Dec 2026
    const r = nextLongRest("2026-10-11")!;
    expect(r.from).toBe("2026-12-31");
    expect(r.length).toBeGreaterThanOrEqual(10);
  });
  it("is undefined past the years with data", () => {
    expect(nextHoliday("2027-12-20")).toBeUndefined();
  });
});
