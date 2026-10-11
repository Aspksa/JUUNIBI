import { describe, it, expect } from "vitest";
import { recentContext } from "../src/chat/context";

describe("conversation context", () => {
  it("selects recent complete turns within a bounded character budget", () => {
    const turns = [
      { role: "user" as const, content: "old".repeat(100) },
      { role: "assistant" as const, content: "previous" },
      { role: "user" as const, content: "new" },
    ];
    expect(recentContext(turns, 20)).toEqual(turns.slice(1));
    expect(recentContext(turns, 3)).toEqual(turns.slice(2));
  });
  it("caps the number of replayed messages", () => {
    const turns = Array.from({ length: 90 }, () => ({ role: "user" as const, content: "a" }));
    expect(recentContext(turns)).toHaveLength(60);
  });
});
