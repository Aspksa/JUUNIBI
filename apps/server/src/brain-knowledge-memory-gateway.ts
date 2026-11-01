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
  searchDisk?: (query: string) => Promise<unknown>,
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
  // Reuse the owner-scoped Disk search tool; do not read document contents implicitly.
  const found = searchDisk && query.trim().length >= 2 && query.trim().length <= 160
    ? await searchDisk(query).catch(() => null) : null;
  const raw = found && typeof found === "object" && !Array.isArray(found)
    ? (found as { documents?: unknown }).documents : null;
  const documents = (Array.isArray(raw) ? raw : []).slice(0, count * 2)
    .filter((x): x is { id: string; name: string; folder: string; source: "disk" } =>
      !!x && typeof x.id === "string" && !!x.id && typeof x.name === "string" &&
      !!x.name && typeof x.folder === "string" && x.source === "disk")
    .map(x => ({ id: x.id, text: x.name.slice(0, 240),
      source: "disk:" + x.folder.slice(0, 240), kind: "disk-document" as const }));
  const unique = new Set<string>();
  const diskIds = new Set<string>();
  return [...verified, ...remembered, ...documents].filter(item => {
    if (item.kind === "disk-document") {
      if (diskIds.has(item.id)) return false;
      diskIds.add(item.id);
      return true;
    }
    const identity = item.text.normalize("NFKC").toLocaleLowerCase("ru")
      .replace(/ё/g, "е").replace(/\s+/g, " ").trim();
    if (!identity || unique.has(identity)) return false;
    unique.add(identity);
    return true;
  }).slice(0, count);
}
