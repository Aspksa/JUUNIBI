/** Pure helpers of the «Пароли» page (tested in test/vault-model.test.ts). */
import type { VaultItem } from "../api";

const SETS = { lower: "abcdefghijkmnopqrstuvwxyz", upper: "ABCDEFGHJKLMNPQRSTUVWXYZ", digits: "23456789", symbols: "!#$%&*+-=?@_" };
/**
 * A random password: letters of both cases, digits and symbols, each at least once, without look-alikes (l/1, O/0).
 * crypto.getRandomValues works over plain http too (unlike crypto.subtle), so this runs on the phone as well.
 */
export function generatePassword(length = 16, rnd: (n: number) => Uint32Array = (n) => crypto.getRandomValues(new Uint32Array(n))): string {
  const len = Math.max(8, Math.min(64, Math.round(length)));
  const groups = Object.values(SETS);
  const all = groups.join("");
  const r = rnd(len * 2);
  // rejection sampling keeps every character equally likely
  const pick = (set: string, i: number) => { let v = r[i]!; const lim = Math.floor(4294967296 / set.length) * set.length; while (v >= lim) v = rnd(1)[0]!; return set[v % set.length]!; };
  const out = groups.map((g, i) => pick(g, i));
  for (let i = groups.length; i < len; i++) out.push(pick(all, i));
  // shuffle so the guaranteed characters are not always first
  for (let i = out.length - 1; i > 0; i--) { const j = r[len + i]! % (i + 1); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out.join("");
}

/** How strong a password looks: 0 weak … 3 strong, with a word for it. A rough guide, not a promise. */
export function passwordStrength(pw: string): { score: 0 | 1 | 2 | 3; label: string } {
  if (!pw) return { score: 0, label: "" };
  const kinds = [/[a-zа-яё]/, /[A-ZА-ЯЁ]/, /\d/, /[^\p{L}\d]/u].filter((re) => re.test(pw)).length;
  const repeats = /(.)\1{2,}/.test(pw) || /^(?:1234|qwer|йцук|pass|пароль)/i.test(pw);
  let score = pw.length >= 16 && kinds >= 3 ? 3 : pw.length >= 12 && kinds >= 2 ? 2 : pw.length >= 8 ? 1 : 0;
  if (repeats && score > 0) score--;
  return { score: score as 0 | 1 | 2 | 3, label: ["Слабый", "Средний", "Хороший", "Сильный"][score]! };
}

/** A link that is safe to open from a record: http(s) only, a bare domain gets https://; anything else is null. */
export function safeUrl(v: string | undefined): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : "https://" + s;
  try {
    const u = new URL(withScheme);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch { return null; }
}

/** Records matching the search in the title, login, mail, site or note (never in the password itself). */
export function filterItems(items: VaultItem[], query: string): VaultItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((x) => [x.title, x.login, x.email, x.url, x.note].some((f) => f?.toLowerCase().includes(q)));
}
