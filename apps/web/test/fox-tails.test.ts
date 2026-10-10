import { describe, expect, it } from "vitest";
import { TAIL_HUES, tailAngle } from "../src/pages/tails";

describe("red fox tails", () => {
  it("uses only natural red and ginger coat hues, no rainbow", () => {
    expect(TAIL_HUES).toHaveLength(12);
    expect(new Set(TAIL_HUES).size).toBeGreaterThan(5);
    for (const hue of TAIL_HUES) {
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThanOrEqual(25);
    }
  });
  it("fans twelve tails symmetrically", () => {
    expect(tailAngle(0)).toBe(-78);
    expect(tailAngle(11)).toBe(78);
    expect(tailAngle(5) + tailAngle(6)).toBeCloseTo(0);
  });
});
