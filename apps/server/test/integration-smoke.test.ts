import { afterAll, describe, expect, it, vi } from "vitest";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { Assistant, CloudRuProvider, Memory, MemoryAdapter } from "@juunibi/assistant";
import { createApp } from "../src/app";

describe("JUUNIBI integration smoke", () => {
  const servers: http.Server[] = [];
  afterAll(() => { for (const server of servers) server.close(); });
  async function open(assistant: Assistant, memory: Memory) {
    const server = createApp({ assistant, memory, configured: { model: "test-chat" }, modules: () => [{ name: "brain", status: "started" }] });
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    return "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  }
  const post = (base: string, path: string, body: unknown) =>
    fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("uses a single Cloud-compatible chat model through the real HTTP API", async () => {
    const providerFetch = vi.fn(async (_url: string, _opts: RequestInit) =>
      new Response(JSON.stringify({ choices: [{ message: { content: "Ответ JUUNIBI" } }] }), { status: 200 }));
    const llm = new CloudRuProvider({ apiKey: "test-key", model: "test-chat", retries: 0, fetch: providerFetch as unknown as typeof fetch });
    const memory = new Memory();
    const base = await open(new Assistant({ llm, memory }), memory);
    const reply = await (await post(base, "/api/chat", { message: "Привет" })).json();
    expect(reply.reply).toBe("Ответ JUUNIBI");
    expect(providerFetch).toHaveBeenCalledTimes(1);
    const [, init] = providerFetch.mock.calls[0]!;
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("test-chat");
    expect(body.messages.at(-1)).toMatchObject({ role: "user", content: "Привет" });
    expect((await (await fetch(base + "/api/cloudru")).json()).configured).toBe(true);
  });

  it("proposes, approves and restores memory without activating unapproved facts", async () => {
    const storage = new MemoryAdapter();
    const memory = new Memory(storage);
    const proposal = await memory.add("preference", "Люблю тёмную тему", "pending");
    const llm = new CloudRuProvider({ apiKey: "test-key", model: "test-chat", retries: 0,
      fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: "Готово" } }] }), { status: 200 }) });
    const base = await open(new Assistant({ llm, memory }), memory);
    expect((await (await fetch(base + "/api/memory?status=active")).json())).toEqual([]);
    const approved = await post(base, "/api/memory/" + proposal.id + "/approve", {});
    expect((await approved.json()).ok).toBe(true);
    const restored = new Memory(storage);
    expect((await restored.search("тёмную тему"))[0]?.id).toBe(proposal.id);
    const result = await (await post(base, "/api/chat", { message: "Какую тему я люблю?" })).json();
    expect(result.memory).toContain("Люблю тёмную тему");
  });
  it("denies dangerous tool execution when no approval supervisor is installed", async () => {
    let executed = false;
    let requests = 0;
    const llm = { chat: async () => (++requests === 1
      ? { content: null, toolCalls: [{ id: "deny-1", name: "danger_test", arguments: "{}" }] }
      : { content: "Действие не выполнено", toolCalls: [] }) };
    const memory = new Memory();
    const assistant = new Assistant({ llm, memory });
    assistant.tools.register({ name: "danger_test", description: "integration permission test", risk: "danger",
      parameters: { type: "object", properties: {} }, run: () => { executed = true; return "unexpected"; } });
    const base = await open(assistant, memory);
    const reply = await (await post(base, "/api/chat", { message: "Проверь разрешение" })).json();
    expect(reply.reply).toBe("Действие не выполнено");
    expect(executed).toBe(false);
  });

});
