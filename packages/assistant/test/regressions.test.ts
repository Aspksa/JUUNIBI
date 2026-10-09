import { describe, expect, it, vi } from "vitest";
import { CloudRuProvider, LlmError, Memory } from "../src";

const sse = (parts: string[], fail = false) => {
  const enc = new TextEncoder();
  let i = 0;
  return new Response(new ReadableStream({
    pull(c) {
      if (i < parts.length) { c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: parts[i++] } }] })}\n\n`)); return; }
      if (fail) c.error(new Error("socket hang up")); else { c.enqueue(enc.encode("data: [DONE]\n\n")); c.close(); }
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
};

describe("CloudRuProvider", () => {
  it("уже отменённый signal не отправляет запрос", async () => {
    const fetch = vi.fn();
    const llm = new CloudRuProvider({ apiKey: "k", model: "m", fetch: fetch as never });
    const ctl = new AbortController(); ctl.abort();
    await expect(llm.chat([{ role: "user", content: "x" }], { signal: ctl.signal })).rejects.toBeInstanceOf(LlmError);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("не дублирует текст, если поток оборвался после частичного вывода", async () => {
    const fetch = vi.fn(async () => sse(["при"], true));
    const llm = new CloudRuProvider({ apiKey: "k", model: "m", retries: 2, fetch: fetch as never });
    const got: string[] = [];
    await expect(llm.chat([{ role: "user", content: "x" }], { onText: (t) => got.push(t) })).rejects.toBeInstanceOf(LlmError);
    expect(got).toEqual(["при"]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("повторяет запрос при 5xx, пока ничего не выдано", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(sse(["ок"]));
    const llm = new CloudRuProvider({ apiKey: "k", model: "m", retries: 2, fetch: fetch as never });
    const got: string[] = [];
    const r = await llm.chat([{ role: "user", content: "x" }], { onText: (t) => got.push(t) });
    expect(r.content).toBe("ок");
    expect(got).toEqual(["ок"]);
  });
  it("снимает обработчик abort после запроса", async () => {
    const ctl = new AbortController();
    const add = vi.spyOn(ctl.signal, "addEventListener");
    const remove = vi.spyOn(ctl.signal, "removeEventListener");
    const fetch = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "a" } }] }), { status: 200 }));
    const llm = new CloudRuProvider({ apiKey: "k", model: "m", fetch: fetch as never });
    await llm.chat([{ role: "user", content: "x" }], { signal: ctl.signal });
    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

describe("Memory: вытеснение", () => {
  it("при переполнении новая запись не удаляется, а активные знания переживают черновики", async () => {
    const dump = Array.from({ length: 2000 }, (_, i) => ({
      id: "id" + i, kind: "fact", text: "запись " + i, status: i === 0 ? "pending" : "active", score: 5, createdAt: 1000 + i,
    }));
    const m = new Memory({ load: async () => JSON.stringify(dump), save: async () => {} });
    const added = await m.add("fact", "совсем новая запись", "pending");
    const all = await m.list();
    expect(all).toHaveLength(2000);
    expect(all.some((e) => e.id === added.id)).toBe(true);
    expect(all.some((e) => e.id === "id0")).toBe(false); // вытеснен самый слабый — черновик
  });
});
