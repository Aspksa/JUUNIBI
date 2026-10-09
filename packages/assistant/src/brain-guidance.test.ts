import { expect, it } from "vitest";
import { Assistant } from "./assistant";
import type { Message } from "./llm";

it("passes server task classification into the model context without granting permission",async()=>{
 let captured:Message[]=[];
 const llm={chat:async(messages:Message[])=>{captured=messages;return {content:"Подготовлю план, действия не выполняю.",toolCalls:[]};}};
 const assistant=new Assistant({llm,maxSteps:1});
 await assistant.ask("Обнови проект","test",undefined,{brainGuidance:{needsPlanning:true,needsApproval:true,needsEvidenceReview:true}});
 const system=captured.filter(m=>m.role==="system").map(m=>m.content).join("\n");
 expect(system).toContain("сначала сформулируй план");
 expect(system).toContain("проверенные сведения");
 expect(system).toContain("ApprovalGate");
 expect(system).toContain("не являются разрешением");
});
it("keeps the default path unchanged without a brain classification",async()=>{
 let systemMessages=0;
 const assistant=new Assistant({llm:{chat:async(messages:Message[])=>{systemMessages=messages.filter(m=>m.role==="system").length;return {content:"OK",toolCalls:[]};}},maxSteps:1});
 await assistant.ask("Привет","test");
 expect(systemMessages).toBe(1);
});
