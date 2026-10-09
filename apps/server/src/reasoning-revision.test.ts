import {expect,it} from "vitest";
import {reviewReasoningRevision} from "./reasoning-revision";
const claim={id:"hypothesis",stance:true,evidenceIds:["e1","e2","e3"]};
const evidence=[{id:"e1",supports:false,verified:true},{id:"e2",supports:false,verified:true},{id:"e3",supports:false,verified:true}];
it("proposes revision from opposing verified evidence without executing",()=>{
 const examples=[{id:"test1",expected:true,predicted:true,verified:true},{id:"test2",expected:false,predicted:true,verified:true},{id:"test3",expected:true,predicted:true,verified:true}];
 const result=reviewReasoningRevision(examples,claim,evidence);
 expect(result.proposedStance).toBe(false);
 expect(result.tests).toMatchObject({verified:3,correct:2});
 expect(result.confidence).toBe("moderate");
 expect(result.requiresApproval).toBe(true);
 expect(claim.stance).toBe(true);
});
it("ignores unchecked examples and evidence and reports missing sources",()=>{
 const result=reviewReasoningRevision([{id:"test",expected:false,predicted:false,verified:false}],claim,evidence.map(e=>({...e,verified:false})));
 expect(result.tests.accuracy).toBeNull();
 expect(result.proposedStance).toBeNull();
 expect(result.evidence.missing).toHaveLength(3);
});
it("rejects duplicate evidence and examples",()=>{
 expect(()=>reviewReasoningRevision([],claim,[evidence[0]!,evidence[0]!])).toThrow();
});
