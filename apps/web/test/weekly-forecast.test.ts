import { describe, expect, it } from "vitest";
import { forecastWeek, simulateWeek } from "../src/pages/weekly-forecast";
import type { Note } from "../src/api";
const task = (id: string, date: string, minutes?: number, done = false): Note => ({
  id, kind: "todo", text: id, createdAt: "2026-10-01T12:00:00.000Z",
  dueAt: date + "T12:00:00", done, ...(minutes === undefined ? {} : { estimateMinutes: minutes }),
});
describe("seven-day productivity forecast", () => {
  it("counts outstanding tasks, defaults to 30 minutes, ignores completed", () => {
    const f = forecastWeek([task("a","2026-10-12",470),task("b","2026-10-12"),task("c","2026-10-12",900,true)],new Date(2026,9,12));
    expect(f).toHaveLength(7);
    expect(f[0]).toMatchObject({ day:"2026-10-12", planned:500, count:2, excess:20, overload:true });
    expect(f[1]?.planned).toBe(0);
  });
  it("handles month transition and weekend without dividing by zero", () => {
    const f = forecastWeek([task("sat","2026-10-31",60),task("nov","2026-11-01",10)],new Date(2026,9,30));
    expect(f.map(x=>x.day)).toContain("2026-11-01");
    expect(f[1]).toMatchObject({capacity:0,excess:60,overload:true});
    expect(f[2]).toMatchObject({capacity:0,excess:10,overload:true});
  });
  it("does not mutate input", () => {
    const n=[task("x","2026-10-12",60)];forecastWeek(n,new Date(2026,9,12));expect(n[0]?.estimateMinutes).toBe(60);
  });
});

describe("hypothetical future scenarios", () => {
  it("adds only to workdays and leaves baseline unchanged", () => {
    const base = forecastWeek([], new Date(2026,9,12));
    const hypothetical = simulateWeek(base, 60);
    expect(hypothetical.extra).toBe(300);
    expect(hypothetical.projected).toBe(300);
    expect(hypothetical.overloadedDays).toBe(0);
    expect(base.every(d=>d.planned===0)).toBe(true);
  });
  it("reports overload without mutating source data", () => {
    const base = forecastWeek([task("huge","2026-10-12",470)],new Date(2026,9,12));
    const h=simulateWeek(base,60);
    expect(h.days[0]).toMatchObject({planned:530,overload:true,excess:50});
    expect(base[0]?.planned).toBe(470);
    expect(simulateWeek(base,Number.NaN).extra).toBe(0);
  });
});
