import { describe, expect, it } from "vitest";
import { BrainCore } from "./brain";

describe("grounded cognitive plan review", () => {
  it("uses failed steps and tool events without mutating the plan", () => {
    const brain = new BrainCore(() => true);
    const plan = brain.plan("Investigate failure", ["Find logs", "Repair issue"]);
    brain.updateStep(plan.id, plan.steps[0]!.id, "active");
    brain.updateStep(plan.id, plan.steps[0]!.id, "done");
    brain.updateStep(plan.id, plan.steps[1]!.id, "active");
    brain.updateStep(plan.id, plan.steps[1]!.id, "failed");
    brain.observeToolOutcome({tool:"read_file",status:"error",risk:"read",elapsedMs:1});
    const previous = brain.status().plans;
    const review = brain.reviewLivePlan(plan.id);
    expect(review).toMatchObject({planId:plan.id,source:"saved-plan-and-tool-outcomes",requiresExplicitExecution:true,observationsCount:2,replanning:{blockedAt:"Repair issue",needsReplan:true}});
    expect(review.causalAnalysis[0]?.matchedEvidence).toContain("tool-error:read_file");
    expect(review.reusableStrategies).toEqual([]);
    expect(brain.status().plans).toEqual(previous);
  });
  it("rejects missing plans and does not fabricate evidence", () => {
    const brain = new BrainCore(() => true);
    expect(() => brain.reviewLivePlan("missing")).toThrow("План не найден");
    const plan = brain.plan("Investigate", ["Check"]);
    const review = brain.reviewLivePlan(plan.id);
    expect(review.observationsCount).toBe(0);
    expect(review.causalAnalysis).toEqual([]);
    expect(review.replanning).toMatchObject({nextStep:"Check",needsReplan:false});
  });
});
