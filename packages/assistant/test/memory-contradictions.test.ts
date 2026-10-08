import { describe, it, expect } from "vitest";
import { Memory } from "../src/memory";

describe("explicit preference contradictions", () => {
  it("proposes replacement without changing active memory until approval", async () => {
    const memory = new Memory();
    const old = await memory.add("preference", "тёмную тему", "active");
    const proposed = await memory.suggestFromUserText("Я предпочитаю светлую тему");
    expect(proposed).toHaveLength(1);
    expect(proposed[0]).toMatchObject({ status: "pending", revisesId: old.id });
    expect((await memory.search("тёмную тему"))[0]?.id).toBe(old.id);
    expect(await memory.search("светлую тему")).toEqual([]);
    expect(await memory.approve(proposed[0]!.id)).toBe(true);
    expect(await memory.search("тёмную тему")).toEqual([]);
    expect((await memory.search("светлую тему"))[0]?.id).toBe(proposed[0]!.id);
  });
  it("does not assume contradiction between unrelated preferences", async () => {
    const memory = new Memory();
    await memory.add("preference", "тёмную тему", "active");
    const proposals = await memory.suggestFromUserText("Я предпочитаю светлую одежду");
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.revisesId).toBeUndefined();
  });
  it("does not create competing revisions for the same fact", async () => {
    const memory = new Memory();
    const old = await memory.add("preference", "тёмную тему", "active");
    const a = await memory.suggestFromUserText("Я предпочитаю светлую тему");
    const b = await memory.suggestFromUserText("Я предпочитаю светлую тему");
    expect(a[0]?.revisesId).toBe(old.id);
    expect(b).toEqual([]);
    expect((await memory.list("active"))[0]?.id).toBe(old.id);
  });
});
