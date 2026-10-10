/** Conservative, explainable seven-day load forecast based on real outstanding tasks. */
import type { Note } from "../api";
export interface ForecastDay { day: string; planned: number; capacity: number; count: number; overload: boolean; excess: number }
export function forecastWeek(notes: Note[], start: Date, dailyCapacityMinutes = 480): ForecastDay[] {
  const day0 = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 12);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(day0); d.setDate(day0.getDate() + i);
    const day = [d.getFullYear(), String(d.getMonth()+1).padStart(2,"0"), String(d.getDate()).padStart(2,"0")].join("-");
    const pending = notes.filter(n => n.kind === "todo" && !n.done && !!n.dueAt && !Number.isNaN(Date.parse(n.dueAt)) &&
      (new Date(n.dueAt).getFullYear() + "-" + String(new Date(n.dueAt).getMonth()+1).padStart(2,"0") + "-" + String(new Date(n.dueAt).getDate()).padStart(2,"0")) === day);
    const planned = pending.reduce((total,n) => total + (Number.isFinite(n.estimateMinutes) && n.estimateMinutes! > 0 ? Math.min(1440,n.estimateMinutes!) : 30), 0);
    const capacity = d.getDay() === 0 || d.getDay() === 6 ? 0 : Math.max(0, dailyCapacityMinutes);
    return { day, planned, capacity, count: pending.length, overload: planned > capacity, excess: Math.max(0, planned-capacity) };
  });
}

/** Hypothetical scenario, never writes to the planner. A positive delta adds new work every weekday. */
export function simulateWeek(days: readonly ForecastDay[], addedMinutesPerWorkday: number): { baseline: number; projected: number; extra: number; overloadedDays: number; days: ForecastDay[] } {
  const delta = Number.isFinite(addedMinutesPerWorkday) ? Math.max(0, Math.min(1440, Math.round(addedMinutesPerWorkday))) : 0;
  const projected = days.map(d => {
    const planned = d.planned + (d.capacity > 0 ? delta : 0);
    return { ...d, planned, overload: planned > d.capacity, excess: Math.max(0, planned - d.capacity) };
  });
  return { baseline: days.reduce((n,d)=>n+d.planned,0), projected: projected.reduce((n,d)=>n+d.planned,0), extra: projected.reduce((n,d)=>n+d.planned,0)-days.reduce((n,d)=>n+d.planned,0), overloadedDays: projected.filter(d=>d.overload).length, days: projected };
}
