import type { EmbeddingProvider } from "./memory";

export interface CloudEmbeddingOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Optional, OpenAI-compatible embeddings endpoint. Never log credentials or user content. */
export class CloudEmbeddingProvider implements EmbeddingProvider {
  private readonly endpoint: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  readonly id: string;
  constructor(private readonly options: CloudEmbeddingOptions) {
    if (!options.apiKey || !options.model) throw new Error("Embedding model and key are required");
    const base = new URL((options.baseUrl ?? "https://foundation-models.api.cloud.ru/v1").replace(/\/+$/, "") + "/");
    if (base.protocol !== "https:" && !(base.hostname === "127.0.0.1" || base.hostname === "localhost")) throw new Error("HTTPS required");
    this.endpoint = new URL("embeddings", base).toString();
    this.id = options.model + "@" + this.endpoint;
    this.fetcher = options.fetch ?? fetch;
    this.timeoutMs = Math.max(1000, Math.min(options.timeoutMs ?? 12000, 30000));
  }
  async embed(text: string): Promise<number[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(this.endpoint, {
        method: "POST",
        headers: { authorization: "Bearer " + this.options.apiKey, "content-type": "application/json" },
        body: JSON.stringify({ model: this.options.model, input: text.slice(0, 8000) }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Embedding API HTTP " + response.status);
      const body: unknown = await response.json();
      const data = (body as { data?: { embedding?: unknown }[] })?.data;
      const vector = data?.[0]?.embedding;
      if (!Array.isArray(vector) || !vector.length || vector.length > 4096 ||
          !vector.every(x => typeof x === "number" && Number.isFinite(x))) throw new Error("Invalid embedding response");
      return vector as number[];
    } finally {
      clearTimeout(timer);
    }
  }
}
