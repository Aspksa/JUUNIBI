import { describe, expect, it } from "vitest";
import { characterGuidance } from "./character-guidance";
import profile from "../assets/JUUNIBI_character_v1.json";

describe("canonical character persona", () => {
  it("includes defining traits, principles and situational conduct", () => {
    const text = characterGuidance(profile);
    expect(text).toContain("Преданность");
    expect(text).toContain("Принципиальность");
    expect(text).toContain("Не выдавать художественный образ за реальные чувства");
    expect(text).toContain("disagreement:");
    expect(text.length).toBeLessThanOrEqual(5000);
  });
  it("handles malformed optional profile safely", () => {
    expect(characterGuidance(null)).toBe("");
    expect(characterGuidance({ personality: { traits: [null] } })).toContain("не подтверждает наличие сознания");
  });
});
