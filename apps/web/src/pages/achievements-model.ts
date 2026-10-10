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
