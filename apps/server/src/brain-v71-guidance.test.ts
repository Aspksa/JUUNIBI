import { describe, expect, it } from "vitest";
import { automaticBrainReview } from "./brain-v41-automatic";

describe("Brain 7.1 guidance quality", () => {
 it("promotes an independently checked arithmetic mismatch into useful guidance", () => {
  const incorrect = automaticBrainReview({message:"12 + 7 = 20"});
  const correct = automaticBrainReview({message:"12 + 7 = 19"});
  expect(incorrect.guidance.evidenceWarnings.join(" ")).toContain("19");
  expect(correct.guidance.evidenceWarnings.join(" ")).not.toContain("арифметическая ошибка");
  expect(incorrect.guidance.needsPlanning).toBe(true);
 });
 it("uses confirmed warning history but never grants permissions", () => {
  const r = automaticBrainReview({message:"Проверь",recentToolWarnings:[{tool:"filesystem",caution:true,denied:2}]});
  expect(r.guidance.evidenceWarnings.join(" ")).toContain("отказы инструментов");
  expect(r.cycle.reviewV7.actionsExecuted).toBe(false);
 });
 it("does not claim improvement or correctness without an independent benchmark", () => {
  const r = automaticBrainReview({message:"Привет"});
  expect(r.guidance.evidenceWarnings.join(" ")).toContain("не измерены");
 });
});