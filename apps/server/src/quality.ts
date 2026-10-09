import type { Turn } from "@juunibi/assistant";

export interface QualityReport {
  totals: { turns: number; rated: number; up: number; down: number; unrated: number; satisfaction: number | null };
  byDay: { day: string; up: number; down: number }[];
  byTool: { tool: string; uses: number; up: number; down: number; satisfaction: number | null }[];
  worst: { id: string; at: string; user: string; reply: string; tools: string[] }[];
  /** Words that show up in disliked questions much more often than in liked ones: where the assistant tends to fail. */
  troubleWords: { word: string; down: number; up: number }[];
  datasetReady: number;
}
const STOP = new Set(["этот", "этого", "этой", "если", "чтобы", "когда", "очень", "можно", "нужно", "какой", "какая", "какие", "который", "которая", "пожалуйста", "сделай", "расскажи", "напиши", "помоги", "хочу", "есть", "быть", "будет", "тоже", "также", "после", "перед", "почему", "потому", "между", "через", "только", "этом", "всех", "свой", "свои", "мне", "тебе", "меня"]);
const words = (s: string) => new Set((s.toLowerCase().replace(/ё/g, "е").match(/[\p{L}]{4,}/gu) ?? []).filter((w) => !STOP.has(w)).map((w) => (w.length > 6 ? w.slice(0, w.length - 2) : w)));
const ratio = (up: number, down: number) => (up + down ? Math.round((100 * up) / (up + down)) : null);
const dayKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** Turns the thumbs up/down log into a report. Pure: no I/O, no clock except the `now` argument. */
export function buildQualityReport(turns: Turn[], now = Date.now()): QualityReport {
  const rated = turns.filter((t) => t.rating === 1 || t.rating === -1);
  const up = rated.filter((t) => t.rating === 1), down = rated.filter((t) => t.rating === -1);
  const days = new Map<string, { up: number; down: number }>();
  for (let i = 13; i >= 0; i--) days.set(dayKey(now - i * 86_400_000), { up: 0, down: 0 });
  for (const t of rated) { const d = days.get(dayKey(t.at)); if (d) { if (t.rating === 1) d.up++; else d.down++; } }
  const tools = new Map<string, { uses: number; up: number; down: number }>();
  for (const t of turns) for (const name of new Set(t.tools)) {
    const x = tools.get(name) ?? { uses: 0, up: 0, down: 0 };
    x.uses++; if (t.rating === 1) x.up++; if (t.rating === -1) x.down++;
    tools.set(name, x);
  }
  const wUp = new Map<string, number>(), wDown = new Map<string, number>();
  for (const t of up) for (const w of words(t.user)) wUp.set(w, (wUp.get(w) ?? 0) + 1);
  for (const t of down) for (const w of words(t.user)) wDown.set(w, (wDown.get(w) ?? 0) + 1);
  const trouble = [...wDown].filter(([w, n]) => n >= 2 && n > (wUp.get(w) ?? 0)).map(([word, n]) => ({ word, down: n, up: wUp.get(word) ?? 0 }))
    .sort((a, b) => (b.down - b.up) - (a.down - a.up) || b.down - a.down).slice(0, 8);
  return {
    totals: { turns: turns.length, rated: rated.length, up: up.length, down: down.length, unrated: turns.length - rated.length, satisfaction: ratio(up.length, down.length) },
    byDay: [...days].map(([day, v]) => ({ day, ...v })),
    byTool: [...tools].map(([tool, v]) => ({ tool, ...v, satisfaction: ratio(v.up, v.down) })).sort((a, b) => b.uses - a.uses).slice(0, 12),
    worst: down.slice(-10).reverse().map((t) => ({ id: t.id, at: new Date(t.at).toISOString(), user: t.user.slice(0, 200), reply: t.reply.slice(0, 200), tools: t.tools })),
    troubleWords: trouble,
    datasetReady: up.length,
  };
}
