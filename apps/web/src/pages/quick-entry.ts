/**
 * Quick entry for the "Дела" page: one line of Russian ("завтра в 10 позвонить маме", "каждый пн в 9 планёрка #работа !")
 * becomes a to-do, a reminder or a note with its date, time, repeat, importance and project. Pure and local: no model.
 */
import type { Repeat } from "../api";

export type QuickKind = "auto" | "todo" | "reminder" | "note";
export interface QuickParsed {
  kind: "todo" | "reminder" | "note";
  text: string;
  /** Local date and time as ISO; for a date without a time see `dateOnly`. */
  at?: string;
  dateOnly?: boolean;
  repeat?: Repeat;
  priority?: "high";
  project?: string;
}

const MONTHS = ["январ", "феврал", "март", "апрел", "ма", "июн", "июл", "август", "сентябр", "октябр", "ноябр", "декабр"];
const MONTH_RE = "(январ[яь]|феврал[яь]|марта?|апрел[яь]|ма[яй]|июн[яь]|июл[яь]|августа?|сентябр[яь]|октябр[яь]|ноябр[яь]|декабр[яь])";
/** Weekday stems, Monday first; index + 1 = getDay() except Sunday (0). */
const WEEKDAYS: [RegExp, number][] = [
  [/^(понедельник\S*|пн)$/, 1], [/^(вторник\S*|вт)$/, 2], [/^(сред[уаы]|ср)$/, 3], [/^(четверг\S*|чт)$/, 4],
  [/^(пятниц[уаы]|пт)$/, 5], [/^(суббот[уаы]|сб)$/, 6], [/^(воскресень[ея]|вс)$/, 0],
];
const WD = "(понедельник|вторник|сред[уаы]|четверг|пятниц[уаы]|суббот[уаы]|воскресенье|пн|вт|ср|чт|пт|сб|вс)";
const B = "(?<![\\p{L}\\p{N}])"; // word start (\b does not know Cyrillic)
const E = "(?![\\p{L}\\p{N}])"; // word end
const NUM_WORDS: Record<string, number> = { "один": 1, "одну": 1, "два": 2, "две": 2, "три": 3, "четыре": 4, "пять": 5, "пару": 2, "десять": 10, "пятнадцать": 15, "двадцать": 20, "тридцать": 30, "сорок": 40 };
const weekday = (w: string) => WEEKDAYS.find(([re]) => re.test(w.toLowerCase()))?.[1];

/** Takes the first match of `re` out of the text and returns its groups. */
function take(state: { s: string }, re: RegExp): RegExpExecArray | null {
  const m = re.exec(state.s);
  if (m) state.s = (state.s.slice(0, m.index) + " " + state.s.slice(m.index + m[0].length)).replace(/\s{2,}/g, " ");
  return m;
}

