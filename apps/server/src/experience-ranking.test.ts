import { expect,it } from "vitest";
import { rankWithExperience } from "./experience-ranking";
import type { DecisionRecord } from "./decision-memory";
const sample=(chosen:string,observed:"success"|"failure",i:number):DecisionRecord=>({id:String(i),at:"2026-01-01",goal:"test",chosen,reason:"test",predictedSuccess:true,observed});
it("uses only >=3 confirmed outcomes and never overrides hard feasibility",()=>{
 const options=[{id:"a",baseScore:10,feasible:true},{id:"b",baseScore:12,feasible:true},{id:"c",baseScore:100,feasible:false}];
 const history=[sample("a","success",1),sample("a","success",2),sample("a","success",3)];
 const ranked=rankWithExperience(options,history);
 expect(ranked[0]).toMatchObject({id:"a",adjustment:5,evidenceCount:3});
 expect(ranked.at(-1)?.id).toBe("c");
 expect(rankWithExperience(options,history,false)[0]?.id).toBe("b");
 expect(rankWithExperience(options,history.slice(0,2))[0]?.id).toBe("b");
});
it("limits negative influence and validates options",()=>{
 const result=rankWithExperience([{id:"a",baseScore:10,feasible:true}],Array.from({length:30},(_,i)=>sample("a","failure",i)));
 expect(result[0]!.adjustment).toBe(-5);
 expect(()=>rankWithExperience([{id:"a",baseScore:Infinity,feasible:true}],[])).toThrow();
});
