import { describe, expect, it } from "vitest";
import { AssistantMemoryReview } from "./assistant-memory-review";
import { ToolAuditJournal, verifyAssistantAnswer } from "./assistant-quality-gates";
describe("assistant memory and quality", () => {
  it("only recalls verified facts and preserves their source", () => {
    const m = new AssistantMemoryReview();
    const x = m.propose({ topic: "language", claim: "TypeScript preferred", sourceTurnId: "turn1", confidence: 0.9 })!;
    expect(m.recall("TypeScript")).toEqual([]);
    expect(m.decide(x.id, "verified")).toBe(true);
    expect(m.recall("TypeScript")).toHaveLength(1);
    expect(m.explain(x.id)?.sourceTurnId).toBe("turn1");
  });
  it("deduplicates proposed memories", () => {
    const m = new AssistantMemoryReview();
    const a = m.propose({ topic: "Project", claim: "Uses TypeScript", sourceTurnId: "one", confidence: 0.8 })!;
    const b = m.propose({ topic: "project", claim: "Uses TypeScript", sourceTurnId: "two", confidence: 0.8 })!;
    expect(b.id).toBe(a.id);
  });
  it("never claims tool success without a successful tool outcome", () => {
    const audit = new ToolAuditJournal();
    audit.record({ id: "call1", name: "write", startedAt: 1, finishedAt: 2, ok: false });
    expect(audit.failures("write")).toBe(1);
    expect(verifyAssistantAnswer("Saved", { claimsToolSuccess: true, toolCalls: audit.list() }).passed).toBe(false);
  });
});
