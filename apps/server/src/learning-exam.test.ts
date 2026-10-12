import {describe,it,expect} from "vitest";
import {makeHoldoutExam,gradeHoldoutExam} from "./learning-exam";
describe("Independent holdout exams",()=>{
  it("deterministically generates closed-world unseen addition/subtraction problems",()=>{
    expect(makeHoldoutExam(7,2)).toEqual(makeHoldoutExam(7,2));
    expect(makeHoldoutExam(7,2).question).not.toBe(makeHoldoutExam(8,2).question);
  });
  it("grades only exact integer answers",()=>{
    const e=makeHoldoutExam(14,3);
    expect(gradeHoldoutExam(e,e.expected)).toBe(true);
    expect(gradeHoldoutExam(e,e.expected+" because")).toBe(false);
    expect(gradeHoldoutExam(e,"")).toBe(false);
  });
  it("rejects invalid exam parameters",()=>{expect(()=>makeHoldoutExam(-1,2)).toThrow();expect(()=>makeHoldoutExam(1,9)).toThrow();});
});
