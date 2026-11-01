import { describe, expect, it } from "vitest";
import { buildRagContext } from "./rag-context";
import type { VerifiedKnowledge } from "./knowledge-ledger";
const fact = (id: string, status: VerifiedKnowledge["status"], nextReviewAt = "2099-01-01"): VerifiedKnowledge => ({
 id, topic: "проект", claim: "проект содержит память", source: "user-confirmed", verifiedAt: "2026-01-01", nextReviewAt, reviewCount: 1, status
});
describe("grounded RAG", () => {
 it("retrieves verified, current claims with source citations", () => {
   const result = buildRagContext([fact("a","verified"),fact("b","needs-review")],"память",{now:new Date("2026-11-01")});
   expect(result.sources.map(x=>x.id)).toEqual(["a"]);
   expect(result.context).toContain("[K1]");
   expect(result.executesAutomatically).toBe(false);
 });
 it("excludes expired claims", () => {
   const result = buildRagContext([fact("old","verified","2020-01-01")],"память",{now:new Date("2026-11-01")});
   expect(result.sources).toHaveLength(0);
   expect(result.staleIds).toContain("old");
 });
});
