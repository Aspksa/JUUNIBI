import { expect, it } from "vitest";
import { Assistant } from "./assistant";
import type { Message } from "./llm";
import { reviewDangerousTool } from "./action-review";
import type { Tool } from "./tools";

const plan={purpose:"Publish the verified release",expectedEffect:"Makes the release public",recovery:"Revert the release or document irreversibility",checks:["Verify release assets and destination"]};
const base:Tool={name:"publish_release",description:"Publish release",risk:"danger",parameters:{type:"object",properties:{}},run:()=> "published"};
const llm=()=>{let calls=0;return {chat:async(_messages:Message[])=>calls++===0?{content:null,toolCalls:[{id:"1",name:"publish_release",arguments:"{}"}]}:{content:"done",toolCalls:[]}}};
it("denies an unreviewed danger tool before requesting approval",async()=>{
 let ran=0,approvals=0;
 const assistant=new Assistant({llm:llm(),maxSteps:2,approve:()=>{approvals++;return true;}});
 assistant.tools.register({...base,run:()=>{ran++;return "published";}});
 await assistant.ask("Publish");
 expect(ran).toBe(0);expect(approvals).toBe(0);
});
it("requires both trusted structured plan and independent approval",async()=>{
 let ran=0;
 const deny=new Assistant({llm:llm(),maxSteps:2,approve:()=>false});
 deny.tools.register({...base,actionPlan:plan,run:()=>{ran++;return "published";}});
 await deny.ask("Publish");
 expect(ran).toBe(0);
 const allow=new Assistant({llm:llm(),maxSteps:2,approve:()=>true});
 allow.tools.register({...base,actionPlan:plan,run:()=>{ran++;return "published";}});
 await allow.ask("Publish");
 expect(ran).toBe(1);
});
it("rejects incomplete plans and leaves ordinary read tools unaffected",()=>{
 expect(reviewDangerousTool({...base,actionPlan:{...plan,checks:[]}}).valid).toBe(false);
 expect(reviewDangerousTool({...base,risk:"read"}).valid).toBe(true);
});
