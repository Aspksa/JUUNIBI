import { describe, expect, it, vi, afterEach } from "vitest";
import { streamChat } from "../src/chat/stream";

afterEach(() => vi.unstubAllGlobals());

const response = (chunks: string[]) => ({
  ok: true,
  body: new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }),
});

describe("chat stream robustness", () => {
  it("parses NDJSON across chunk boundaries", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(['{"type":"del', 'ta","text":"Привет"}\n'])));
    const found: string[] = [];
    await streamChat({ message: "x", history: [] }, new AbortController().signal, (e) => { if (e.type === "delta") found.push(e.text); });
    expect(found).toEqual(["Привет"]);
  });
  it("accepts Brain review metadata and continues a real reply", async () => {
    const payload = [
      {type:"brain_review",review:{taskType:"organizer",confidence:0.9}},
      {type:"delta",text:"Запрос на отпуск"},
      {type:"done",turnId:"t1",reply:"Запрос на отпуск",tools:[]},
    ].map(x=>JSON.stringify(x)+"\n").join("");
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(response([payload.slice(0,19),payload.slice(19)])));
    const events:string[]=[];
    await streamChat({message:"запиши отпуск с 12 октября по 23",history:[]},
      new AbortController().signal,(e)=>events.push(e.type));
    expect(events).toEqual(["brain_review","delta","done"]);
  });
  it("rejects unsupported stream event kinds", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(['{"type":"unexpected"}\\n'])));
    await expect(streamChat({ message: "x", history: [] }, new AbortController().signal, () => {})).rejects.toThrow("Некорректное событие");
  });
  it("rejects malformed NDJSON rather than silently losing events", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(["{broken}\n"])));
    await expect(streamChat({ message: "x", history: [] }, new AbortController().signal, () => {})).rejects.toThrow("Некорректное событие");
  });
  it("rejects an unbounded event line", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(["x".repeat(2 * 1024 * 1024 + 1)])));
    await expect(streamChat({ message: "x", history: [] }, new AbortController().signal, () => {})).rejects.toThrow("лимит буфера");
  });
});
