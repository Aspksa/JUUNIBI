import {expect,it} from "vitest";
import {analyzeToolFailures} from "./tool-failure-patterns";
import {BrainCore} from "./brain";
const obs=(tool:string,status:"ok"|"error"|"denied",at:string)=>({tool,status,risk:"read" as const,elapsedMs:10,at});
it("identifies repeated real tool errors and keeps denials separate",()=>{
 const r=analyzeToolFailures([obs("search_memory","error","2026-10-09T12:00:00Z"),obs("search_memory","error","2026-10-09T13:00:00Z"),obs("search_memory","denied","2026-10-09T14:00:00Z"),obs("list_modules","ok","2026-10-09T13:00:00Z")]);
 expect(r.patterns[0]).toMatchObject({tool:"search_memory",errors:2,denials:1,recurring:true,failureRate:100});
 expect(r.patterns[0]?.lastFailureAt).toBe("2026-10-09T14:00:00Z");
 expect(r.patterns[1]).toMatchObject({tool:"list_modules",recurring:false,successes:1});
 expect(r.requiresApproval).toBe(true);
});
it("does not flag repeated approval denials as tool errors",()=>{
 const r=analyzeToolFailures([obs("publish","denied","2026-10-09T12:00:00Z"),obs("publish","denied","2026-10-09T13:00:00Z")]);
 expect(r.patterns[0]?.recurring).toBe(false);
 expect(r.patterns[0]?.recommendation).toContain("полномочия");
});
it("uses BrainCore recorded history without altering decisions",()=>{
 const b=new BrainCore(()=>true);
 b.observeToolOutcome({tool:"lookup",status:"error",risk:"read",elapsedMs:12});
 b.observeToolOutcome({tool:"lookup",status:"error",risk:"read",elapsedMs:14});
 expect(b.toolFailurePatterns().patterns[0]?.recurring).toBe(true);
 expect(b.decisionHistory().records).toHaveLength(0);
});
it("rejects invalid metadata",()=>{
 expect(()=>analyzeToolFailures([obs("bad tool","error","2026-10-09T12:00:00Z")])).toThrow();
 expect(()=>analyzeToolFailures([obs("valid","error","not a date")])).toThrow();
});
