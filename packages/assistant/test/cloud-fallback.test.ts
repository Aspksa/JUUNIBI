import { describe, it, expect, vi } from "vitest";
import { Assistant } from "../src/assistant";
import { CloudRuProvider, LlmError, readStream, type ChatOptions, type LlmProvider } from "../src/llm";
import { Memory } from "../src/memory";

const quiet = { debug() {}, info() {}, warn() {}, error() {} } as never;
const ok = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { headers: { "content-type": "application/json" } });
const sse = (lines: object[]) => new Response(lines.map((l) => "data: " + JSON.stringify(l) + "\n\n").join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });

describe("Cloud.ru diagnostics and fallback", () => {
  it("keeps Cloud.ru's own 503 explanation (without the key) in the error", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: { message: "model SECRET-free not deployed" } }), { status: 503 }));
    const p = new CloudRuProvider({ apiKey: "SECRET", model: "m1", fetch: f as never });
    const e = await p.chat([], { retries: 0 }).catch((x) => x);
    expect(e).toBeInstanceOf(LlmError);
    expect(e.status).toBe(503);
    expect(e.message).toContain("модель m1");
    expect(e.message).toContain("not deployed");
    expect(e.message).not.toContain("SECRET");
    expect(e.detail).not.toContain("SECRET");
  });

  it("tries the fallback model once when the main one keeps failing", async () => {
    const models: string[] = [];
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      const model = JSON.parse(String(init.body)).model;
      models.push(model);
      return model === "main" ? new Response("<html>Service Unavailable</html>", { status: 503 }) : ok("запасной ответ");
    });
    const p = new CloudRuProvider({ apiKey: "k", model: "main", fallbackModel: "backup", fetch: f as never });
    const r = await p.chat([], { retries: 1 });
    expect(r.content).toBe("запасной ответ");
    expect(r.model).toBe("backup");
    expect(models).toEqual(["main", "main", "backup"]);
    expect(p.lastModel).toBe("backup");
  });

  it("does not fall back on a client error such as a wrong key", async () => {
    const f = vi.fn(async () => new Response("unauthorized", { status: 401 }));
    const p = new CloudRuProvider({ apiKey: "k", model: "main", fallbackModel: "backup", fetch: f as never });
    await expect(p.chat([])).rejects.toMatchObject({ status: 401 });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("asks for no reasoning phase only when reasoning is switched off, and lists models", async () => {
    const bodies: Record<string, unknown>[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/models")) return new Response(JSON.stringify({ data: [{ id: "b" }, { id: "a" }] }));
      bodies.push(JSON.parse(String(init!.body)));
      return ok("x");
    });
    const p = new CloudRuProvider({ apiKey: "k", model: "m", fetch: f as never });
    await p.chat([]);
    p.setModels({ reasoning: false, model: "m2" });
    await p.chat([]);
    expect(bodies[0]!.chat_template_kwargs).toBeUndefined();
    expect(bodies[1]).toMatchObject({ model: "m2", chat_template_kwargs: { thinking: false, enable_thinking: false } });
    expect(await p.listModels()).toEqual(["a", "b"]);
  });

  it("reports streamed reasoning before the answer text", async () => {
    const seen: string[] = [];
    const res = sse([{ choices: [{ delta: { reasoning_content: "хм" } }] }, { choices: [{ delta: { content: "Ответ" } }] }]);
    const r = await readStream(res.body!, (t) => seen.push("text:" + t), () => {}, () => seen.push("reasoning"));
    expect(r.content).toBe("Ответ");
    expect(seen).toEqual(["reasoning", "text:Ответ"]);
  });
});

describe("assistant chat path", () => {
  it("sends a thinking event once, logs timing, and hides brain tools for simple messages", async () => {
    const offered: string[][] = [];
    const llm: LlmProvider = { chat: async (_m, opts?: ChatOptions) => {
      offered.push((opts?.tools ?? []).map((t) => t.name));
      opts?.onReasoning?.(); opts?.onReasoning?.();
      opts?.onText?.("привет");
      return { content: "привет", toolCalls: [] };
    } };
    const info = vi.fn();
    const a = new Assistant({ llm, memory: new Memory(), log: { ...(quiet as object), info } as never, prefs: () => ({ suggestions: "off", summaries: false }) });
    for (const name of ["brain_v4_unified_review", "brain_create_plan", "note_add"])
      a.tools.register({ name, risk: "read", description: name, parameters: { type: "object", properties: {} }, run: async () => "ok" });
    const events: string[] = [];
    const simple = { needsPlanning: false, needsApproval: false, needsEvidenceReview: false };
    await a.ask("привет", "s", undefined, { brainGuidance: simple, onEvent: (e) => events.push(e.type) });
    expect(events.filter((t) => t === "thinking")).toHaveLength(1);
    expect(offered[0]).toContain("note_add");
    expect(offered[0]).not.toContain("brain_create_plan");
    expect(offered[0]).not.toContain("brain_v4_unified_review");
    expect(String(info.mock.calls.at(-1)?.[0])).toMatch(/ответ за .* первый текст через .* запросов к модели 1/);

    await a.ask("составь план", "s", undefined, { brainGuidance: { ...simple, needsPlanning: true } });
    expect(offered[1]).toContain("brain_create_plan");
    expect(offered[1]).not.toContain("brain_v4_unified_review");
    await a.ask("без мозга", "s");
    expect(offered[2]).toContain("brain_v4_unified_review");
  });
});
