import { describe, expect, it } from "vitest";
import { runSelfTest } from "../src/self-test";

const settings = { model: "m1", fallbackModel: "", embeddings: true };

describe("runSelfTest", () => {
  it("reports every service, timing the ones it can reach", async () => {
    let t = 0;
    const r = await runSelfTest({
      now: () => (t += 5), settings: { ...settings, fallbackModel: "m2" },
      listModels: async () => ["m1", "m2"], ping: async (m) => { if (m === "m2") throw new Error("Cloud.ru вернул 503"); return 40; },
      embeddings: async () => ({ ok: true, dims: 1024, ms: 12 }), search: async () => ({ provider: "duckduckgo", results: [{}] }),
    });
    expect(r.map((x) => [x.id, x.status])).toEqual([["key", "ok"], ["model", "ok"], ["fallback", "fail"], ["embeddings", "ok"], ["web", "ok"]]);
    expect(r[0]!.detail).toContain("2");
    expect(r[2]!.detail).toContain("503");
    expect(r[3]!.ms).toBe(12);
  });
  it("skips what is switched off and says when there is no key", async () => {
    const r = await runSelfTest({ settings: { ...settings, embeddings: false }, embeddings: async () => ({ ok: false, ms: 0 }) });
    expect(r.map((x) => [x.id, x.status])).toEqual([["key", "fail"], ["model", "skip"], ["fallback", "skip"], ["embeddings", "skip"], ["web", "skip"]]);
    expect(r[0]!.detail).toMatch(/не сохранён/);
    const on = await runSelfTest({ settings, embeddings: async () => ({ ok: false, ms: 0 }) });
    expect(on.find((x) => x.id === "embeddings")).toMatchObject({ status: "skip", detail: expect.stringMatching(/не сохранён/) });
  });
  it("treats an empty search as a failure", async () => {
    const r = await runSelfTest({ settings, listModels: async () => [], embeddings: async () => ({ ok: false, ms: 3, error: "нет модели" }), search: async () => ({ provider: "brave", results: [] }) });
    expect(r.find((x) => x.id === "web")!.status).toBe("fail");
    expect(r.find((x) => x.id === "embeddings")!.detail).toBe("нет модели");
  });
});
