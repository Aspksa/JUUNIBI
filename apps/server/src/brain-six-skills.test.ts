import { describe, expect, it } from "vitest";
import { reviewSixSkills, type CognitiveInput } from "./brain-six-skills";

const input = (): CognitiveInput => ({
  goal:"Проверить сбой",
  observations:["network offline"],
  hypotheses:[{cause:"Network issue",evidence:["network offline"]},{cause:"Unknown cause",evidence:["unseen"]}],
  options:[{name:"Retry",benefits:8,costs:1,risks:2,constraintsMet:true},{name:"Unsafe",benefits:100,costs:0,risks:0,constraintsMet:false}],
  claims:[{claim:"Network caused error",source:"log",supports:true},{claim:"Network caused error",source:"counter-log",supports:false}],
  pastStrategies:[{name:"Retry verified",verified:true,outcome:"success"},{name:"Guess",verified:false,outcome:"success"}],
  plan:[{step:"Inspect",done:true,blocked:false},{step:"Repair",done:false,blocked:true}],
  questions:["Why offline?"]
});
describe("six cognitive skills", () => {
  it("separates observations, options, contradictory evidence, verified experience and replanning",()=>{
    const result=reviewSixSkills(input());
    expect(result.causalAnalysis[0]?.cause).toBe("Network issue");
    expect(result.causalAnalysis[1]?.requiresVerification).toBe(true);
    expect(result.options.map(x=>x.name)).toEqual(["Retry"]);
    expect(result.evidenceReview[0]?.status).toBe("conflicting");
    expect(result.reusableStrategies).toEqual(["Retry verified"]);
    expect(result.replanning).toMatchObject({blockedAt:"Repair",nextStep:null,needsReplan:true});
    expect(result.researchGaps).toEqual(["Why offline?"]);
    expect(result.requiresHumanReview).toBe(true);
  });
  it("rejects malformed and oversized inputs",()=>{
    expect(()=>reviewSixSkills({...input(),observations:Array(31).fill("data")})).toThrow();
    expect(()=>reviewSixSkills({...input(),options:[{name:"bad",benefits:Infinity,costs:0,risks:0,constraintsMet:true}]})).toThrow();
  });
});
