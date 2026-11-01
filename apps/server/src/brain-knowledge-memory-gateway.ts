import type { MemoryEntry } from "@juunibi/assistant";
import type { VerifiedKnowledge } from "./knowledge-ledger";
import { searchVerifiedKnowledge } from "./brain-knowledge-search";

/** One read-only retrieval boundary; existing stores retain their approval policies. */
export async function searchKnowledgeAndMemory(
  query: string,
  knowledge: readonly VerifiedKnowledge[],
  searchMemory: (query: string, limit: number) => Promise<MemoryEntry[]>,
  limit = 5,
  now = Date.now(),
) {
  if (typeof query !== "string" || !query.trim() || query.length > 300) return [];
  const count = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 10)) : 5;
  const verified = searchVerifiedKnowledge(knowledge, query, count * 2)
    .filter(item => knowledge.some(record =>
      record.id === item.id && record.status === "verified" &&
      !!record.source.trim() && Number.isFinite(Date.parse(record.nextReviewAt)) &&
      Date.parse(record.nextReviewAt) > now))
    .map(item => ({ id: item.id, text: item.claim, source: item.source, kind: "verified-knowledge" as const }));
  const remembered = (await searchMemory(query, count * 2))
    .filter(item => item.status === "active" && !item.supersededBy &&
      (item.expiresAt === undefined || item.expiresAt > now))
    .map(item => ({ id: item.id, text: item.text, source: "owner-approved-memory", kind: "memory" as const }));
  const unique = new Set<string>();
  return [...verified, ...remembered].filter(item => {
    const identity = item.text.normalize("NFKC").toLocaleLowerCase("ru")
      .replace(/ё/g, "е").replace(/\s+/g, " ").trim();
    if (!identity || unique.has(identity)) return false;
    unique.add(identity);
    return true;
  }).slice(0, count);
}
