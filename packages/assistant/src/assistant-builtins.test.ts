import { describe, expect, it } from "vitest";
import { registerAssistantBuiltins } from "./assistant-builtins";
import { Memory } from "./memory";
import { ToolRegistry } from "./tools";

describe("registerAssistantBuiltins", () => {
  it("registers the stable builtin surface", () => {
    const tools = new ToolRegistry();
    registerAssistantBuiltins({ tools, memory: new Memory(), describeModules: () => [{ name: "brain" }] });
    expect(tools.list().map((tool) => tool.name)).toEqual([
      "list_modules",
      "search_memory",
      "propose_memory_revision",
      "remember",
    ]);
    expect(tools.list().every((tool) => tool.risk === "read")).toBe(true);
  });

  it("keeps memory proposals pending and searchable only after approval", async () => {
    const memory = new Memory();
    const tools = new ToolRegistry();
    registerAssistantBuiltins({ tools, memory });

    expect(await tools.get("remember")!.run({ text: "кофе без сахара", kind: "preference" }))
      .toContain("ждёт подтверждения");
    const pending = await memory.list("pending");
    expect(pending).toHaveLength(1);
    expect(await tools.get("search_memory")!.run({ query: "кофе" })).toEqual([]);

    await memory.approve(pending[0]!.id);
    expect(await tools.get("search_memory")!.run({ query: "кофе" }))
      .toEqual([{ id: pending[0]!.id, text: "кофе без сахара" }]);
  });

  it("delegates module snapshots without granting mutation access", async () => {
    const tools = new ToolRegistry();
    const snapshot = [{ name: "memory", status: "started" }];
    registerAssistantBuiltins({ tools, memory: new Memory(), describeModules: () => snapshot });
    expect(await tools.get("list_modules")!.run({})).toEqual(snapshot);
  });
});
