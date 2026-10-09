import { expect,it } from "vitest";
import { DecisionMemory } from "./decision-memory";
it("records predictions and counts only owner-confirmed results",()=>{
 const m=new DecisionMemory();
 const a=m.record({goal:"Improve search",chosen:"plan-a",reason:"lower cost",predictedSuccess:true});
 expect(m.summary().predictionAccuracy).toBeNull();
 expect(m.confirm(a.id,"success").observed).toBe("success");
 expect(m.summary()).toMatchObject({total:1,confirmed:1,predictionAccuracy:100});
 expect(()=>m.confirm(a.id,"failure")).toThrow();
 const other=new DecisionMemory();other.load(m.snapshot());
 expect(other.summary().confirmed).toBe(1);
});
it("rejects invalid entries and observations",()=>{
 const m=new DecisionMemory();
 expect(()=>m.record({goal:"",chosen:"x",reason:"test",predictedSuccess:true})).toThrow();
 const d=m.record({goal:"G",chosen:"x",reason:"test",predictedSuccess:false});
 expect(()=>m.confirm(d.id,"unknown" as "success")).toThrow();
 m.load([{id:"broken",goal:42}]);
 expect(m.summary().total).toBe(0);
});
