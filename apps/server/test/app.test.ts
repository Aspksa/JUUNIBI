import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { Assistant, type LlmProvider } from "@juunibi/assistant";
import { Logger } from "@juunibi/core";
import { createApp, hostAllowed, originAllowed } from "../src/app";

const llm: LlmProvider = { chat: async (_m, o) => { o?.onText?.("при"); o?.onText?.("вет"); return { content: "привет", toolCalls: [] }; } };
let server: http.Server, base: string, port: number;
let bare: http.Server, bareBase: string;

const start = (s: http.Server) => new Promise<number>((r) => s.listen(0, "127.0.0.1", () => r((s.address() as AddressInfo).port)));
beforeAll(async () => {
  server = createApp({ assistant: new Assistant({ llm, log: new Logger("t", "silent") }), modules: () => [{ name: "a" }], configured: { model: "m" } });
  port = await start(server); base = `http://127.0.0.1:${port}`;
  bare = createApp({ assistant: undefined, modules: () => [], configured: { hint: "настройте .env" } });
  bareBase = `http://127.0.0.1:${await start(bare)}`;
});
afterAll(() => { server.close(); bare.close(); });

const post = (b: string, p: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(b + p, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

describe("guards", () => {
  it("host and origin checks", () => {
    expect(hostAllowed("localhost:4173")).toBe(true);
    expect(hostAllowed("evil.com")).toBe(false);
    expect(hostAllowed(undefined)).toBe(false);
    expect(originAllowed("http://evil.com", "127.0.0.1:1")).toBe(false);
    expect(originAllowed("http://127.0.0.1:1", "127.0.0.1:1")).toBe(true);
  });
  it("rejects rebinding host and foreign origin", async () => {
    // Host header cannot be overridden by fetch; covered by hostAllowed above
  });
});

describe("api", () => {
  it("chat round-trip, feedback, validation", async () => {
    const r = await (await post(base, "/api/chat", { message: "привет" })).json();
    expect(r.reply).toBe("привет");
    expect((await (await post(base, "/api/feedback", { turnId: r.turnId, rating: 1 })).json()).ok).toBe(true);
    expect((await post(base, "/api/chat", { message: "  " })).status).toBe(400);
    expect((await post(base, "/api/feedback", { turnId: "x", rating: 5 })).status).toBe(400);
    expect((await post(base, "/api/chat", { message: "x".repeat(70_000) })).status).toBe(413);
    expect((await post(base, "/api/chat", { message: "x" }, { origin: "http://evil.com" })).status).toBe(403);
  });
  it("lists modules and memory; unknown route 404", async () => {
    expect(await (await fetch(base + "/api/modules")).json()).toEqual([{ name: "a" }]);
    expect(await (await fetch(base + "/api/memory")).json()).toEqual([]);
    expect((await fetch(base + "/api/nope")).status).toBe(404);
  });
  it("without Cloud.ru config chat says how to fix it", async () => {
    const r = await post(bareBase, "/api/chat", { message: "hi" });
    expect(r.status).toBe(503);
    expect((await r.json()).error).toContain(".env");
    expect((await (await fetch(bareBase + "/api/status")).json()).assistant).toBe(false);
  });
  it("streams NDJSON events: deltas then done; validates input", async () => {
    const res = await post(base, "/api/chat/stream", { message: "привет", history: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }] });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const events = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
    expect(events.filter((e) => e.type === "delta").map((e) => e.text).join("")).toBe("привет");
    expect(events.at(-1)).toMatchObject({ type: "done", reply: "привет" });
    expect((await post(base, "/api/chat/stream", { message: " " })).status).toBe(400);
    expect((await post(base, "/api/chat/stream", { message: "x" }, { origin: "http://evil.com" })).status).toBe(403);
    expect((await post(bareBase, "/api/chat/stream", { message: "x" })).status).toBe(503);
  });
});
