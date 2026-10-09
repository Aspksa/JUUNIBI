import {expect,it} from "vitest";
import {assessRevisionFreshness} from "./revision-freshness";
import type {RevisionEntry} from "./revision-history";
const base={claimId:"claim",proposed:false,now:"2026-10-09T12:00:00Z",maxAgeDays:30};
const prior:RevisionEntry={id:"r",claimId:"claim",previous:true,proposed:false,reason:"unsupported",at:"2026-10-01T12:00:00Z",outcome:"rejected"};
it("distinguishes stale evidence and new evidence since rejection",()=>{
 const result=assessRevisionFreshness({...base,evidence:[
 {id:"old",claimId:"claim",supports:true,verified:true,observedAt:"2026-01-01T12:00:00Z"},
 {id:"fresh",claimId:"claim",supports:true,verified:true,observedAt:"2026-10-08T12:00:00Z"}]},[prior]);
 expect(result).toMatchObject({stale:1,positive:1,previouslyRejected:true,newSinceRejection:true,requiresApproval:true});
});
it("warns on repeated unsupported claims and rejects invalid input",()=>{
 const value=assessRevisionFreshness({...base,evidence:[{id:"known",claimId:"claim",supports:true,verified:true,observedAt:"2026-09-30T12:00:00Z"}]},[prior]);
 expect(value.newSinceRejection).toBe(false);
 expect(value.recommendation).toContain("без новых");
 expect(()=>assessRevisionFreshness({...base,maxAgeDays:-1,evidence:[]},[])).toThrow();
});
