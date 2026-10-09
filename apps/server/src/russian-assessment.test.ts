import {describe,it,expect} from "vitest";
import {makeRussianTask,checkRussianAnswer} from "./russian-assessment";
describe("Brain 7.1 Russian language assessment",()=>{
 it("tests spelling with a bounded local answer key and alternating options",()=>{
  for(let i=0;i<24;i++){
   const task=makeRussianTask(i);
   expect(task.kind).toBe("orthography");
   expect(task.question).toContain(task.expected);
   expect(checkRussianAnswer(task,task.expected)).toBe(true);
   expect(checkRussianAnswer(task,task.expected.toUpperCase())).toBe(true);
   expect(checkRussianAnswer(task,"ошибка")).toBe(false);
   expect(checkRussianAnswer(task,task.expected+" объяснение")).toBe(false);
  }
 });
});
