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

  it("persists the failure checkpoint before rejecting a tool call", async () => {
    let saved: string | null = null;
    const store = { load: async () => saved, save: async (value: string) => { saved = value; } };
    const brain = new BrainCore(() => true, store);
    const plan = brain.plan("check", ["look up"]);
    await expect(brain.executeReadStep(plan.id, plan.steps[0]!.id, "search_memory", () => [], async () => { throw new Error("tool offline"); })).rejects.toThrow("tool offline");
    const reloaded = new BrainCore(() => true, store);
    await reloaded.load();
    expect(reloaded.status().plans[0]?.steps[0]?.status).toBe("failed");
  });
  it("filters malformed persisted diagnostic records", async () => {
    const state = JSON.stringify({ mode: "chat", plans: [], logs: [
      {at:"invalid",planId:"x",stepId:"y",outcome:"bad"},
      {at:"2026-10-12T09:00:00.000Z",planId:"p",stepId:"s",outcome:"verified"}
    ] });
    const brain = new BrainCore(() => true, { load: async () => state, save: async () => {} });
    await brain.load();
    expect(brain.history()).toHaveLength(1);
  });

  it("rejects corrupted stored plan status and creation timestamps", async () => {
    const brain = new BrainCore(() => true);
    const plan = brain.plan("audit", ["step"]);
    const bad = { mode: "agent", plans: [{ ...plan, status: "unknown", createdAt: "broken" }], logs: [] };
    const restored = new BrainCore(() => true, { load: async () => JSON.stringify(bad), save: async () => {} });
    await expect(restored.load()).rejects.toThrow("Некорректные планы");
  });
  it("rejects duplicate restored step identifiers before execution", async () => {
    const original = new BrainCore(() => true);
    const plan = original.plan("inspect", ["one", "two"]);
    const corrupt = { mode: "chat", plans: [{ ...plan, steps: [plan.steps[0], { ...plan.steps[1], id: plan.steps[0]!.id }] }], logs: [] };
    const reloaded = new BrainCore(() => true, { load: async () => JSON.stringify(corrupt), save: async () => {} });
    await expect(reloaded.load()).rejects.toThrow("Повторные идентификаторы");
  });
  it("restores a partially completed plan as running, preserving verified steps", async () => {
    let data: string | null = null;
    const storage = { load: async () => data, save: async (value: string) => { data = value; } };
    const first = new BrainCore(() => true, storage);
    const plan = first.plan("audit", ["first", "second"]);
    await first.executeReadStep(plan.id, plan.steps[0]!.id, "list_modules", () => [], async () => []);
    const restarted = new BrainCore(() => true, storage);
    await restarted.load();
    expect(restarted.status().plans[0]).toMatchObject({ status: "running", steps: [{status: "done"}, {status: "pending"}] });
    const result = await restarted.resumeReadSequence(plan.id, ["search_memory"], () => [], async q => [q]);
    expect(result.skippedCompleted).toBe(1);
    expect(result.results).toEqual([["second"]]);
    expect(restarted.status().plans[0]?.status).toBe("completed");
  });
  it("marks interrupted active step failed without rerunning it on load", async () => {
    let data: string | null = null;
    const storage = { load: async () => data, save: async (value: string) => { data = value; } };
    const first = new BrainCore(() => true, storage);
    const plan = first.plan("check", ["read"]);
    first.updateStep(plan.id, plan.steps[0]!.id, "active");
    await first.flush();
    const restored = new BrainCore(() => true, storage);
    await restored.load();
    expect(restored.status().plans[0]).toMatchObject({status: "failed",steps:[{status: "failed"}]});
    await expect(restored.executeReadStep(plan.id, plan.steps[0]!.id, "list_modules", () => [], async () => [])).rejects.toThrow();
  });
  it("saves a retry counter before re-invoking a failed tool", async () => {
    let data: string | null = null;
    const storage = {load:async()=>data,save:async(v:string)=>{data=v;}};
    const first = new BrainCore(() => true, storage);
    const plan = first.plan("check", ["memory"]);
    await expect(first.executeReadStep(plan.id, plan.steps[0]!.id, "search_memory", () => [], async () => {throw Error("offline");})).rejects.toThrow();
    await first.retryFailedReadStep(plan.id, plan.steps[0]!.id, "search_memory", () => [], async () => {
      const snap = JSON.parse(data!);
      expect(snap.plans[0].steps[0].retries).toBe(1);
      expect(snap.plans[0].steps[0].status).toBe("active");
      return ["recovered"];
    });
    expect(first.status().plans[0]?.status).toBe("completed");
  });
  it("runs a verified cognitive batch without repeating finished steps", async () => {
    const brain = new BrainCore(() => true);
    const plan = brain.plan("inspect", ["modules", "memory", "modules again"]);
    const first = await brain.runCognitiveCycleBatch(plan.id, ["list_modules", "search_memory"], 2,
      () => ["brain"], async query => [query]);
    expect(first.checkpoints.map(x => x.result)).toEqual([["brain"], ["memory"]]);
    expect(first.remaining).toBe(1);
    expect(first.cognitiveState.verification.completedSteps).toHaveLength(2);
    let calls = 0;
    const last = await brain.runCognitiveCycleBatch(plan.id, ["list_modules"], 1,
      () => { calls++; return ["brain"]; }, async () => []);
    expect(calls).toBe(1);
    expect(last.skippedVerifiedSteps).toBe(2);
    expect(last.remaining).toBe(0);
    expect(last.cognitiveState.phase).toBe("completed");
  });
  it("rejects an unsafe cognitive batch before invoking any tools", async () => {
    const brain = new BrainCore(() => true);
    const plan = brain.plan("inspect", ["one", "two"]);
    let calls = 0;
    await expect(brain.runCognitiveCycleBatch(plan.id, ["list_modules", "shell"], 2,
      () => { calls++; return []; }, async () => [])).rejects.toThrow();
    expect(calls).toBe(0);
    expect(brain.status().plans[0]?.steps.map(x => x.status)).toEqual(["pending", "pending"]);
  });
  it("stops the cognitive batch on a failed tool and never runs later steps", async () => {
    const brain = new BrainCore(() => true);
    const plan = brain.plan("inspect", ["one", "two"]);
    let calls = 0;
    await expect(brain.runCognitiveCycleBatch(plan.id, ["search_memory", "list_modules"], 2,
      () => { calls++; return []; }, async () => { throw new Error("offline"); })).rejects.toThrow("offline");
    expect(calls).toBe(0);
    expect(brain.status().plans[0]?.steps.map(x => x.status)).toEqual(["failed", "pending"]);
  });
  it("does not allow manually failing a pending or completed step", async () => {
    const brain = new BrainCore(() => true);
    const plan = brain.plan("audit", ["one", "two"]);
    expect(() => brain.updateStep(plan.id, plan.steps[0]!.id, "failed")).toThrow("Ошибка допустима");
    expect(() => brain.updateStep(plan.id, plan.steps[1]!.id, "failed")).toThrow("Ошибка допустима");
    await brain.executeReadStep(plan.id, plan.steps[0]!.id, "list_modules", () => [], async () => []);
    expect(() => brain.updateStep(plan.id, plan.steps[0]!.id, "failed")).toThrow("Ошибка допустима");
    expect(brain.status().plans[0]?.steps.map(step => step.status)).toEqual(["done", "pending"]);
  });
  it("never invokes a tool if the initial active checkpoint cannot be persisted", async () => {
    let writes = 0;
    const brain = new BrainCore(() => true, {
      load: async () => null,
      save: async () => { writes++; throw new Error("disk unavailable"); },
    });
    const plan = brain.plan("inspect", ["modules"]);
    let invoked = 0;
    await expect(brain.executeReadStep(plan.id, plan.steps[0]!.id, "list_modules",
      () => { invoked++; return []; }, async () => [])).rejects.toThrow("disk unavailable");
    expect(invoked).toBe(0);
    expect(brain.status().plans[0]?.status).toBe("failed");
    expect(writes).toBeGreaterThan(0);
  });
  it("rejects oversized tool responses without storing them as verified evidence", async () => {
    const brain = new BrainCore(() => true);
    const plan = brain.plan("audit", ["read memory"]);
    await expect(brain.executeReadStep(plan.id, plan.steps[0]!.id, "search_memory",
      () => [], async () => ["x".repeat(70_000)])).rejects.toThrow("64 КиБ");
    expect(brain.status().plans[0]?.steps[0]?.status).toBe("failed");
    expect(brain.history().some(entry => entry.outcome.startsWith("verified:"))).toBe(false);
  });
  it("does not persist private tool results in the Brain audit trail", async () => {
    let saved: string | null = null;
    const store = { load: async () => saved, save: async (data: string) => { saved = data; } };
    const brain = new BrainCore(() => true, store);
    const plan = brain.plan("Find memory", ["lookup"]);
    const privateValue = "PRIVATE_TEST_CONTENT_NEVER_LOG_THIS";
    const output = await brain.executeReadStep(plan.id, plan.steps[0]!.id, "search_memory",
      () => [], async () => [privateValue]);
    expect(output.result).toEqual([privateValue]);
    await brain.flush();
    expect(brain.history().some(event => event.outcome.startsWith("verified:"))).toBe(true);
    expect(JSON.stringify(brain.history())).not.toContain(privateValue);
    expect(saved).not.toContain(privateValue);
    expect(JSON.stringify(brain.history())).toContain("items=1");
  });
  it("reports verified readiness and evidence quality without running tools", async () => {
    const brain = new BrainCore(() => true);
    const p = brain.plan("prepare", ["modules", "memory"]);
    expect(brain.executionReadiness(p.id)).toMatchObject({
      completed: 0, total: 2, canResumeReadOnly: true, requiresOwnerReview: false,
    });
    expect(brain.brainEvaluation().plans.total).toBe(1);
    expect(brain.brainEvaluation().security.writeActionsAvailable).toBe(false);
    await brain.executeReadStep(p.id, p.steps[0]!.id, "list_modules", () => [], async () => []);
    expect(brain.executionReadiness(p.id)).toMatchObject({
      completed: 1, verifiedCompleted: 1, canResumeReadOnly: true, missingEvidence: [],
    });
    await brain.executeReadStep(p.id, p.steps[1]!.id, "search_memory", () => [], async () => []);
    expect(brain.brainEvaluation()).toMatchObject({
      plans: {total:1,completed:1,failed:0,resumable:0},
      evidence: {verifiedCompletedSteps:2,missingVerifiedSteps:0},
    });
    expect(() => brain.executionReadiness("absent")).toThrow("План не найден");
  });
  it("detects inconsistent manual completion without verified evidence", () => {
    const brain = new BrainCore(() => true);
    const p = brain.plan("review", ["first", "second"]);
    brain.updateStep(p.id, p.steps[0]!.id, "active");
    brain.updateStep(p.id, p.steps[0]!.id, "done");
    const status = brain.executionReadiness(p.id);
    expect(status.missingEvidence).toEqual([p.steps[0]!.id]);
    expect(status.canResumeReadOnly).toBe(false);
    expect(status.requiresOwnerReview).toBe(true);
    expect(brain.brainEvaluation().evidence.missingVerifiedSteps).toBe(1);
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
