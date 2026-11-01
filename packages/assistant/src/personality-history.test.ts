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
    expect((await new PersonalityHistory(storage).current()).acceptedLessons).toEqual(["lesson-1"]);
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
