import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AutonomousLearning } from "./autonomous-learning";
import { automaticBrainReview } from "./brain-v41-automatic";

describe("learning engine fixes", () => {
 it("records a safe failure category and reloads it from disk", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "juunibi-learn-diagnostics-"));
  const filename = path.join(dir, "learn.json");
  try {
   const learner = new AutonomousLearning(filename, vi.fn(async () => { throw new Error("Cloud.ru status 401 token=secret"); }), () => []);
   expect(await learner.tick()).toEqual({ok:false});
   const status = learner.status();
   expect(status.lastError).toBe("Авторизация Cloud.ru отклонена (HTTP 401)");
   expect(status.lastAttemptAt).toMatch(/^\d{4}-/);
   expect(JSON.stringify(status)).not.toContain("secret");
   const other = new AutonomousLearning(filename, vi.fn(), () => []);
   await other.load();
   expect(other.status().lastOutcome).toBe("error");
   expect(other.status().lastError).toBe(status.lastError);
  } finally { await rm(dir, {recursive:true,force:true}); }
 });
 it("uses only verified matching knowledge for conversation", () => {
  const base = {message:"арифметика сложение", verifiedKnowledge:[
   {topic:"арифметика",claim:"сложение числа",status:"verified" as const},
   {topic:"арифметика",claim:"ложное утверждение",status:"needs-review" as const}
  ]};
  const result = automaticBrainReview(base);
  const warnings = result.guidance.evidenceWarnings.join(" ");
  expect(warnings).toContain("сложение числа");
  expect(warnings).not.toContain("ложное утверждение");
 });
});
