import { describe, expect, it } from "vitest";
import { makeReasoningTask, checkReasoningAnswer } from "./reasoning-assessment";

describe("Brain 4.4 bounded reasoning assessments", () => {
  it("grades logic and transfers rules across unseen examples", () => {
    for (let turn = 1; turn <= 20; turn++) {
      for (const kind of ["logic", "transfer"] as const) {
        const task = makeReasoningTask(kind, turn);
        expect(checkReasoningAnswer(task, task.expected)).toBe(true);
        expect(checkReasoningAnswer(task, "wrong")).toBe(false);
        expect(task.question.length).toBeLessThan(500);
      }
    }
  });
});
