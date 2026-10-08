import { describe, expect, it } from "vitest";
import { Memory } from "../src/memory";

describe("Automatic memory proposals", () => {
  it("suggests explicit preferences, pending until approval", async () => {
    const memory = new Memory();
    const suggested = await memory.suggestFromUserText("Я предпочитаю краткие ответы");
    expect(suggested).toHaveLength(1);
    expect(suggested[0]?.status).toBe("pending");
    expect(await memory.search("ответы")).toEqual([]);
    expect(await memory.approve(suggested[0]!.id)).toBe(true);
    expect((await memory.search("ответы"))).toHaveLength(1);
  });
  it("does not propose secrets or quoted text", async () => {
    const memory = new Memory();
    expect(await memory.suggestFromUserText("Запомни пароль секретный")).toEqual([]);
    expect(await memory.suggestFromUserText("> Запомни тестовую цитату")).toEqual([]);
    expect(await memory.suggestFromUserText("Что ты обо мне помнишь?")).toEqual([]);
    expect(await memory.list()).toEqual([]);
  });
  it("deduplicates pending suggestions", async () => {
    const memory = new Memory();
    expect(await memory.suggestFromUserText("Я предпочитаю работать вечером")).toHaveLength(1);
    expect(await memory.suggestFromUserText("Я предпочитаю работать вечером")).toHaveLength(1);
    expect(await memory.list()).toHaveLength(1);
  });
});
