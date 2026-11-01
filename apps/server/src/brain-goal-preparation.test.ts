import { describe, expect, it } from "vitest";
import { prepareBrainGoal } from "./brain-goal-preparation";
describe("brain goal preparation", () => {
  it("never executes actions and requests approval", () => {
    const result = prepareBrainGoal({ goal: "Создать план" });
    expect(result.executesAutomatically).toBe(false);
    expect(result.requiresOwnerApproval).toBe(true);
    expect(result.missing).toContain("verified-evidence");
    expect(result.steps).toHaveLength(5);
  });
  it("detects stale and contradictory evidence", () => {
    const result = prepareBrainGoal({ goal: "Проверить", evidence: [
      { claim: "сервис работает", source: "a", verified: true, reviewedAt: "2020-01-01" },
      { claim: "не сервис работает", source: "b", verified: true, reviewedAt: "2020-01-01" }
    ] }, Date.parse("2026-01-01"));
    expect(result.staleClaims).toHaveLength(2);
    expect(result.potentialContradictions.length).toBeGreaterThan(0);
  });
  it("identifies recurring failures without asserting certainty", () => {
    const result = prepareBrainGoal({ goal: "Выбрать стратегию", outcomes: [
      { strategy: "A", success: false, observedAt: "2026-01-01" },
      { strategy: "A", success: false, observedAt: "2026-01-02" }
    ] });
    expect(result.strategies[0]?.recurringFailure).toBe(true);
    expect(result.strategies[0]?.estimatedSuccess).toBeGreaterThan(0);
  });
});
