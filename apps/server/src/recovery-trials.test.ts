import {expect,it} from "vitest";
import {RecoveryTrials} from "./recovery-trials";
import type {ToolObservation} from "./tool-failure-patterns";
const entry=(status:ToolObservation["status"]):ToolObservation=>({tool:"search",status,risk:"read",elapsedMs:12,at:"2026-10-09T00:00:00Z"});
it("requires attestation and three real baseline observations",()=>{
 const r=new RecoveryTrials();
 expect(()=>r.create("search","Check prerequisites",false,[entry("error"),entry("error"),entry("ok")])).toThrow();
 expect(()=>r.create("search","Check prerequisites",true,[entry("error")])).toThrow();
});
it("compares three later tool events to real baseline, persists results and preserves denied count",()=>{
 const r=new RecoveryTrials(),history=[entry("error"),entry("denied"),entry("error")];
 const trial=r.create("search","Check prerequisites",true,history);
 expect(trial.baseline).toEqual({ok:0,error:2,denied:1});
 expect(()=>r.create("search","New diagnostic",true,history)).toThrow();
 r.observe({tool:"search",status:"ok"});
 r.observe({tool:"search",status:"denied"});
 expect(r.report().trials[0]?.comparison).toBe("insufficient");
 r.observe({tool:"search",status:"ok"});
 expect(r.report().trials[0]?.comparison).toBe("fewer_errors");
 expect(r.report().trials[0]?.after.denied).toBe(1);
 const restored=new RecoveryTrials();restored.load(r.snapshot());
 expect(restored.report().trials[0]?.status).toBe("completed");
 expect(r.observe({tool:"search",status:"error"})).toBe(false);
});
