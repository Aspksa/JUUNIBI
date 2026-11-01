import { describe, expect, it } from "vitest";
import { MemoryAdapter } from "./memory";
import { PersonalityHistory } from "./personality-history";
import { proposeLesson } from "./personality";

describe("PersonalityHistory", () => {
  it("persists approved lessons, not rejected proposals", async () => {
    const storage = new MemoryAdapter();
    const history = new PersonalityHistory(storage);
    const lesson = proposeLesson("lesson-1", "Answer concisely", ["owner feedback"], 0.9);
    await history.approveLesson(lesson, false);
    expect((await history.current()).version).toBe(1);
    await history.approveLesson(lesson, true);
    const reloaded = await new PersonalityHistory(storage).current();
    expect(reloaded.acceptedLessons).toEqual(["lesson-1"]);
    expect(reloaded.lessonTexts?.["lesson-1"]).toBe("Answer concisely");
  });

  it("returns isolated history copies", async () => {
    const history = new PersonalityHistory(new MemoryAdapter());
    await history.adjustTrait("curiosity", 0.1, true);
    const versions = await history.history();
    expect(versions.map(v => v.version)).toEqual([1, 2]);
    versions[1]!.traits.curiosity = 0;
    expect((await history.current()).traits.curiosity).toBeCloseTo(0.7);
  });

  it("restores a prior snapshot as a new version", async () => {
    const history = new PersonalityHistory(new MemoryAdapter());
    await history.adjustTrait("warmth", 0.1, true);
    expect((await history.restore(1, false)).version).toBe(2);
    const restored = await history.restore(1, true);
    expect(restored.version).toBe(3);
    expect(restored.traits.warmth).toBe(0.7);
  });
});
