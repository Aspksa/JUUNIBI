import { describe, expect, it } from "vitest";
import { searchKnowledgeAndMemory } from "./brain-knowledge-memory-gateway";
import type { VerifiedKnowledge } from "./knowledge-ledger";
import type { MemoryEntry } from "@juunibi/assistant";

const knowledge = (id: string, claim: string, status: VerifiedKnowledge["status"] = "verified"): VerifiedKnowledge => ({
  id, topic: "память", claim, status, source: "test-source",
  verifiedAt: "2026-01-01T00:00:00Z", nextReviewAt: "2027-01-01T00:00:00Z", reviewCount: 0,
});
const memory = (id: string, text: string, status: MemoryEntry["status"] = "active"): MemoryEntry => ({
  id, text, status, kind: "fact", score: 0, createdAt: 100,
});

describe("federated knowledge and memory gateway", () => {
  it("only exposes fresh verified knowledge and owner-approved current memory", async () => {
    const result = await searchKnowledgeAndMemory("память", [
      knowledge("k1", "Память хранит факты"),
      knowledge("k2", "Память хранит ложь", "needs-review"),
    ], async () => [memory("m1", "Память учитывает опыт"), memory("m2", "Память раскрывает секрет", "pending")]);
    expect(result.map(x => x.id)).toEqual(["k1", "m1"]);
    expect(result.map(x => x.kind)).toEqual(["verified-knowledge", "memory"]);
  });
  it("deduplicates across stores and rejects stale, superseded or expired entries", async () => {
    const result = await searchKnowledgeAndMemory("память", [
      knowledge("k1", "Память хранит факты"),
      { ...knowledge("k2", "Память устарела"), nextReviewAt: "2020-01-01T00:00:00Z" },
    ], async () => [
      memory("m1", "память хранит факты"),
      { ...memory("m2", "Память просрочена"), expiresAt: 1 },
      { ...memory("m3", "Память заменена"), supersededBy: "m4" },
      memory("m4", "Память обучается"),
    ]);
    expect(result.map(x => x.id)).toEqual(["k1", "m4"]);
  });
  it("does not query personal memory for invalid requests", async () => {
    let called = 0;
    expect(await searchKnowledgeAndMemory("", [], async () => { called++; return []; })).toEqual([]);
    expect(called).toBe(0);
  });
});
