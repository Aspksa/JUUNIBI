import { describe, expect, it, vi } from "vitest";
import { AgentLoop } from "./agent-loop";
import type { LlmProvider, LlmResponse, Message } from "./llm";
import { ToolExecutor } from "./tool-executor";
import { ToolRegistry } from "./tools";

const say = (content: string): LlmResponse => ({ content, toolCalls: [] });
const call = (name: string, args = {}, content: string | null = null): LlmResponse => ({
  content,
  toolCalls: [{ id: "c1", name, arguments: JSON.stringify(args) }],
});

const make = (responses: LlmResponse[], approve?: () => boolean) => {
  const seen: { messages: Message[]; tools: string[] }[] = [];
  const llm: LlmProvider = {
    chat: async (messages, options) => {
      seen.push({
        messages: structuredClone(messages),
        tools: (options?.tools ?? []).map((tool) => tool.name),
      });
      return responses.shift() ?? say("done");
    },
  };
  const tools = new ToolRegistry();
  const executor = new ToolExecutor({ tools, ...(approve ? { approve } : {}) });
  return { seen, tools, loop: new AgentLoop({ llm, tools, executor }) };
};

describe("AgentLoop", () => {
  it("preserves model text written before a tool and emits tool events", async () => {
    const { loop, tools } = make([call("ping", {}, "Смотрю…"), say("Готово")]);
    tools.register({
      name: "ping",
      description: "",
      risk: "read",
      parameters: { type: "object", properties: {} },
      run: () => "pong",
    });
    const events: unknown[] = [];
    const messages: Message[] = [{ role: "user", content: "x" }];
    const result = await loop.run({
      messages,
      request: "x",
      timeoutMs: 1000,
      retries: 0,
      onEvent: (event) => events.push(event),
    });
    expect(result.reply).toBe("Смотрю…\n\nГотово");
    expect(result.used).toEqual(["ping"]);
    expect(events).toEqual([
      { type: "tool", phase: "start", id: "c1", name: "ping", args: "{}" },
      { type: "tool", phase: "end", id: "c1", name: "ping", status: "ok", ms: expect.any(Number) },
    ]);
    expect(messages.at(-1)).toMatchObject({ role: "tool", content: "pong" });
  });

  it("filters the model-visible tool surface but still fails closed if a hidden tool is called", async () => {
    const { loop, tools, seen } = make([call("hidden"), say("ok")]);
    tools.register({
      name: "visible",
      description: "",
      risk: "read",
      parameters: { type: "object", properties: {} },
      run: () => "visible",
    });
    tools.register({
      name: "hidden",
      description: "",
      risk: "read",
      parameters: { type: "object", properties: {} },
      run: () => "hidden",
    });
    const result = await loop.run({
      messages: [{ role: "user", content: "x" }],
      request: "x",
      timeoutMs: 1000,
      retries: 0,
      toolAllowed: (name) => name !== "hidden",
    });
    expect(seen[0]!.tools).toEqual(["visible"]);
    expect(result.used).toEqual(["hidden"]);
    expect(result.evidence[0]?.status).toBe("ok");
  });

  it("keeps ephemeral/read-only execution from running write tools", async () => {
    let ran = 0;
    const { loop, tools } = make([call("save"), say("ok")], () => true);
    tools.register({
      name: "save",
      description: "",
      risk: "write",
      parameters: { type: "object", properties: {} },
      run: () => { ran++; return "saved"; },
    });
    const result = await loop.run({
      messages: [{ role: "user", content: "x" }],
      request: "x",
      timeoutMs: 1000,
      retries: 0,
      readOnly: true,
    });
    expect(ran).toBe(0);
    expect(result.evidence[0]?.status).toBe("denied");
  });

  it("stops after maxSteps and keeps initial diagnostic evidence", async () => {
    const { loop, tools } = make([call("ping"), call("ping"), call("ping")]);
    tools.register({
      name: "ping",
      description: "",
      risk: "read",
      parameters: { type: "object", properties: {} },
      run: () => "pong",
    });
    const result = await loop.run({
      messages: [{ role: "user", content: "x" }],
      request: "x",
      timeoutMs: 1000,
      retries: 0,
      maxSteps: 2,
      initialUsed: ["list_modules"],
      initialEvidence: [{ name: "list_modules", status: "ok", at: 1, source: "cache" }],
    });
    expect(result.reply).toContain("отведённое число шагов");
    expect(result.used).toEqual(["list_modules", "ping", "ping"]);
    expect(result.evidence[0]).toMatchObject({ name: "list_modules", source: "cache" });
  });

  it("observer failures do not break the reply", async () => {
    const warn = vi.fn();
    const llm: LlmProvider = {
      chat: vi.fn()
        .mockResolvedValueOnce(call("ping"))
        .mockResolvedValueOnce(say("ok")),
    };
    const tools = new ToolRegistry();
    tools.register({
      name: "ping",
      description: "",
      risk: "read",
      parameters: { type: "object", properties: {} },
      run: () => "pong",
    });
    const executor = new ToolExecutor({ tools });
    const loop = new AgentLoop({
      llm,
      tools,
      executor,
      log: { info() {}, warn },
      onToolOutcome: () => { throw new Error("observer"); },
    });
    expect((await loop.run({
      messages: [{ role: "user", content: "x" }],
      request: "x",
      timeoutMs: 1000,
      retries: 0,
    })).reply).toBe("ok");
    expect(warn).toHaveBeenCalled();
  });
});
