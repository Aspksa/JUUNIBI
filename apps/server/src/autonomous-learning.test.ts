import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AutonomousLearning, validateSettings } from "./autonomous-learning";

describe("autonomous learning", () => {
  it("rejects unsafe limits and mode", () => {
    expect(() => validateSettings({ dailyLimit: 51 })).toThrow();
    expect(() => validateSettings({ mode: "unrestricted" })).toThrow();
  });
  it("limits requests, persists state, quarantines answers and redacts secrets", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "juunibi-learning-"));
    try {
      const file = path.join(dir, "state.json");
      const ask = vi.fn(async () => ({ text: "token=secretvalue", tokens: 70 }));
      const engine = new AutonomousLearning(file, ask, () => ["brain"]);
      await engine.configure({ dailyLimit: 1 });
      expect(await engine.tick()).toEqual({ ok: true, verified: false });
      expect(await engine.tick()).toEqual({ skipped: "budget" });
      expect(ask).toHaveBeenCalledTimes(1);
      const restored = new AutonomousLearning(file, ask, () => []);
      await restored.load();
      expect(restored.status().used).toBe(1);
      expect(restored.status().events.some(e => e.status === "pending")).toBe(true);
      expect(JSON.stringify(restored.status())).not.toContain("secretvalue");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("checks arithmetic independently and never promotes open-domain replies", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "juunibi-check-"));
    try {
      const ask = vi.fn(async (q: string) => {
        const match = /Вычисли (\d+) × (\d+)/.exec(q);
        return { text: match ? String(Number(match[1]) * Number(match[2])) : "Непроверенная гипотеза", tokens: 20 };
      });
      const learner = new AutonomousLearning(path.join(dir, "learn.json"), ask, () => []);
      await learner.tick();
      await learner.tick();
      expect((await learner.tick())).toEqual({ ok: true, verified: true });
      const statuses = learner.status().events.filter(e => e.role === "verifier").map(e => e.status);
      expect(statuses).toEqual(["pending", "pending", "verified"]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("promotes only independently correct arithmetic and respects memory setting", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "juunibi-promote-"));
    try {
      const saved: string[] = [];
      const answer = async (q: string) => {
        const m = /Вычисли (\d+) × (\d+)/.exec(q);
        return { text: m ? String(Number(m[1]) * Number(m[2])) : "unverified", tokens: 10 };
      };
      const learner = new AutonomousLearning(path.join(dir, "a.json"), answer, () => [],
        async (fact) => { saved.push(fact.claim); });
      await learner.tick();
      await learner.tick();
      expect((await learner.tick())).toEqual({ ok: true, verified: true });
      expect(saved).toHaveLength(1);
      await learner.configure({ memory: false });
      for (let i = 0; i < 7; i++) await learner.tick();
      expect(saved).toHaveLength(1);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("does not invoke the model when disabled", async () => {
    const ask = vi.fn();
    const e = new AutonomousLearning("unused", ask, () => []);
    await e.configure({ enabled: false });
    expect(await e.tick()).toEqual({ skipped: "disabled" });
    expect(ask).not.toHaveBeenCalled();
  });
});
