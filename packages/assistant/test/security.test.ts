import { describe, expect, it, vi } from "vitest";
import { ApprovalGate, validateToolArgs } from "../src/security";

describe("agent security foundation", () => {
  it("validates tool arguments and refuses unknown fields", () => {
    const schema = { type: "object" as const, properties: { name: { type: "string", enum: ["ok"] } }, required: ["name"] };
    expect(validateToolArgs(schema, { name: "ok" })).toBeNull();
    expect(validateToolArgs(schema, {})).toMatch(/Не хватает/);
    expect(validateToolArgs(schema, { name: 12 })).toMatch(/тип/);
    expect(validateToolArgs(schema, { name: "bad" })).toMatch(/значение/);
    expect(validateToolArgs(schema, { name: "ok", surprise: true })).toMatch(/Неизвестный/);
  });
  it("requires an exact, single-use approval and writes audit events", async () => {
    const audit = vi.fn();
    const gate = new ApprovalGate(audit);
    const args = { path: "a.txt" };
    const result = gate.request({ tool: "write_file", args, risk: "write" });
    args.path = "changed.txt";
    const [pending] = gate.list();
    expect(pending!.args.path).toBe("a.txt");
    expect(gate.decide(pending!.id, true)).toBe(true);
    expect(await result).toBe(true);
    expect(gate.decide(pending!.id, true)).toBe(false);
    expect(gate.history().map((e) => e.decision)).toEqual(["requested", "approved"]);
    expect(audit).toHaveBeenCalledTimes(2);
  });
  it("rejects aborted and denied approvals", async () => {
    const gate = new ApprovalGate();
    const controller = new AbortController();
    const p = gate.request({ tool: "delete", args: {}, risk: "danger" }, controller.signal);
    controller.abort();
    expect(await p).toBe(false);
    expect(gate.list()).toHaveLength(0);
    const q = gate.request({ tool: "write", args: {}, risk: "write" });
    gate.denyAll();
    expect(await q).toBe(false);
  });
});
