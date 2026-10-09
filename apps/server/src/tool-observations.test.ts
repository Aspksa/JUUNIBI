import { expect, it } from "vitest";
import { BrainCore } from "./brain";
import { Assistant } from "@juunibi/assistant";
import type { Message } from "@juunibi/assistant";
it("collects tool outcome metadata and persists it without tool output or arguments",async()=>{
 let saved="";
 const storage={load:async()=>saved||null,save:async(s:string)=>{saved=s;}};
 const brain=new BrainCore(()=>true,storage);
 let turns=0;
 const assistant=new Assistant({llm:{chat:async(_messages:Message[])=>turns++===0?{content:null,toolCalls:[{id:"c",name:"list_modules",arguments:"{}"}]}:{content:"Done",toolCalls:[]}},onToolOutcome:event=>brain.observeToolOutcome(event)});
 await assistant.ask("Show modules");
 await brain.flush();
 expect(brain.toolOutcomeHistory()).toHaveLength(1);
 expect(brain.toolOutcomeHistory()[0]).toMatchObject({tool:"list_modules",status:"ok",risk:"read"});
 expect(saved).not.toContain("Done");
 const restored=new BrainCore(()=>true,storage);
 await restored.load();
 expect(restored.toolOutcomeHistory()).toHaveLength(1);
});
it("rejects invalid observations and retains a bounded history",()=>{
 const brain=new BrainCore(()=>true);
 brain.observeToolOutcome({tool:"bad tool",status:"ok",risk:"read",elapsedMs:0});
 expect(brain.toolOutcomeHistory()).toHaveLength(0);
 for(let i=0;i<120;i++)brain.observeToolOutcome({tool:"search_memory",status:"denied",risk:"read",elapsedMs:i});
 expect(brain.toolOutcomeHistory()).toHaveLength(100);
});
