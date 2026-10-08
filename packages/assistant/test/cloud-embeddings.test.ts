import { describe, expect, it, vi } from "vitest";
import { CloudEmbeddingProvider } from "../src/embeddings";

describe("CloudEmbeddingProvider", () => {
  it("sends model and input to the configured endpoint", async () => {
    const mock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }), { status: 200 }));
    const provider = new CloudEmbeddingProvider({
      apiKey: "test-key", model: "BAAI/bge-m3",
      fetch: mock as unknown as typeof fetch,
    });
    expect(await provider.embed("Привет")).toEqual([0.1, 0.2, 0.3]);
    expect(mock.mock.calls[0]?.[0]).toBe("https://foundation-models.api.cloud.ru/v1/embeddings");
    const body = JSON.parse(String(mock.mock.calls[0]?.[1].body));
    expect(body).toEqual({ model: "BAAI/bge-m3", input: "Привет" });
  });
  it("rejects invalid vectors and HTTP errors", async () => {
    const invalid = new CloudEmbeddingProvider({
      apiKey: "key", model: "some-model", fetch: async () => new Response(JSON.stringify({ data: [{ embedding: [NaN] }] }), { status: 200 }),
    });
    await expect(invalid.embed("a")).rejects.toThrow();
    const unavailable = new CloudEmbeddingProvider({
      apiKey: "key", model: "some-model", fetch: async () => new Response("", { status: 404 }),
    });
    await expect(unavailable.embed("a")).rejects.toThrow("404");
  });
});
