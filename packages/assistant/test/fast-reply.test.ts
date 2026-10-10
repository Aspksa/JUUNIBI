import { describe, expect, it, vi } from "vitest";
import { Assistant } from "../src/assistant";
import type { LlmProvider } from "../src/llm";

describe("immediate chat reply", () => {
 it("returns before optional Cloud.ru memory extraction finishes", async () => {
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let count = 0;
  const llm: LlmProvider = {chat: vi.fn(async () => {
   count++;
   if (count === 1) return {content:"Основной ответ",toolCalls:[]};
   started();
   await blocked;
   return {content:"{}",toolCalls:[]};
  })};
  const assistant = new Assistant({llm});
  const answer = await assistant.ask("Мне нравится этот проект и его возможности");
  expect(answer.reply).toBe("Основной ответ");
  await entered;
  expect(count).toBe(2);
  release();
  await assistant.idle();
 });
});
