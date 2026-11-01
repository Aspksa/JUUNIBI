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
  it("deduplicates equivalent verified facts before citing them in guidance", () => {
    const result = automaticBrainReview({
      message: "память",
      verifiedKnowledge: [
        { topic: "Память", claim: "Хранит факты", status: "verified" },
        { topic: "память", claim: "хранит факты", status: "verified" },
        { topic: "память", claim: "ложный факт", status: "needs-review" },
      ],
    });
    const note = result.guidance.evidenceWarnings.find(x => x.includes("локального реестра")) ?? "";
    expect(note).toContain("Хранит факты");
    expect(note).not.toContain("хранит факты;");
    expect(note).not.toContain("ложный факт");
  });
});
