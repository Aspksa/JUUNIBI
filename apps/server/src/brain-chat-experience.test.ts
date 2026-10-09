import { describe, expect, it } from "vitest";
import { summarizeChatExperience } from "./brain-chat-experience";
describe("brain chat experience hints", () => {
  it("ignores low-sample and unconfirmed outcome rates", () => {
    const r = summarizeChatExperience({ decisionGroups: [
      { name: "мало", confirmed: 2, successRate: 0 },
      { name: "неизвестно", confirmed: 7, successRate: null },
      { name: "планирование", confirmed: 10, successRate: 30 },
    ], warnings: [] });
    expect(r.weakAreas).toEqual([{ taskType: "планирование", samples: 10, observedSuccessRate: 30 }]);
  });
  it("returns no fabricated weaknesses when evidence is insufficient", () => {
    const r = summarizeChatExperience({ decisionGroups: [], warnings: [] });
    expect(r.weakAreas).toEqual([]);
    expect(r.evidenceLimited).toBe(true);
  });
});
