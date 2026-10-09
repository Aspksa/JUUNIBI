import { describe, expect, it } from "vitest";
import { automaticBrainReview } from "./brain-v41-automatic";

describe("Brain 4.1 automatic chat review", () => {
  it("runs twenty checkpoints and retains approval gates", () => {
    const result = automaticBrainReview({ message: "Удалить файл после проверки" });
    expect(result.cycle.checkpoints).toHaveLength(20);
    expect(result.guidance.needsApproval).toBe(true);
    expect(result.cycle.executionPerformed).toBe(false);
  });
  it("does not trust unverified facts", () => {
    const result = automaticBrainReview({ message: "сведения", verifiedKnowledge: [{ topic: "сведения", claim: "ложный факт", status: "needs-review" }] });
    expect(result.cycle.evidence.matchedVerifiedRecords).toBe(0);
    expect(result.guidance.needsEvidenceReview).toBe(true);
  });
});
