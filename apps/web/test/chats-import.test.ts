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
    expect(c.importJson([conv("a", 10), conv("b", 30)])).toEqual({ added: 2, dropped: 0 });
    expect(c.store.get().items.map((x) => x.id)).toEqual(["b", "a"]);
    expect(c.importJson([conv("a", 10), conv("c", 20)])).toEqual({ added: 1, dropped: 0 });
    expect(c.store.get().items.map((x) => x.id)).toEqual(["b", "c", "a"]);
  });
  it("ignores files that are not an export", () => {
    const c = new Chats();
    expect(c.importJson({ nope: true }).added).toBe(0);
    expect(c.importJson([{ id: 1 }, "x"]).added).toBe(0);
  });
  it("never pushes out chats already here when the limit is reached", () => {
    const c = new Chats();
    c.importJson(Array.from({ length: 99 }, (_, i) => conv("own" + i, 1000 + i)));
    expect(c.importJson([conv("new1", 1), conv("new2", 5000)])).toEqual({ added: 1, dropped: 1 });
    const ids = c.store.get().items.map((x) => x.id);
    expect(ids).toHaveLength(100);
    expect(ids).toContain("new2");
    expect(ids).toContain("own0");
  });
  it("survives damaged messages instead of throwing", () => {
    const c = new Chats();
    const bad = { ...conv("bad", 1), messages: [{ id: "m1", role: "assistant", content: "ok", at: 1, steps: "oops", files: 5, tools: [1, "x"], scene: "s" }] };
    expect(c.importJson([bad, { ...conv("dup", 2) }, { ...conv("dup", 3) }])).toEqual({ added: 2, dropped: 0 });
    const m = c.get("bad")!.messages[0]!;
    expect(m.steps).toBeUndefined();
    expect(m.files).toBeUndefined();
    expect(m.tools).toEqual(["x"]);
    expect(m.scene).toBeUndefined();
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
