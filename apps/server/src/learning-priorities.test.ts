import { describe, expect, it } from "vitest";
import { chooseLearningTopic } from "./learning-priorities";

describe("adaptive learning priorities", () => {
  it("prioritizes verified gaps but reserves every fifth turn for exploration", () => {
    const gaps = [{ topic: "история", priority: 2 }];
    expect(chooseLearningTopic("математика", gaps, 1)).toBe("история");
    expect(chooseLearningTopic("математика", gaps, 2)).toBe("история");
    expect(chooseLearningTopic("математика", gaps, 3)).toBe("история");
    expect(chooseLearningTopic("математика", gaps, 5)).toBe("математика");
  });
  it("discards unsafe priorities and preserves fallback", () => {
    const gaps = [{ topic: "x".repeat(81), priority: 2 }, { topic: "наука", priority: 999 }];
    expect(chooseLearningTopic("математика", gaps, 3)).toBe("математика");
  });
  it("does not multiply equivalent topics that differ by case, spacing or е/ё", () => {
    const topics = [
      { topic: "Ёжики", priority: 1 },
      { topic: "ежики", priority: 2 },
      { topic: "  ЕЖИКИ  ", priority: 1 },
      { topic: "логика", priority: 1 },
    ];
    expect(chooseLearningTopic("математика", topics, 1)).toBe("ежики");
    expect(chooseLearningTopic("математика", topics, 2)).toBe("ежики");
    expect(chooseLearningTopic("математика", topics, 3)).toBe("логика");
  });
});
