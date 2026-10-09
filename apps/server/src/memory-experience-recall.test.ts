import { describe, expect, it } from "vitest";
import { DecisionMemory } from "./decision-memory";
import { recallConfirmedExperience, evaluateExperienceRecall } from "./memory-experience-recall";
describe("Memory 4.1 confirmed experience",()=>{
 it("never retrieves unconfirmed predictions",()=>{
  const m=new DecisionMemory();
  const pending=m.record({goal:"Ошибка Cloud.ru",chosen:"проверить ключ",reason:"предположение",predictedSuccess:true});
  expect(recallConfirmedExperience(m.snapshot(),"Ошибка Cloud.ru")).toEqual([]);
  m.confirm(pending.id,"failure");
  expect(recallConfirmedExperience(m.snapshot(),"Ошибка Cloud.ru")[0]).toMatchObject({id:pending.id,observed:"failure",evidence:"owner-confirmed"});
 });
 it("retrieves relevant outcomes and measures only retrieval accuracy",()=>{
  const m=new DecisionMemory();
  const x=m.record({goal:"Падение тестов Windows",chosen:"исправить тест",reason:"права",predictedSuccess:true});
  m.confirm(x.id,"success");
  expect(recallConfirmedExperience(m.snapshot(),"тестов Windows")[0]?.id).toBe(x.id);
  expect(evaluateExperienceRecall(m.snapshot(),[{query:"тестов Windows",expectedId:x.id}])).toMatchObject({tested:1,top1Matched:1,accuracy:1});
 });
 it("uses neither unmatched nor fabricated outcomes",()=>{
  const m=new DecisionMemory();
  const x=m.record({goal:"Проверка памяти",chosen:"перепроверить",reason:"неизвестно",predictedSuccess:true});
  m.confirm(x.id,"failure");
  expect(recallConfirmedExperience(m.snapshot(),"погода")).toEqual([]);
 });
});
