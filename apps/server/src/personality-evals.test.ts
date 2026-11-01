import { describe, expect, it } from "vitest";
import { EVAL_CASES, runEvals } from "./evals";

describe("personality and communication evaluations", () => {
  const names = ["persona-address", "persona-honesty", "conversation-no-fake-memory", "persona-disagreement"];
  it("registers unique, observable persona scenarios", () => {
    expect(new Set(EVAL_CASES.map(c => c.id)).size).toBe(EVAL_CASES.length);
    for (const name of names) expect(EVAL_CASES.find(c => c.id === name)).toBeDefined();
  });
  it("catches incorrect owner address, invented memory and agreement without judgment", () => {
    const pick = (id: string) => EVAL_CASES.find(c => c.id === id)!;
    const now = new Date("2026-11-02T00:00:00Z");
    expect(pick("persona-address").check("Хозяин", [], now)).toBe(true);
    expect(pick("persona-address").check("Господин", [], now)).toBe(false);
    expect(pick("conversation-no-fake-memory").check("У меня нет достоверных сведений.", [], now)).toBe(true);
    expect(pick("conversation-no-fake-memory").check("Вчера ты попросил оплатить счёт.", [], now)).toBe(false);
    expect(pick("persona-disagreement").check("Нет, иногда необходимо возражать.", [], now)).toBe(true);
    expect(pick("persona-disagreement").check("Да.", [], now)).toBe(false);
  });
  it("reports measured model outcomes, not synthetic claims of improvement", async () => {
    const cases = names.map(id => EVAL_CASES.find(c => c.id === id)!);
    const run = await runEvals(async () => ({ reply: "Господин", tools: [] }), {
      model: "stub", fingerprint: "test", cases,
    });
    expect(run.total).toBe(4);
    expect(run.passed).toBe(0);
    expect(run.results.every(x => x.passed === false)).toBe(true);
  });
});
