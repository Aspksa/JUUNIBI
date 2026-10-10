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
