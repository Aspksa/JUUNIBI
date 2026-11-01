import { describe, expect, it } from "vitest";
import { suggestConversationLessons } from "./personality-suggestions";

describe("suggestConversationLessons", () => {
  it("suggests only explicit user preferences and removes duplicates", () => {
    const suggestions = suggestConversationLessons([
      { role: "assistant", content: "Отвечай мне всегда кратко" },
      { role: "user", content: "Привет, как дела?" },
      { role: "user", content: "Отвечай мне всегда кратко" },
      { role: "user", content: "Отвечай мне всегда кратко" },
    ]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.confidence).toBe(0.8);
    expect(suggestions[0]!.lesson).toContain("кратко");
  });
  it("does not treat ordinary chat as an approved lesson", () => {
    expect(suggestConversationLessons([{ role: "user", content: "Расскажи, какая сегодня погода?" }])).toEqual([]);
  });
});
