/**
 * Russian production calendar (производственный календарь) for the "Дела" calendar: holidays, transferred days off,
 * working weekends and shortened pre-holiday days, for a five-day week.
 * Sources: Labour Code art. 112; Government decrees No. 1466 of 24.09.2025 (2026) and No. 1187 of 17.09.2026 (2027).
 * A new year needs a new entry in YEARS once its decree is published.
 */
export type DayKind = "work" | "short" | "weekend" | "holiday" | "off";
export interface ProdDay { kind: DayKind; /** Why the day is special, for the tooltip and the selected-day panel. */ note?: string }

const NEW_YEAR = "Новогодние каникулы";
const HOLIDAYS: Record<string, string> = {
  "01-01": NEW_YEAR, "01-02": NEW_YEAR, "01-03": NEW_YEAR, "01-04": NEW_YEAR, "01-05": NEW_YEAR, "01-06": NEW_YEAR,
  "01-07": "Рождество Христово", "01-08": NEW_YEAR,
  "02-23": "День защитника Отечества", "03-08": "Международный женский день", "05-01": "Праздник Весны и Труда",
  "05-09": "День Победы", "06-12": "День России", "11-04": "День народного единства",
};
interface YearRules {
  /** Extra days off: a holiday that fell on a weekend, or a transferred day off. */
  off: Record<string, string>;
  /** Weekend days that are working days. */
  work: string[];
  /** Shortened pre-holiday working days (one hour less). */
  short: string[];
}
export const YEARS: Record<number, YearRules> = {
  2026: {
    off: { "01-09": "Перенос выходного с 3 января", "03-09": "Перенос с 8 марта", "05-11": "Перенос с 9 мая", "12-31": "Перенос выходного с 4 января" },
    work: [],
    short: ["04-30", "05-08", "06-11", "11-03"],
  },
  2027: {
    off: { "02-22": "Перенос выходного с 20 февраля", "05-03": "Перенос с 1 мая", "05-10": "Перенос с 9 мая", "06-14": "Перенос с 12 июня", "11-05": "Перенос выходного со 2 января", "12-31": "Перенос выходного с 3 января" },
    work: ["02-20"],
    short: ["02-20", "04-30", "06-11", "11-03"],
  },
};

export const hasProdCalendar = (year: number): boolean => year in YEARS;

/** What kind of day a local date (YYYY-MM-DD) is; undefined for a year without data. */
export function prodDay(key: string): ProdDay | undefined {
  const year = Number(key.slice(0, 4));
  const rules = YEARS[year];
  if (!rules) return undefined;
  const md = key.slice(5, 10);
  if (HOLIDAYS[md]) return { kind: "holiday", note: HOLIDAYS[md] };
  if (rules.off[md]) return { kind: "off", note: rules.off[md] };
  const dow = new Date(year, Number(md.slice(0, 2)) - 1, Number(md.slice(3))).getDay();
  const working = rules.work.includes(md);
  if ((dow === 0 || dow === 6) && !working) return { kind: "weekend" };
  if (rules.short.includes(md)) return { kind: "short", note: working ? "Рабочая суббота, сокращённый день" : "Предпраздничный день, на час короче" };
  return working ? { kind: "work", note: "Рабочая суббота" } : { kind: "work" };
}

export interface ProdStats { workDays: number; offDays: number; shortDays: number; /** Hours for a 40-, 36- and 24-hour week. */ hours: { 40: number; 36: number; 24: number } }

/** Working days and hour norms for a month ("YYYY-MM") or a year ("YYYY"); undefined without data. */
export function prodStats(period: string): ProdStats | undefined {
  const year = Number(period.slice(0, 4));
  if (!hasProdCalendar(year)) return undefined;
  const months = period.length > 4 ? [Number(period.slice(5, 7))] : Array.from({ length: 12 }, (_, i) => i + 1);
  let workDays = 0, offDays = 0, shortDays = 0;
  for (const m of months) {
    for (let d = 1; d <= new Date(year, m, 0).getDate(); d++) {
      const k = prodDay(`${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`)!.kind;
      if (k === "work" || k === "short") workDays++; else offDays++;
      if (k === "short") shortDays++;
    }
  }
  const norm = (week: number) => Math.round((workDays * week / 5 - shortDays) * 100) / 100;
  return { workDays, offDays, shortDays, hours: { 40: norm(40), 36: norm(36), 24: norm(24) } };
}

/** A working day by the production calendar; for a year without data, Monday to Friday. */
export function isWorkday(d: Date): boolean {
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const p = prodDay(key);
  if (p) return p.kind === "work" || p.kind === "short";
  return d.getDay() !== 0 && d.getDay() !== 6;
}
/** The first working day on or after `d` (same time of day). */
export function nextWorkday(d: Date): Date {
  const x = new Date(d);
  for (let i = 0; i < 30 && !isWorkday(x); i++) x.setDate(x.getDate() + 1);
  return x;
}
