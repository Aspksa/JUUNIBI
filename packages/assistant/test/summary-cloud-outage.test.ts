import { describe, it, expect, vi } from "vitest";
import { Assistant } from "../src/assistant";
import { LlmError } from "../src/llm";
import type { LlmProvider } from "../src/llm";

describe("summary Cloud.ru outage recovery", () => {
 it("preserves normal chat and defers repeated 503 summaries", async () => {
  let summaryAttempts = 0;
  const llm: LlmProvider = { chat: vi.fn(async (messages) => {
   if (messages[0]?.content?.includes("краткое содержание длинного разговора")) {
    summaryAttempts++;
    throw new LlmError("Cloud.ru вернул 503",503);
   }
   return {content:"ответ",toolCalls:[]};
  }) };
  const assistant = new Assistant({llm,prefs:()=>({suggestions:"off",summaries:true})});
  const history = Array.from({length:25},(_,i)=>({role:(i%2?"assistant":"user") as "assistant"|"user",content:"Сообщение "+i}));
  expect((await assistant.ask("первое","test",undefined,{history})).reply).toBe("ответ");
  await assistant.idle();
  expect(summaryAttempts).toBe(1);
  expect((await assistant.ask("второе","test",undefined,{history})).reply).toBe("ответ");
  await assistant.idle();
  expect(summaryAttempts).toBe(1);
 });
});
