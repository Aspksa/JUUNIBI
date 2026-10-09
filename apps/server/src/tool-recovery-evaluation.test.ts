import { expect, it } from "vitest";
import { assessToolRecovery } from "./tool-recovery-evaluation";
import type { ToolObservation } from "./tool-failure-patterns";
const obs=(status:ToolObservation["status"],tool="search"):ToolObservation=>({tool,status,risk:"read",elapsedMs:10,at:"2026-10-09T00:00:00.000Z"});
it("compares fresh errors against earlier errors without running tools",()=>{
 const report=assessToolRecovery([obs("ok"),obs("ok"),obs("ok"),obs("error"),obs("error"),obs("error")]);
 expect(report.tools[0]?.trend).toBe("improved");
 expect(report.tools[0]?.previousErrors).toBe(3);
 expect(report.tools[0]?.recentErrors).toBe(0);
 expect(report.readOnly).toBe(true);
 expect(report.requiresOwnerConfirmation).toBe(true);
});
it("distinguishes denials and technical regressions",()=>{
 const report=assessToolRecovery([obs("error"),obs("error"),obs("denied"),obs("ok"),obs("ok"),obs("ok")]);
 expect(report.tools[0]?.trend).toBe("worsened");
 expect(report.tools[0]?.recentDenials).toBe(1);
 expect(report.tools[0]?.plan.join(" ")).toContain("владельца");
});
it("does not claim improvement with insufficient evidence",()=>{
 const report=assessToolRecovery([obs("error")]);
 expect(report.tools[0]?.trend).toBe("insufficient");
 expect(report.tools[0]?.previousErrors).toBeNull();
 expect(()=>assessToolRecovery(Array.from({length:101},()=>obs("ok")))).toThrow();
});
