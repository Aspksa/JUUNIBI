import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AutonomousLearning } from "./autonomous-learning";
describe("Brain 4.5 integrated grading", () => {
  it("records failed structured reasoning without promoting its answer", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "juunibi-brain45-"));
    try {
      const promoted: string[] = [];
      const learner = new AutonomousLearning(path.join(dir, "state.json"),
        async () => ({ text: "incorrect", tokens: 10 }), () => [],
        async fact => { promoted.push(fact.claim); });
      await learner.tick();
      await learner.tick();
      const stats = learner.status();
      expect(stats.reasoningMetrics.reduce((n, x) => n + x.attempts, 0)).toBe(1);
      expect(stats.reasoningMetrics.find(m => m.attempts)?.correct).toBe(0);
      expect(stats.events.filter(e => e.role === "verifier").at(-1)?.status).toBe("rejected");
      expect(promoted).toHaveLength(0);
      const recovered = new AutonomousLearning(path.join(dir, "state.json"),
        async () => ({ text: "incorrect", tokens: 10 }), () => []);
      await recovered.load();
      expect(recovered.status().reasoningMetrics).toEqual(stats.reasoningMetrics);
    } finally { await rm(dir, { recursive:true, force:true }); }
  });
});
