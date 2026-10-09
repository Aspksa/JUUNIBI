import {expect,it} from "vitest";
import {reviewReasoning} from "./reasoning-review";
const a={id:"a",proposition:"Connection works",stance:"true" as const,evidenceIds:["source"],dependsOn:[]};
it("identifies opposing claims and missing verification",()=>{
 const result=reviewReasoning([a,{...a,id:"b",stance:"false" as const,evidenceIds:[]}],[{id:"source",verified:true}]);
 expect(result.conflicts).toHaveLength(1);
 expect(result.reviewCount).toBe(2);
 expect(result.requiresApproval).toBe(true);
});
it("accepts consistent supported claims and rejects circular dependencies",()=>{
 expect(reviewReasoning([a],[{id:"source",verified:true}]).reviewCount).toBe(0);
 expect(()=>reviewReasoning([{...a,dependsOn:["b"]},{...a,id:"b",dependsOn:["a"]}],[])).toThrow();
});
