import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Chats as ChatsT } from "../src/chat/chats";

let Chats: typeof ChatsT;
beforeAll(async () => {
  const mem = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) });
  vi.stubGlobal("addEventListener", () => {});
  ({ Chats } = await import("../src/chat/chats"));
});

const conv = (id: string, updatedAt: number) => ({ id, title: "Чат " + id, createdAt: 1, updatedAt, messages: [{ id: id + "-m", role: "user", content: "привет", at: 1 }] });

describe("Chats.importJson / restore", () => {
  it("adds new conversations newest first and skips ones already here", () => {
    const c = new Chats();
    expect(c.importJson([conv("a", 10), conv("b", 30)])).toBe(2);
    expect(c.store.get().items.map((x) => x.id)).toEqual(["b", "a"]);
    expect(c.importJson([conv("a", 10), conv("c", 20)])).toBe(1);
    expect(c.store.get().items.map((x) => x.id)).toEqual(["b", "c", "a"]);
  });
  it("ignores files that are not an export", () => {
    const c = new Chats();
    expect(c.importJson({ nope: true })).toBe(0);
    expect(c.importJson([{ id: 1 }, "x"])).toBe(0);
  });
  it("puts cleared conversations back", () => {
    const c = new Chats();
    c.importJson([conv("x", 1)]);
    const before = c.store.get().items;
    c.clearAll();
    c.restore(before);
    expect(c.store.get().items.map((x) => x.id)).toEqual(before.map((x) => x.id));
    expect(c.store.get().activeId).not.toBeNull();
  });
});
