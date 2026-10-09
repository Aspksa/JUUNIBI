import {describe,it,expect} from "vitest";
import {programmingLanguages,programmingTopic,programmingPrompt} from "./programming-curriculum";
describe("programming curriculum",()=>{
 it("rotates across languages without claiming proficiency",()=>{
  expect(new Set(programmingLanguages).size).toBe(programmingLanguages.length);
  expect(programmingLanguages).toContain("Python");
  expect(programmingLanguages).toContain("Rust");
  expect(programmingLanguages).toContain("TypeScript");
  for(let i=0;i<programmingLanguages.length;i++)expect(programmingTopic(i)).toBe(programmingLanguages[i]);
  expect(programmingTopic(programmingLanguages.length)).toBe(programmingLanguages[0]);
 });
 it("keeps unverified code inert",()=>{
  const prompt=programmingPrompt("Python","brain");
  expect(prompt).toContain("код не запускай");
  expect(prompt).toContain("файлы не меняй");
  expect(prompt).toContain("непроверенное в память не записывай");
 });
});
