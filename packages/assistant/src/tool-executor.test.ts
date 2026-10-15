import { expect, it } from "vitest";
import type { Tool } from "./tools";
import { ToolRegistry } from "./tools";
import { ToolExecutor } from "./tool-executor";

const registryWith = (tool: Tool) => {
  const tools = new ToolRegistry();
  tools.register(tool);
  return tools;
};

const readTool = (run: Tool["run"] = () => "ok"): Tool => ({
  name: "read_status",
  description: "Read status",
  risk: "read",
  parameters: { type: "object", properties: { scope: { type: "string" } }, required: ["scope"] },
  run,
});

it("rejects malformed or schema-invalid arguments before execution", async () => {
  let ran = 0;
  const executor = new ToolExecutor({ tools: registryWith(readTool(() => { ran++; return "ok"; })) });
  expect((await executor.run("read_status", "[]")).status).toBe("error");
  expect((await executor.run("read_status", "{}")).status).toBe("error");
  expect((await executor.run("read_status", '{"scope":"all","extra":true}')).status).toBe("error");
  expect(ran).toBe(0);
});

it("applies owner policy before tool execution", async () => {
  let ran = 0;
  const executor = new ToolExecutor({
    tools: registryWith(readTool(() => { ran++; return "ok"; })),
    toolPolicy: () => false,
  });
  const result = await executor.run("read_status", '{"scope":"all"}');
  expect(result.status).toBe("denied");
  expect(ran).toBe(0);
});

it("denies danger tools without a trusted action plan before approval", async () => {
  let ran = 0, approvals = 0;
  const tool: Tool = {
    name: "publish_release",
    description: "Publish release",
    risk: "danger",
    parameters: { type: "object", properties: {} },
    run: () => { ran++; return "published"; },
  };
  const executor = new ToolExecutor({
    tools: registryWith(tool),
    approve: () => { approvals++; return true; },
  });
  const result = await executor.run("publish_release", "{}");
  expect(result.status).toBe("denied");
  expect(approvals).toBe(0);
  expect(ran).toBe(0);
});

it("requires independent approval for write tools and preserves read-only mode", async () => {
  let ran = 0;
  const tool: Tool = {
    name: "save_note",
    description: "Save note",
    risk: "write",
    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    run: () => { ran++; return "saved"; },
  };
  const tools = registryWith(tool);
  expect((await new ToolExecutor({ tools, approve: () => false }).run("save_note", '{"text":"x"}')).status).toBe("denied");
  expect((await new ToolExecutor({ tools, approve: () => true }).run("save_note", '{"text":"x"}', undefined, true)).status).toBe("denied");
  expect(ran).toBe(0);
  expect((await new ToolExecutor({ tools, approve: () => true }).run("save_note", '{"text":"x"}')).status).toBe("ok");
  expect(ran).toBe(1);
});

it("bounds successful tool output and converts thrown errors into tool errors", async () => {
  const long = new ToolExecutor({ tools: registryWith(readTool(() => "abcdef")), maxOutput: 3 });
  expect(await long.run("read_status", '{"scope":"all"}')).toEqual({ text: "abc…[обрезано]", status: "ok" });

  const failed = new ToolExecutor({ tools: registryWith(readTool(() => { throw new Error("boom"); })) });
  const result = await failed.run("read_status", '{"scope":"all"}');
  expect(result.status).toBe("error");
  expect(result.text).toContain("boom");
});
