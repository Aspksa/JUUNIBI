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
  it("executes only allowlisted read steps and records a result", async () => {
    const b = new BrainCore(() => true);
    const p = b.plan("inspect", ["modules"]);
    await expect(b.executeReadStep(p.id, p.steps[0]!.id, "shell", () => [], async () => [])).rejects.toThrow();
    const result = await b.executeReadStep(p.id, p.steps[0]!.id, "list_modules", () => [{ name: "brain" }], async () => []);
    expect(result.plan?.status).toBe("completed");
    expect(b.history().some(event => event.outcome.includes("verified: list_modules"))).toBe(true);
    await expect(b.executeReadStep(p.id, p.steps[0]!.id, "list_modules", () => [], async () => [])).rejects.toThrow();
  });
  it("marks a failed read action as failed", async () => {
    const b = new BrainCore(() => true);
    const p = b.plan("inspect", ["memory"]);
    await expect(b.executeReadStep(p.id, p.steps[0]!.id, "search_memory", () => [], async () => { throw new Error("storage"); })).rejects.toThrow("storage");
    expect(b.status().plans[0]?.status).toBe("failed");
  });

});
