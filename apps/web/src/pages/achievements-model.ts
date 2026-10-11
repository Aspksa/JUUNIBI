/** Pure parts of «Дела и достижения» on the web (tested in test/achievements-model.test.ts). */
import type { AchAward, AchievementsData, AchNotice, AchPending } from "../api";

/** Only plain hex colours from the server reach a style attribute. */
export const safeHex = (c: string | undefined, fallback = "#e0a43a"): string => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : fallback);

/** The celebration to show for what was won since the last look: the rarest (then the highest medal), and how many more. */
export function nextCelebration(pending: AchPending[]): { first: AchPending; more: number } | null {
  if (!pending.length) return null;
  const first = [...pending].sort((a, b) => b.tier - a.tier || b.level - a.level || b.at.localeCompare(a.at))[0]!;
  return { first, more: pending.length - 1 };
}
/** Which of the tier's two effects plays: the first for a new award, the second for an upgraded medal. */
export const effectFor = (tier: { effects: [string, string] } | undefined, level: number): string => (tier ? tier.effects[level > 1 ? 1 : 0] : "confetti");

/** Notices newer than the one last seen (by time), newest first. */
export function freshNotices(notices: AchNotice[], seenAt: string | null): AchNotice[] {
  return notices.filter((n) => !seenAt || n.at > seenAt).sort((a, b) => b.at.localeCompare(a.at));
}

export type AwardFilter = { tier: number | null; state: "all" | "won" | "locked"; group: string | null };
/** The collection book's cards for a filter: won first by date (newest first), then the rest by progress. */
export function filterAwards(awards: AchAward[], f: AwardFilter): AchAward[] {
  return awards.filter((a) => (f.tier === null || a.tier === f.tier) && (f.group === null || a.group === f.group) && (f.state === "all" || (f.state === "won" ? a.level > 0 : a.level === 0)))
    .sort((a, b) => Number(b.level > 0) - Number(a.level > 0) || (b.firstAt ?? "").localeCompare(a.firstAt ?? "") || b.progress - a.progress || a.n - b.n);
}

/** Medal pips of an award: one per step, filled up to its level. */
export function medalPips(a: Pick<AchAward, "levels" | "level">): ("on" | "off")[] {
  return Array.from({ length: Math.max(1, a.levels) }, (_, i) => (i < a.level ? "on" : "off"));
}

/** Days for the time machine's quick buttons, as YYYY-MM-DD in local time. */
export function quickDays(now = new Date()): { label: string; day: string }[] {
  const at = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const back = (days: number, months = 0, years = 0) => at(new Date(now.getFullYear() - years, now.getMonth() - months, now.getDate() - days));
  return [{ label: "Вчера", day: back(1) }, { label: "Неделю назад", day: back(7) }, { label: "Месяц назад", day: back(0, 1) }, { label: "Год назад", day: back(0, 0, 1) }];
}

/** Lines of a gallery card picture: the award's words split to fit `width` characters per line, at most `max` lines. */
export function wrapText(text: string, width: number, max = 3): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if ((line + " " + w).trim().length > width && line) { out.push(line); line = w; } else line = (line + " " + w).trim();
    if (out.length === max) break;
  }
  if (line && out.length < max) out.push(line);
  if (out.length === max && text.length > out.join(" ").length) out[max - 1] = out[max - 1]!.replace(/.?$/, "…");
  return out;
}

/** Rare awards (epic and higher) that were won, for the gallery. */
export const galleryAwards = (d: Pick<AchievementsData, "awards">): AchAward[] => d.awards.filter((a) => a.level > 0 && a.tier >= 4).sort((a, b) => b.tier - a.tier || (b.firstAt ?? "").localeCompare(a.firstAt ?? ""));

/** What a figure that is still collecting data needs, as a sentence: «Копим данные: нужны дела» → «Нужны дела». */
export function needText(detail: string): string {
  const t = detail.replace(/^Копим данные:\s*/, "").trim();
  return t ? t[0]!.toUpperCase() + t.slice(1) : "";
}

