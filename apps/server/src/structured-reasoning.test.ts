import { describe, it, expect } from "vitest";
import { makeStructuredTask, gradeStructuredTask } from "./structured-reasoning";
describe("Brain 4.5 structural reasoning", () => {
  for (const category of ["multi-step", "error-detection", "rule-transfer"] as const) {
    it("independently checks " + category, () => {
      for (let turn = 1; turn <= 30; turn++) {
        const task = makeStructuredTask(category, turn, 1 + turn % 5);
        expect(gradeStructuredTask(task, task.expected).correct).toBe(true);
        expect(gradeStructuredTask(task, "invalid").correct).toBe(false);
        expect(task.question).not.toContain(task.expected + " is correct");
      }
    });
  }
  it("identifies first wrong intermediate step", () => {
    const t = makeStructuredTask("multi-step", 3);
    const corrupted = [t.steps[0], t.steps[1]+1, t.steps[2]].join(",");
    expect(gradeStructuredTask(t, corrupted)).toEqual({ correct:false, firstIncorrectStep:2 });
    expect(gradeStructuredTask(t, "1,2")).toEqual({ correct:false, firstIncorrectStep:1 });
  });
});
