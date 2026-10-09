import { describe, expect, it } from "vitest";
import { searchVerifiedKnowledge } from "./brain-knowledge-search";
import type { VerifiedKnowledge } from "./knowledge-ledger";

const make = (id: string, claim: string, status: VerifiedKnowledge["status"] = "verified"): VerifiedKnowledge => ({
  id, topic: "математика", claim, source: "deterministic-test", status,
  verifiedAt: "2026-01-01T00:00:00.000Z", nextReviewAt: "2026-12-01T00:00:00.000Z", reviewCount: 0,
});
describe("brain knowledge retrieval", () => {
  it("does not expose records requiring review", () => {
    expect(searchVerifiedKnowledge([make("a", "Сложение чисел"), make("b", "Сложение ошибочно", "needs-review")], "сложение").map(x => x.id)).toEqual(["a"]);
  });
  it("does not return unrelated or empty queries", () => {
    expect(searchVerifiedKnowledge([make("a", "Сложение чисел")], "биология")).toEqual([]);
    expect(searchVerifiedKnowledge([make("a", "Сложение чисел")], "")).toEqual([]);
  });
  it("respects limits, normalizes ё and never mutates source", () => {
    const values = [make("a", "Ёжик считает"), make("b", "Ёжик умножает")];
    const original = JSON.stringify(values);
    expect(searchVerifiedKnowledge(values, "ежик", 1)).toHaveLength(1);
    expect(JSON.stringify(values)).toBe(original);
  });
});
