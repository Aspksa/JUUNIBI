import {expect,it} from "vitest";
import {classifyChatTask} from "./chat-task-triage";
import {BrainCore} from "./brain";
it("marks simple questions without planning or approval",()=>{
 const result=classifyChatTask("Привет! Как дела?");
 expect(result.needsPlanning).toBe(false);
 expect(result.needsApproval).toBe(false);
});
it("flags complex and potentially destructive requests without granting approval",()=>{
 const result=new BrainCore(()=>true).classifyTask("Сначала проверь проект, затем обнови его");
 expect(result.needsPlanning).toBe(true);
 expect(result.needsApproval).toBe(true);
 expect(result.needsEvidenceReview).toBe(true);
});
it("rejects malformed input and never executes tools",()=>{
 expect(()=>classifyChatTask(null)).toThrow();
 expect(()=>classifyChatTask("x".repeat(100001))).toThrow();
 expect(classifyChatTask("Публикуй релиз").suggestedStages).toContain("ask-approval");
});
