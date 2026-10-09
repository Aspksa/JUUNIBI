import type { Turn } from "@juunibi/assistant";
import { BUILTIN_COMMAND_NAMES, type QuickCommand } from "./assistant-settings";

export interface RepeatSuggestion { text: string; count: number; name: string }
const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}\s]+/gu, " ").replace(/\s+/g, " ").trim();
const tokens = (s: string) => new Set(norm(s).split(" ").filter((w) => w.length > 2));
const jaccard = (a: Set<string>, b: Set<string>) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n / Math.max(1, a.size + b.size - n); };

/**
 * "You asked the same thing three times": proposes saving it as a quick command. Pure and read-only:
 * it never creates anything, the owner decides.
 */
export function repeatedRequests(turns: Turn[], saved: QuickCommand[], now = Date.now(), opts = { minCount: 3, days: 30, max: 3 }): RepeatSuggestion[] {
  const since = now - opts.days * 86_400_000;
  const groups: { toks: Set<string>; key: string; last: Turn; count: number }[] = [];
  for (const t of turns) {
    if (t.at < since || t.user.startsWith("/") || t.user.length > 400) continue;
    const toks = tokens(t.user);
    if (toks.size < 2) continue; // "привет" is not a command
    const g = groups.find((x) => x.key === norm(t.user) || jaccard(x.toks, toks) >= 0.7);
    if (g) { g.count++; if (t.at >= g.last.at) g.last = t; } else groups.push({ toks, key: norm(t.user), last: t, count: 1 });
  }
  const taken = new Set([...BUILTIN_COMMAND_NAMES, ...saved.map((c) => c.name)]);
  const savedKeys = new Set(saved.map((c) => norm(c.text)));
  const out: RepeatSuggestion[] = [];
  for (const g of groups.filter((x) => x.count >= opts.minCount && !savedKeys.has(x.key)).sort((a, b) => b.count - a.count || b.last.at - a.last.at)) {
    const base = [...g.toks].find((w) => w.length >= 4)?.slice(0, 12) ?? "команда";
    let name = base, i = 2;
    while (taken.has(name)) name = base.slice(0, 10) + i++;
    taken.add(name);
    out.push({ text: g.last.user, count: g.count, name });
    if (out.length >= opts.max) break;
  }
  return out;
}
