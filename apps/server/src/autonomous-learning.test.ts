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
  it("does not invoke the model when disabled", async () => {
    const ask = vi.fn();
    const e = new AutonomousLearning("unused", ask, () => []);
    await e.configure({ enabled: false });
    expect(await e.tick()).toEqual({ skipped: "disabled" });
    expect(ask).not.toHaveBeenCalled();
  });
});
