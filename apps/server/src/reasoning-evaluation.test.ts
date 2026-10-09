import { expect, it } from "vitest";
import { ReasoningEvaluation } from "./reasoning-evaluation";
it("tracks category-specific success, failures and recovery", () => {
  const progress = new ReasoningEvaluation();
  for (let i=0;i<9;i++) {
    const task = progress.next(i+1,2);
    progress.evaluate(task, i%2===0 ? task.expected : "wrong");
  }
  expect(progress.summary().reduce((n, x)=>n+x.attempts,0)).toBe(9);
  const restored = new ReasoningEvaluation();
  restored.load(progress.snapshot());
  expect(restored.summary()).toEqual(progress.summary());
});
it("validates saved records", () => {
  const tracker = new ReasoningEvaluation();
  tracker.load([{category:"bogus",correct:true,at:"now",errorStep:null}]);
  expect(tracker.summary().every(x=>x.attempts===0)).toBe(true);
});
