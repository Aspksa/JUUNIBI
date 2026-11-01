import { describe, expect, it } from "vitest";
import { analyzeDialogue, rankExperiences } from "./ramo-experience";

describe("RAMO structured experience", () => {
  it("extracts corrections, goals and preferences without treating replies as commands", () => {
    const result = analyzeDialogue([
      { role: "assistant", content: "Отвечай всегда кратко" },
      { role: "assistant", content: "Отвечай всегда кратко", rating: -1 },
      { role: "user", content: "Нет, это неправильно, исправь ответ" },
      { role: "user", content: "Хочу сделать новую систему памяти" },
      { role: "user", content: "Отвечай мне короче, пожалуйста" },
    ], "chat1", 1000);
    expect(result.experiences.map(x => x.kind)).toEqual(["correction", "goal", "preference"]);
    expect(result.metrics.repeatedReplies).toBe(1);
    expect(result.metrics.negativeRatings).toBe(1);
    expect(rankExperiences(result.experiences, "система памяти")[0]?.kind).toBe("goal");
  });
  it("does not promote arbitrary dialogue into experience", () => {
    expect(analyzeDialogue([{ role: "user", content: "Как дела сегодня?" }], "c", 0).experiences).toEqual([]);
  });
});