export function parseQuick(input: string, now = new Date(), forced: QuickKind = "auto"): QuickParsed {
  const raw = input.trim();
  const st = { s: " " + raw + " " };
  const R = (src: string) => new RegExp(src, "iu");

  const note = take(st, R(`^\\s*(заметка|note)\\s*[:：—–-]\\s*`));
  if (forced === "note" || (forced === "auto" && note)) return { kind: "note", text: st.s.trim() || raw };

  const out: Omit<QuickParsed, "kind" | "text"> = {};
  if (take(st, R(`${B}(важно|срочно)${E}[!,.]?`)) || take(st, R(`(^|\\s)!{1,3}(?=\\s|$)`))) out.priority = "high";
  const proj = take(st, R(`(^|\\s)#([\\p{L}\\p{N}_-]{1,40})`));
  if (proj) out.project = proj[2]!;
  const remind = !!take(st, R(`^\\s*(напомни(ть)?|напоминание)(\\s+мне)?[:,]?\\s*`));

  // ---- repeat
  let repeatWeekday: number | undefined;
  if (take(st, R(`${B}(каждый\\s+день|ежедневно)${E}`))) out.repeat = "daily";
  else if (take(st, R(`${B}(по\\s+будням|каждый\\s+будний\\s+день|в\\s+будни)${E}`))) out.repeat = "weekdays";
  else if (take(st, R(`${B}(каждую\\s+неделю|еженедельно)${E}`))) out.repeat = "weekly";
  else if (take(st, R(`${B}(каждый\\s+месяц|ежемесячно)${E}`))) out.repeat = "monthly";
  else if (take(st, R(`${B}каждые\\s+(3|три)\\s+дня${E}`))) out.repeat = "every3days";
  else {
    const m = take(st, R(`${B}(кажд(ый|ую|ое))\\s+${WD}${E}`));
    if (m) { out.repeat = "weekly"; repeatWeekday = weekday(m[3]!); }
  }

  // ---- date
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let date: Date | null = null;
  let exact: Date | null = null; // "через 15 минут": a moment, not a day
  let m: RegExpExecArray | null;
  if ((m = take(st, R(`${B}через\\s+(\\d{1,3}|${Object.keys(NUM_WORDS).join("|")})?\\s*(минут[уы]?|мин|час(а|ов)?|дн(я|ей)|день|недел[июь])${E}`)))) {
    const n = m[1] ? Number(m[1]) || NUM_WORDS[m[1].toLowerCase()]! : 1;
    const unit = m[2]!.toLowerCase();
    if (unit.startsWith("мин")) exact = new Date(now.getTime() + n * 60_000);
    else if (unit.startsWith("час")) exact = new Date(now.getTime() + n * 3_600_000);
    else if (unit.startsWith("нед")) date = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 7 * n);
    else date = new Date(day.getFullYear(), day.getMonth(), day.getDate() + n);
  } else if (take(st, R(`${B}через\\s+полчаса${E}`))) exact = new Date(now.getTime() + 30 * 60_000);
  if (!exact && !date) {
    if (take(st, R(`${B}послезавтра${E}`))) date = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 2);
    else if (take(st, R(`${B}завтра${E}`))) date = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    else if (take(st, R(`${B}сегодня${E}`))) date = new Date(day);
    else if ((m = take(st, R(`${B}(\\d{1,2})\\s+${MONTH_RE}${E}`)))) {
      const mon = MONTHS.findIndex((x) => m![2]!.toLowerCase().startsWith(x));
      date = new Date(day.getFullYear(), mon, Number(m[1]));
      if (date < day) date.setFullYear(date.getFullYear() + 1);
    } else if ((m = take(st, R(`${B}(\\d{1,2})\\.(\\d{1,2})(?:\\.(\\d{2,4}))?${E}(?!\\s*(утра|вечера|дня|ч))`)))) {
      const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : day.getFullYear();
      date = new Date(y, Number(m[2]) - 1, Number(m[1]));
      if (!m[3] && date < day) date.setFullYear(date.getFullYear() + 1);
    } else if ((m = take(st, R(`${B}(в|во)\\s+${WD}${E}`)))) {
      const wd = weekday(m[2]!)!;
      date = new Date(day);
      do date.setDate(date.getDate() + 1); while (date.getDay() !== wd);
    }
  }
  if (date && Number.isNaN(date.getTime())) date = null;

  // ---- time
  let hh: number | null = null, mm = 0;
  if ((m = take(st, R(`${B}(в|к)\\s+(\\d{1,2})(?:[:.](\\d{2}))?\\s*(утра|дня|вечера|ночи|ч|час(а|ов)?)?${E}`))) || (m = take(st, R(`${B}()(\\d{1,2})[:](\\d{2})${E}`)))) {
    hh = Number(m[2]); mm = m[3] ? Number(m[3]) : 0;
    const part = (m[4] ?? "").toLowerCase();
    if ((part === "вечера" || part === "дня") && hh < 12) hh += 12;
    if (part === "ночи" && hh === 12) hh = 0;
    if (hh > 23 || mm > 59) { hh = null; mm = 0; }
  } else if (take(st, R(`${B}в\\s+полдень${E}`))) hh = 12;
  else if (take(st, R(`${B}утром${E}`))) hh = 9;
  else if (take(st, R(`${B}(днём|днем)${E}`))) hh = 13;
  else if (take(st, R(`${B}вечером${E}`))) hh = 19;

  // ---- put it together
  let at: Date | null = exact;
  let dateOnly = false;
  if (!at && repeatWeekday !== undefined) {
    const d = new Date(day); d.setHours(hh ?? 9, mm, 0, 0);
    while (d.getDay() !== repeatWeekday || d <= now) d.setDate(d.getDate() + 1);
    at = d;
  } else if (!at && hh !== null) {
    const d = new Date(date ?? day); d.setHours(hh, mm, 0, 0);
    if (!date && d <= now) d.setDate(d.getDate() + 1); // "в 9" when 9:00 has passed means tomorrow
    at = d;
  } else if (!at && out.repeat) {
    const d = new Date(date ?? day); d.setHours(9, 0, 0, 0);
    if (d <= now) d.setDate(d.getDate() + 1);
    at = d;
  } else if (!at && date) { at = new Date(date); at.setHours(9, 0, 0, 0); dateOnly = true; }

  const text = st.s.replace(/\s+/g, " ").replace(/^[\s,.:;—–-]+|[\s,.:;—–-]+$/g, "").trim();
  const kind: QuickParsed["kind"] = forced === "todo" ? "todo" : forced === "reminder" ? "reminder"
    : remind || out.repeat || (at && !dateOnly) ? "reminder" : "todo";
  const res: QuickParsed = { kind, text: text || raw, ...out };
  if (kind !== "todo") { delete res.priority; delete res.project; } // reminders have neither
  if (at) res.at = at.toISOString();
  if (dateOnly) res.dateOnly = true;
  if (kind === "todo") delete res.repeat;
  return res;
}

/** The due moment stored for a to-do with a date but no time: the end of that day, so it is not "overdue" during it. */
export function endOfDay(iso: string): string {
  const d = new Date(iso); d.setHours(23, 59, 0, 0);
  return d.toISOString();
}
