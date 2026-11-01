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
  it("reports identical read-only contracts across different owners without merging them", () => {
    const registry = new ToolRegistry();
    registry.register(tool("read_a"), "brain");
    registry.register(tool("read_b"), "assistant");
    expect(registry.potentialOverlaps()).toEqual([{ names: ["read_a", "read_b"], owners: ["assistant", "brain"] }]);
    expect(registry.get("read_a")).toBeDefined();
    expect(registry.get("read_b")).toBeDefined();
  });
  it("does not report matching write contracts as safely interchangeable", () => {
    const registry = new ToolRegistry();
    registry.register({ ...tool("write_a"), risk: "write" }, "brain");
    registry.register({ ...tool("write_b"), risk: "write" }, "assistant");
    expect(registry.potentialOverlaps()).toEqual([]);
  });
});