export interface NextStep { key: string; emoji: string; text: string; count: number; titles: string[] }
/** One simple action for many waiting figures, recognised by what they need. Order matters: the first match wins. */
const STEP_KINDS: { key: string; emoji: string; text: string; re: RegExp }[] = [
  { key: "goal", emoji: "🎯", text: "Поставьте цель и привяжите к ней пару дел", re: /цел[ьию]|#проект/i },
  { key: "due", emoji: "📅", text: "Добавьте делам сроки", re: /срок/i },
  { key: "steps", emoji: "🪜", text: "Разбейте большое дело на шаги", re: /шаг|подзадач|цепочк/i },
  { key: "estimate", emoji: "⏱️", text: "Укажите у дела оценку времени", re: /оценк/i },
  { key: "notes", emoji: "📝", text: "Запишите пару заметок с идеями", re: /заметк|запис/i },
  { key: "priority", emoji: "⚑", text: "Отметьте важные дела флажком", re: /важн/i },
  { key: "done", emoji: "✅", text: "Отмечайте сделанные дела — каждый день понемногу", re: /выполн|сделанн|закончи|дел/i },
];
/** The three actions that would wake the most waiting figures. */
export function nextSteps(metrics: Pick<AchievementsData["metrics"][number], "ready" | "detail" | "title">[], max = 3): NextStep[] {
  const out = new Map<string, NextStep>();
  for (const m of metrics) {
    if (m.ready) continue;
    const k = STEP_KINDS.find((s) => s.re.test(needText(m.detail)));
    if (!k) continue;
    const s = out.get(k.key) ?? out.set(k.key, { key: k.key, emoji: k.emoji, text: k.text, count: 0, titles: [] }).get(k.key)!;
    s.count++;
    s.titles.push(m.title);
  }
  return [...out.values()].sort((a, b) => b.count - a.count).slice(0, max);
}

/** «Путь кицунэ»: twelve stages by the steps of medals collected, each with its name. */
export const FOX_PATH: { at: number; title: string; emoji: string }[] = [
  { at: 0, title: "Лисёнок", emoji: "🐾" }, { at: 3, title: "Огонёк", emoji: "🔥" }, { at: 8, title: "Рыжая тень", emoji: "🍂" },
  { at: 15, title: "Лесная хитрюга", emoji: "🌲" }, { at: 25, title: "Хранительница тропы", emoji: "🏮" }, { at: 40, title: "Лунная лиса", emoji: "🌙" },
  { at: 60, title: "Мастер иллюзий", emoji: "🎭" }, { at: 85, title: "Белая кицунэ", emoji: "🤍" }, { at: 115, title: "Золотой мех", emoji: "✨" },
  { at: 150, title: "Небесная лиса", emoji: "☁️" }, { at: 200, title: "Хранительница храма", emoji: "⛩️" }, { at: 260, title: "Двенадцатихвостая", emoji: "🦊" },
];
export function foxPath(medals: number): { index: number; next: { at: number; title: string } | null; progress: number } {
  let index = 0;
  FOX_PATH.forEach((s, i) => { if (medals >= s.at) index = i; });
  const cur = FOX_PATH[index]!, next = FOX_PATH[index + 1] ?? null;
  return { index, next, progress: next ? (medals - cur.at) / (next.at - cur.at) : 1 };
}

/** How a won award's tile is dressed: plain up to «Очень редкая», gold frame from «Эпическая», shimmer from «Легендарная». */
export const rarityOf = (tier: number): "common" | "rare" | "legend" => (tier >= 6 ? "legend" : tier >= 4 ? "rare" : "common");

/** What is new on a tab since it was last opened (`seenAt`); nothing before the first visit. */
export function freshCount(d: Pick<AchievementsData, "awards" | "records" | "titles" | "notices">, tab: string, seenAt: string | null): number {
  if (!seenAt) return 0;
  const after = (at: string | null | undefined) => !!at && at > seenAt;
  if (tab === "book") return d.awards.filter((a) => a.level > 0 && after(a.lastAt)).length;
  if (tab === "gallery") return d.awards.filter((a) => a.level > 0 && a.tier >= 4 && after(a.lastAt)).length;
  if (tab === "records") return d.records.filter((r) => after(r.best.at)).length;
  if (tab === "titles") return d.titles.filter((t) => after(t.at)).length;
  if (tab === "discover") return d.notices.filter((n) => after(n.at)).length;
  return 0;
}

/** The same data apart from when it was computed: nothing to redraw. */
export function sameData(a: AchievementsData | null, b: AchievementsData): boolean {
  if (!a) return false;
  return JSON.stringify({ ...a, generatedAt: "" }) === JSON.stringify({ ...b, generatedAt: "" });
}
