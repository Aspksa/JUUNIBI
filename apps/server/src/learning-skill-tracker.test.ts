import { expect, it } from "vitest";
import { LearningSkillTracker } from "./learning-skill-tracker";
it("measures seven aspects without trusting arbitrary text",()=>{
 const tracker=new LearningSkillTracker();
 for(let i=0;i<6;i++) tracker.record({skill:"logic",phase:i===0?"retention":i===1?"generalization":"practice",correct:i===0,turn:i+1});
 const summary=tracker.summary();
 expect(summary.logic.attempts).toBe(6);
 expect(summary.logic.confidence).toBe("measured");
 expect(summary.logic.needsPractice).toBe(true);
 expect(summary.logic.retentionAccuracy).toBe(100);
 expect(summary.logic.generalizationAccuracy).toBe(0);
 expect(tracker.weakest()).toBe("logic");
 const restored=new LearningSkillTracker();restored.load([...tracker.snapshot(),{skill:"unknown",phase:"practice",correct:true,turn:1}]);
 expect(restored.summary().logic.attempts).toBe(6);
 expect(restored.weakest()).toBe("logic");
});
it("keeps only bounded valid data and does not assert skill on sparse observations",()=>{
 const tracker=new LearningSkillTracker();
 tracker.load(Array.from({length:300},(_,i)=>({skill:"arithmetic",phase:"practice",correct:i%2===0,turn:i})));
 expect(tracker.snapshot()).toHaveLength(180);
 expect(tracker.summary().arithmetic.attempts).toBe(180);
 expect(tracker.summary().transfer.confidence).toBe("insufficient");
});
