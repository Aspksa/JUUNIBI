import { checkPublicEvidence, type EvidenceResult } from "./public-evidence";

/** Multiple exact-quote matches provide traceable corroboration, not a truth verdict. */
export async function comparePublicEvidence(
  candidates: unknown,
  checker: typeof checkPublicEvidence = checkPublicEvidence,
): Promise<{ evidence: EvidenceResult[]; distinctSources: number; corroborated: boolean; promotesToMemory: false }> {
  if (!Array.isArray(candidates) || candidates.length < 2 || candidates.length > 3)
    throw Object.assign(new Error("Нужно 2–3 независимых источника"), { status: 400 });
  const records: { source: string; section: string; quote: string }[] = [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw Object.assign(new Error("Неверный источник"), { status: 400 });
    const c = candidate as Record<string, unknown>;
    if (typeof c.source !== "string" || typeof c.section !== "string" || typeof c.quote !== "string")
      throw Object.assign(new Error("Не указан источник, раздел или цитата"), { status: 400 });
    records.push({ source: c.source, section: c.section, quote: c.quote });
  }
  if (new Set(records.map(c => c.source)).size !== records.length)
    throw Object.assign(new Error("Источники должны отличаться"), { status: 400 });
  const evidence: EvidenceResult[] = [];
  for (const c of records) evidence.push(await checker(c.source, c.section, c.quote));
  const distinctSources = evidence.filter(e => e.matched).length;
  return { evidence, distinctSources, corroborated: distinctSources >= 2, promotesToMemory: false };
}
