import { expect, it } from "vitest";
import { rankRecoveryStrategies } from "./recovery-strategy-ranking";
import type { RecoveryTrial } from "./recovery-trials";
const trial=(strategy:string, before:number,after:number,denials=0):RecoveryTrial=>({
 id:strategy+before+after,tool:"search",strategy,startedAt:"2026-10-09T00:00:00.000Z",
 baseline:{ok:3-before,error:before,denied:0},
 after:{ok:3-after-denials,error:after,denied:denials},status:"completed",window:3
});
it("requires multiple independently observed trials before recommending",()=>{
 const sparse=rankRecoveryStrategies([trial("Inspect file",3,0)],"search");
 expect(sparse.recommended).toBeNull();
 expect(sparse.candidates[0]?.confidence).toBe("insufficient");
 const complete=rankRecoveryStrategies([trial("Inspect file",2,0),trial("Inspect file",2,0),trial("Inspect file",2,0)],"search");
 expect(complete.recommended).toBe("Inspect file");
 expect(complete.candidates[0]?.reduction).toBe(6);
 expect(complete.advisoryOnly).toBe(true);
});
it("does not recommend strategies that were denied or that failed to reduce errors",()=>{
 const report=rankRecoveryStrategies([
  trial("Denied route",2,0,1),trial("Denied route",2,0,1),trial("Denied route",2,0,1),
  trial("Ineffective route",1,1),trial("Ineffective route",1,1),trial("Ineffective route",1,1)
 ],"search");
 expect(report.recommended).toBeNull();
 expect(report.candidates.every(x=>!x.eligible)).toBe(true);
 expect(report.requiresOwnerConfirmation).toBe(true);
});
it("rejects malformed tool and isolates unrelated tools",()=>{
 expect(()=>rankRecoveryStrategies([],"invalid tool")).toThrow();
 const report=rankRecoveryStrategies([{...trial("Other tool",3,0),tool:"other"}],"search");
 expect(report.candidates).toHaveLength(0);
});
