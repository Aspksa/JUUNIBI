import { describe, expect, it } from "vitest";
import { BrainCore } from "../src/brain";
describe("BrainCore", () => {
  it("starts without a model and validates modes", () => {
    const b = new BrainCore(() => false);
    expect(b.status()).toMatchObject({ mode: "chat", assistantReady: false, plans: [] });
    expect(() => b.setMode("unknown")).toThrow();
  });
  it("plans bounded tasks and enforces step transitions", () => {
    const b = new BrainCore(() => true);
    expect(() => b.plan("", ["step"])).toThrow();
    expect(() => b.plan("goal", [])).toThrow();
    const p = b.plan("goal", ["first", "second"]);
    expect(() => b.updateStep(p.id, p.steps[0]!.id, "done")).toThrow();
    b.updateStep(p.id, p.steps[0]!.id, "active");
    expect(() => b.updateStep(p.id, p.steps[1]!.id, "active")).toThrow();
    b.updateStep(p.id, p.steps[0]!.id, "done");
    b.updateStep(p.id, p.steps[1]!.id, "active");
    expect(b.updateStep(p.id, p.steps[1]!.id, "done").status).toBe("completed");
    expect(() => b.updateStep(p.id, p.steps[0]!.id, "active")).toThrow();
  });
});
