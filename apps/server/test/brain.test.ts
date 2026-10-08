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

  it("persists state and restores plans on restart", async () => {
    let saved: string | null = null;
    const store = { load: async () => saved, save: async (value: string) => { saved = value; } };
    const first = new BrainCore(() => true, store);
    first.setMode("agent");
    const plan = first.plan("audit", ["modules"]);
    await first.flush();
    const second = new BrainCore(() => true, store);
    await second.load();
    expect(second.status().mode).toBe("agent");
    expect(second.status().plans[0]?.id).toBe(plan.id);
  });
  it("executes a safe sequence in order and stops on failures", async () => {
    const brain = new BrainCore(() => true);
    const plan = brain.plan("inspect", ["modules", "memory"]);
    const result = await brain.executeSequence(plan.id, ["list_modules", "search_memory"], () => ["brain"], async q => [q]);
    expect(result.results).toEqual([["brain"], ["memory"]]);
    expect(result.plan?.status).toBe("completed");
    await expect(brain.executeSequence(plan.id, ["list_modules", "search_memory"], () => [], async () => [])).rejects.toThrow();
  });

  it("rejects unsafe automatic sequences without executing any steps", async () => {
    const brain = new BrainCore(() => true);
    const p = brain.plan("inspect", ["modules"]);
    await expect(brain.executeSequence(p.id, ["shell"], () => { throw new Error("must not run"); }, async () => [])).rejects.toThrow("Недопустимые действия");
    expect(brain.status().plans[0]?.steps[0]?.status).toBe("pending");
  });
  it("stops on the first failed step and leaves later steps pending", async () => {
    const brain = new BrainCore(() => true);
    const p = brain.plan("inspect", ["missing", "modules"]);
    await expect(brain.executeSequence(p.id, ["search_memory", "list_modules"], () => ["modules"], async () => { throw new Error("lookup failed"); })).rejects.toThrow("lookup failed");
    expect(brain.status().plans[0]?.steps.map(s => s.status)).toEqual(["failed", "pending"]);
  });

  it("prevents skipping planned steps or running them out of order", async () => {
    const brain = new BrainCore(() => true);
    const plan = brain.plan("check", ["first", "second"]);
    expect(() => brain.updateStep(plan.id, plan.steps[1]!.id, "active")).toThrow("Нельзя пропускать шаги");
    await expect(brain.executeReadStep(plan.id, plan.steps[1]!.id, "list_modules", () => [], async () => [])).rejects.toThrow("Предыдущие шаги");
    expect(plan.steps.map(s => s.status)).toEqual(["pending", "pending"]);
    await brain.executeReadStep(plan.id, plan.steps[0]!.id, "list_modules", () => [], async () => []);
    expect((await brain.executeReadStep(plan.id, plan.steps[1]!.id, "list_modules", () => [], async () => [])).plan?.status).toBe("completed");
  });

  it("does not mark a step verified if its tool returns no result", async () => {
    const brain = new BrainCore(() => true);
    const plan = brain.plan("check", ["first", "second"]);
    await expect(brain.executeReadStep(plan.id, plan.steps[0]!.id, "list_modules", () => undefined, async () => [])).rejects.toThrow("проверяемый результат");
    expect(brain.status().plans[0]?.steps.map(s => s.status)).toEqual(["failed", "pending"]);
    expect(brain.history().some(e => e.outcome.startsWith("verified:"))).toBe(false);
  });

});
