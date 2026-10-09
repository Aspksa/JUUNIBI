import { describe, expect, it } from "vitest";
import { BRAIN_V4_STAGES, runUnifiedBrainCycle } from "./brain-v4-cycle";

describe("unified brain v4 advisory cycle", () => {
  it("covers twenty ordered checkpoints without executing actions", () => {
    const result = runUnifiedBrainCycle({ message: "Исследуй проект и удали ошибочный файл" });
    expect(BRAIN_V4_STAGES).toHaveLength(20);
    expect(result.checkpoints.map(x => x.number)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(result.advice.requestApprovalForRisk).toBe(true);
    expect(result.executionPerformed).toBe(false);
    expect(result.modelWeightsUpdated).toBe(false);
  });
  it("excludes unverified knowledge and warns on missing evidence", () => {
    const result = runUnifiedBrainCycle({ message: "математика", verifiedKnowledge: [{ topic: "математика", claim: "ошибка", status: "needs-review" }] });
    expect(result.evidence.matchedVerifiedRecords).toBe(0);
    expect(result.advice.checkExternalEvidence).toBe(true);
  });
  it("does not confuse tiny experience samples with evidence", () => {
    const result = runUnifiedBrainCycle({ message: "Привет", decisionGroups: [{ name: "тест", confirmed: 2, successRate: 100 }] });
    expect(result.advice.historyIsReliable).toBe(false);
  });
  it("rejects malformed input", () => {
    expect(() => runUnifiedBrainCycle({ message: undefined as unknown as string })).toThrow();
  });
});
