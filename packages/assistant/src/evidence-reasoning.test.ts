import { describe, expect, it } from "vitest";
import { assessEvidence, type BrainEvidence } from "./evidence-reasoning";

const now = 1_800_000_000_000;
const sample = (overrides: Partial<BrainEvidence> = {}): BrainEvidence => ({
  id: "a", subject: "обновление", proposition: "Тесты прошли", polarity: "supports",
  origin: "tool", observedAt: now, reliability: 1, ...overrides,
});
describe("Brain evidence reasoning", () => {
  it("never claims support without evidence", () => {
    const result = assessEvidence("обновление", "Тесты прошли", [], now);
    expect(result.verdict).toBe("insufficient");
    expect(result.confidence).toBe(0);
  });
  it("uses trusted evidence and reports provenance", () => {
    const result = assessEvidence("обновление", "Тесты прошли", [sample()], now);
    expect(result.verdict).toBe("supported");
    expect(result.supportingIds).toEqual(["a"]);
  });
  it("flags contradictions rather than choosing a convenient answer", () => {
    const result = assessEvidence("обновление", "Тесты прошли",
      [sample(), sample({ id: "b", polarity: "refutes" })], now);
    expect(result.verdict).toBe("conflicted");
    expect(result.refutingIds).toEqual(["b"]);
  });
  it("cannot boost confidence by duplicating evidence IDs", () => {
    const single = assessEvidence("обновление", "Тесты прошли", [sample()], now);
    const repeated = assessEvidence("обновление", "Тесты прошли", [sample(), sample()], now);
    expect(repeated).toEqual(single);
  });
  it("isolates subjects and propositions", () => {
    const result = assessEvidence("сеть", "Тесты прошли", [sample()], now);
    expect(result.verdict).toBe("insufficient");
  });
  it("ignores future observations and reduces the weight of old evidence", () => {
    const future = assessEvidence("обновление", "Тесты прошли",
      [sample({ observedAt: now + 1 })], now);
    expect(future.verdict).toBe("insufficient");
    const old = assessEvidence("обновление", "Тесты прошли",
      [sample({ observedAt: now - 10 * 365 * 86_400_000 })], now);
    expect(old.verdict).toBe("insufficient");
  });
  it("rejects malformed and unbounded inputs", () => {
    expect(() => assessEvidence("x", "y", [sample({ reliability: NaN })], now)).toThrow();
    expect(() => assessEvidence("x", "y", Array.from({ length: 201 }, (_, i) => sample({ id: String(i) })), now)).toThrow();
    expect(() => assessEvidence("", "y", [], now)).toThrow();
  });
  it("does not treat inference as certain knowledge", () => {
    const result = assessEvidence("обновление", "Тесты прошли",
      [sample({ origin: "inference", reliability: 0.4 })], now);
    expect(result.verdict).toBe("insufficient");
  });
});
