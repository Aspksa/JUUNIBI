import type { VerifiedKnowledge } from "./knowledge-ledger";

/** Read-only retrieval of owner-approved or deterministically verified knowledge. */
export function searchVerifiedKnowledge(items: readonly VerifiedKnowledge[], query: string, limit = 5) {
  if (typeof query !== "string" || query.length > 300 || !query.trim()) return [];
  const words = (s: string) => new Set((s.toLocaleLowerCase("ru").replace(/ё/g, "е").match(/[\p{L}\p{N}]{3,}/gu) ?? []));
  const terms = words(query);
  if (!terms.size) return [];
  const seen = new Set<string>();
  return items.filter(x => {
    if (x.status !== "verified" || typeof x.claim !== "string") return false;
    const key = (x.topic + "\u0000" + x.claim).normalize("NFKC").toLocaleLowerCase("ru").replace(/ё/g, "е").replace(/\s+/g, " ").trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })
    .map(x => {
      const field = words(x.topic + " " + x.claim);
      const score = [...terms].filter(t => field.has(t)).length;
      return { x, score };
    }).filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.x.id.localeCompare(b.x.id))
    .slice(0, Math.max(1, Math.min(10, Math.trunc(limit) || 5)))
    .map(({ x }) => ({ id: x.id, topic: x.topic, claim: x.claim, source: x.source, verifiedAt: x.verifiedAt, nextReviewAt: x.nextReviewAt }));
}
