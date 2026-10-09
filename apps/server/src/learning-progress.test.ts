import { describe, expect, it } from "vitest";
import { LearningProgress } from "./learning-progress";

describe("Brain 4.3 learning performance", () => {
  it("tracks accuracy, adjusts level and restores its state", () => {
    const p = new LearningProgress();
    expect(p.summary().accuracy).toBeNull();
    p.record(true); p.record(true); p.record(true);
    expect(p.difficulty()).toBe(2);
    expect(p.summary()).toMatchObject({ total: 3, correct: 3, accuracy: 100, recentAccuracy: 100 });
    const restored = new LearningProgress();
    restored.load(p.snapshot());
    expect(restored.difficulty()).toBe(2);
    restored.record(false);
    expect(restored.difficulty()).toBe(1);
    expect(restored.summary().accuracy).toBe(75);
  });
  it("rejects malformed saved attempts", () => {
    const p = new LearningProgress();
    p.load({ level: 999, attempts: [{correct:"yes",level:-5,at:1}] });
    expect(p.summary().total).toBe(0);
    expect(p.difficulty()).toBe(1);
  });
});
