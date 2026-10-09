import { describe, expect, it } from "vitest";
import { chooseLearningTopic } from "./learning-priorities";

describe("adaptive learning priorities", () => {
  it("uses a knowledge gap for one in three turns", () => {
    const gaps = [{ topic: "история", priority: 2 }];
    expect(chooseLearningTopic("математика", gaps, 1)).toBe("математика");
    expect(chooseLearningTopic("математика", gaps, 2)).toBe("математика");
    expect(chooseLearningTopic("математика", gaps, 3)).toBe("история");
  });
  it("discards unsafe priorities and preserves fallback", () => {
    const gaps = [{ topic: "x".repeat(81), priority: 2 }, { topic: "наука", priority: 999 }];
    expect(chooseLearningTopic("математика", gaps, 3)).toBe("математика");
  });
});
