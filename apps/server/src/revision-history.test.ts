import {expect,it} from "vitest";
import {RevisionHistory} from "./revision-history";
import {BrainCore} from "./brain";
it("warns when a previously rejected revision is proposed again",()=>{
 const history=new RevisionHistory();
 const first=history.add({claimId:"hypothesis",previous:true,proposed:false,reason:"Weak evidence"});
 expect(history.warnings("hypothesis",false)).toEqual([]);
 history.resolve(first.id,"rejected");
 expect(history.warnings("hypothesis",false)).toHaveLength(1);
 const restored=new RevisionHistory();
 restored.load(history.snapshot());
 expect(restored.warnings("hypothesis",false)).toHaveLength(1);
 expect(()=>restored.resolve(first.id,"accepted")).toThrow();
});
it("persists revision review through existing BrainCore storage",async()=>{
 let data:string|null=null;
 const storage={load:async()=>data,save:async(v:string)=>{data=v;}};
 const brain=new BrainCore(()=>true,storage);
 const entry=brain.proposeRevision({claimId:"logic",previous:true,proposed:false,reason:"Contradiction"});
 brain.resolveRevision(entry.id,"rejected");
 await brain.flush();
 const restored=new BrainCore(()=>true,storage);
 await restored.load();
 expect(restored.revisionHistory()).toMatchObject([{id:entry.id,outcome:"rejected"}]);
 const repeated=restored.proposeRevision({claimId:"logic",previous:true,proposed:false,reason:"Retry"});
 expect(repeated.warnings).toHaveLength(1);
});
