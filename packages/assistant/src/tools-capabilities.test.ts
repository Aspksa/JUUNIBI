import { describe, expect, it } from "vitest";
import { ToolRegistry } from "./tools";

const tool = (name: string) => ({
  name, description: "Read-only test tool", risk: "read" as const,
  parameters: { type: "object" as const }, run: () => "ok",
});

describe("tool capability registry", () => {
  it("reports registered owner and risk without exposing executable handlers", () => {
    const registry = new ToolRegistry();
    const unregister = registry.register(tool("search_memory"), "memory");
    expect(registry.capabilities()).toEqual([{ name: "search_memory", owner: "memory", risk: "read" }]);
    expect(JSON.stringify(registry.capabilities())).not.toContain("run");
    unregister();
    expect(registry.capabilities()).toEqual([]);
  });
  it("rejects duplicate names and does not allow stale unregister callbacks to remove replacements", () => {
    const registry = new ToolRegistry();
    const old = registry.register(tool("search_memory"));
    expect(() => registry.register(tool("search_memory"))).toThrow("already registered");
    old();
    registry.register(tool("search_memory"), "knowledge");
    old();
    expect(registry.capabilities()[0]?.owner).toBe("knowledge");
  });
  it("rejects unbounded or invalid owners", () => {
    const registry = new ToolRegistry();
    expect(() => registry.register(tool("a"), "../unsafe")).toThrow("Bad tool owner");
    expect(registry.capabilities()).toEqual([]);
  });
});
