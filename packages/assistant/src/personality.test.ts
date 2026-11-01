import { describe, expect, it } from "vitest";
import { initialPersonality, proposeLesson, acceptLesson, evolveTrait, rollbackPersonality } from "./personality";
describe("personality evolution", () => {
  it("requires approval for learning", () => {
    const start = initialPersonality();
    const proposal = proposeLesson("a", "Prefer short answers", ["explicit feedback"], 0.9);
    expect(acceptLesson(start, proposal, false)).toBe(start);
    expect(acceptLesson(start, proposal, true).acceptedLessons).toEqual(["a"]);
    expect(start.acceptedLessons).toEqual([]);
  });
  it("rejects low-confidence lessons and duplicates", () => {
    const start = initialPersonality();
    expect(acceptLesson(start, proposeLesson("a", "guess", ["weak"], 0.3), true)).toBe(start);
    const p = proposeLesson("a", "clear", ["feedback"], 0.8);
    const next = acceptLesson(start, p, true);
    expect(acceptLesson(next, p, true)).toBe(next);
  });
  it("bounds changes and supports rollback", () => {
    const start = initialPersonality();
    expect(evolveTrait(start, "warmth", 1, false)).toBe(start);
    const next = evolveTrait(start, "warmth", 1, true);
    expect(next.traits.warmth).toBeCloseTo(0.8);
    expect(rollbackPersonality([start, next], 1)).toEqual(start);
  });
});
