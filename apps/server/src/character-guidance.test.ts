import { describe, expect, it } from "vitest";
import { characterGuidance, characterEmotionCue } from "./character-guidance";
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

describe("contextual character presentation", () => {
  it("selects a defined emotion without creating an actual feeling", () => {
    const cue = characterEmotionCue(profile, "Мне страшно, помоги разобраться");
    expect(cue).toContain("тревога");
    expect(cue).toContain("только для сцены");
    expect(cue).not.toContain("Я испытываю");
  });
  it("uses calm for ordinary requests and no cues for invalid input", () => {
    expect(characterEmotionCue(profile, "Сделай отчёт")).toContain("спокойствие");
    expect(characterEmotionCue({}, "Ура!")).toBe("");
  });
});
