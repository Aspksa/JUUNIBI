import { describe, it, expect } from "vitest";
import { Memory } from "../src/memory";

describe("Memory repeated preferences", () => {
  it("counts repeated proposals without approving", async () => {
    const memory = new Memory();
    const a = await memory.suggestFromUserText("Я предпочитаю тёмную тему.");
    const b = await memory.suggestFromUserText("я предпочитаю тёмную тему");
    expect(a).toHaveLength(1);
    expect(b[0]?.id).toBe(a[0]?.id);
    expect(b[0]?.mentions).toBe(2);
    expect(await memory.list("active")).toEqual([]);
    expect(await memory.search("тёмную тему")).toEqual([]);
    expect(await memory.approve(a[0]!.id)).toBe(true);
  });
  it("does not create proposals for already approved preferences", async () => {
    const memory = new Memory();
    await memory.add("preference", "светлую тему", "active");
    expect(await memory.suggestFromUserText("Я предпочитаю светлую тему.")).toEqual([]);
    expect(await memory.list()).toHaveLength(1);
  });
});
