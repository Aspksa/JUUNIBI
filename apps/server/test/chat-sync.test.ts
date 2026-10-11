import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { LlmProvider } from "@juunibi/assistant";
import { createApp } from "../src/app";
import { ChatStore } from "../src/chat-store";
import { chatExtras, parseExtras } from "../src/chat-extras";

let dir: string, server: http.Server, base: string;
const T = Date.now() - 60_000;
const conv = (id: string, at: number, text: string) => ({ id, title: id, createdAt: at, updatedAt: at, syncAt: at, messages: [{ id: id + "m", role: "user", content: text, at }] });

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "juunibi-chats-"));
  const chats = new ChatStore(path.join(dir, "chats.json"));
  const llm: LlmProvider = { chat: async () => ({ content: '{"title":"«Рецепт пирога.»","followUps":["А без яиц?","Сколько печь?","А без яиц?"]}', toolCalls: [] }) };
  server = createApp({ chats, chatExtras: () => (o) => chatExtras(llm, o), modules: () => [], configured: {} });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { server.close(); await rm(dir, { recursive: true, force: true }); });

const put = (body: unknown) => fetch(base + "/api/chats", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

describe("/api/chats: the computer and the phone see the same chats", () => {
  it("merges what each device sends and keeps it on disk", async () => {
    await put({ items: [conv("pc", T + 100, "с компьютера")], deleted: {} });
    const both = await put({ items: [conv("phone", T + 200, "с телефона")], deleted: {} });
    expect(both.items.map((c: { id: string }) => c.id)).toEqual(["phone", "pc"]);
    const saved = JSON.parse(await readFile(path.join(dir, "chats.json"), "utf8"));
    expect(saved.items).toHaveLength(2);
    const store = new ChatStore(path.join(dir, "chats.json"));
    await store.load();
    expect(store.get().items.map((c) => c.id)).toEqual(["phone", "pc"]);
  });
  it("a newer copy wins and a deletion reaches every device", async () => {
    await put({ items: [{ ...conv("pc", T + 100, "исправлено"), syncAt: T + 300 }], deleted: {} });
    const after = await put({ items: [], deleted: { phone: T + 400 } });
    expect(after.items.map((c: { id: string }) => c.id)).toEqual(["pc"]);
    expect(after.items[0].messages[0].content).toBe("исправлено");
    expect((await (await fetch(base + "/api/chats")).json()).deleted.phone).toBe(T + 400);
  });
  it("ignores junk", async () => {
    const r = await put({ items: [{ id: 5 }, null, { id: "x", messages: "no" }], deleted: { y: "z" } });
    expect(r.items.map((c: { id: string }) => c.id)).toEqual(["pc"]);
  });
});

describe("/api/chat/extras", () => {
  it("returns a clean title and distinct questions", async () => {
    const r = await fetch(base + "/api/chat/extras", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "Как испечь пирог?", reply: "…", wantTitle: true }) });
    expect(await r.json()).toEqual({ title: "Рецепт пирога", followUps: ["А без яиц?", "Сколько печь?"] });
  });
  it("parses only what it asked for", () => {
    expect(parseExtras('мусор {"title":"Х","followUps":[1,"ok?"]}', false)).toEqual({ followUps: [] });
    expect(parseExtras("не JSON", true)).toEqual({ followUps: [] });
    expect(parseExtras('{"title":"Про лис","followUps":["Почему хвосты?"]}', false)).toEqual({ followUps: ["Почему хвосты?"] });
  });
});
