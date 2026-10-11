import { afterEach, describe, expect, it, vi } from "vitest";
import { mergeChatSync } from "@juunibi/core";
import { Chats, versionOf } from "../src/chat/chats";
import { contextInfo, isLongText, snippetAround, sourcesOf, utf8Base64, groupDigits } from "../src/chat/helpers";
import { extFor, tableCsv } from "../src/markdown";

afterEach(() => vi.unstubAllGlobals());

function memoryStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } });
  vi.stubGlobal("addEventListener", vi.fn());
  return data;
}

describe("mergeChatSync (computer and phone share chats)", () => {
  const c = (id: string, updatedAt: number, syncAt?: number) => ({ id, updatedAt, ...(syncAt ? { syncAt } : {}) });
  it("keeps the newer copy of each chat and the chats of both sides", () => {
    const m = mergeChatSync({ items: [c("a", 10), c("b", 20)], deleted: {} }, { items: [c("a", 10, 50), c("x", 5)], deleted: {} }, 100);
    expect(m.items.map((x) => x.id)).toEqual(["b", "a", "x"]);
    expect(m.items.find((x) => x.id === "a")!.syncAt).toBe(50);
  });
  it("a deletion wins over older changes, a later change brings the chat back", () => {
    const now = 1_000_000;
    expect(mergeChatSync({ items: [c("a", 10)], deleted: {} }, { items: [], deleted: { a: 20 } }, now).items).toEqual([]);
    expect(mergeChatSync({ items: [c("a", 10, 30)], deleted: {} }, { items: [], deleted: { a: 20 } }, now).items.map((x) => x.id)).toEqual(["a"]);
  });
  it("forgets very old deletions", () => {
    const now = 200 * 86_400_000;
    expect(mergeChatSync({ items: [], deleted: { a: 1 } }, { items: [], deleted: {} }, now).deleted).toEqual({});
  });
});

describe("Chats: pins, labels, versions, sync", () => {
  it("pins and labels a chat and remembers both", () => {
    const data = memoryStorage();
    const chats = new Chats();
    const conv = chats.create();
    chats.append(conv.id, { role: "user", content: "привет" });
    chats.setPinned(conv.id, true);
    chats.setArea(conv.id, "work");
    chats.persistNow();
    const again = new Chats();
    expect(again.get(conv.id)).toMatchObject({ pinned: true, area: "work" });
    chats.setArea(conv.id, null);
    expect(chats.get(conv.id)!.area).toBeUndefined();
    expect(data.size).toBeGreaterThan(0);
  });
  it("deleting several chats leaves tombstones for the other device", () => {
    memoryStorage();
    const chats = new Chats();
    const a = chats.create(); chats.append(a.id, { role: "user", content: "1" });
    const b = chats.create(); chats.append(b.id, { role: "user", content: "2" });
    chats.removeMany([a.id, b.id]);
    expect(chats.store.get().items).toEqual([]);
    expect(Object.keys(chats.syncState().deleted).sort()).toEqual([a.id, b.id].sort());
  });
  it("duplicates a chat with new message ids", () => {
    memoryStorage();
    const chats = new Chats();
    const a = chats.create(); chats.append(a.id, { role: "user", content: "вопрос" });
    const copy = chats.duplicate(a.id)!;
    expect(copy.id).not.toBe(a.id);
    expect(copy.title).toContain("копия");
    expect(copy.messages[0]!.content).toBe("вопрос");
    expect(copy.messages[0]!.id).not.toBe(chats.get(a.id)!.messages[0]!.id);
  });
  it("takes the other device's newer chats and leaves the one being answered", () => {
    memoryStorage();
    const chats = new Chats();
    const a = chats.create(); chats.append(a.id, { role: "user", content: "здесь" });
    const remote = { items: [{ id: "phone", title: "С телефона", createdAt: 1, updatedAt: Date.now() + 5, syncAt: Date.now() + 5, messages: [{ id: "m", role: "user", content: "оттуда", at: 1 }] },
      { ...chats.get(a.id)!, title: "чужое", syncAt: Date.now() + 10 }], deleted: {} };
    expect(chats.applySync(remote, a.id)).toBe(true);
    expect(chats.get("phone")!.messages[0]!.content).toBe("оттуда");
    expect(chats.get(a.id)!.title).not.toBe("чужое");
    expect(chats.applySync(remote, a.id)).toBe(false);
  });
  it("keeps answer versions through a reload", () => {
    memoryStorage();
    const chats = new Chats();
    const a = chats.create();
    const m = chats.append(a.id, { role: "assistant", content: "второй", turnId: "t2" });
    chats.patch(a.id, m.id, { versions: [{ content: "первый", at: 1, rating: 1 }, versionOf(m)], vi: 1 });
    chats.persistNow();
    const again = new Chats().get(a.id)!.messages[0]!;
    expect(again.versions!.map((v) => v.content)).toEqual(["первый", "второй"]);
    expect(again.vi).toBe(1);
  });
});

describe("chat helpers", () => {
  it("finds sources only in answers that used the internet", () => {
    const text = "См. [Статья о лисах](https://ru.wikipedia.org/wiki/Лисица) и https://www.example.com/news/fox-day. Ещё раз https://www.example.com/news/fox-day.";
    expect(sourcesOf(text, ["get_time"])).toEqual([]);
    const s = sourcesOf(text, ["web_search"]);
    expect(s.map((x) => x.host)).toEqual(["ru.wikipedia.org", "example.com"]);
    expect(s[0]!.title).toBe("Статья о лисах");
    expect(s[1]!.title).toBe("fox day");
  });
  it("tells how much of the chat the model still sees", () => {
    expect(contextInfo([{ content: "a".repeat(100) }], 1000)).toMatchObject({ kept: 1, dropped: 0, percent: 10 });
    const long = contextInfo([{ content: "a".repeat(600) }, { content: "b".repeat(600) }], 1000);
    expect(long).toMatchObject({ kept: 1, total: 2, dropped: 1, percent: 100 });
  });
  it("folds long messages, finds snippets, encodes for the Disk", () => {
    expect(isLongText("коротко")).toBe(false);
    expect(isLongText("x\n".repeat(20))).toBe(true);
    expect(snippetAround("Мы говорили про кицунэ и хвосты", "КИЦУНЭ")).toEqual({ before: "Мы говорили про ", hit: "кицунэ", after: " и хвосты" });
    expect(snippetAround("ничего", "лиса")).toBeNull();
    expect(Buffer.from(utf8Base64("Привет, 🦊"), "base64").toString("utf8")).toBe("Привет, 🦊");
    expect(groupDigits(12400)).toBe("12 400");
  });
  it("tables become CSV, code gets a file extension", () => {
    expect(tableCsv(["Имя", "Заметка"], [["Лиса", "рыжая, хитрая"], ["Кот", 'сказал "мяу"']])).toBe('Имя,Заметка\r\nЛиса,"рыжая, хитрая"\r\nКот,"сказал ""мяу"""\r\n');
    expect(extFor("TypeScript")).toBe("ts");
    expect(extFor("непонятно")).toBe("txt");
  });
});
