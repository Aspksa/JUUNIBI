export interface ToolCall { id: string; name: string; arguments: string }
export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}
export interface ToolSpec { name: string; description: string; parameters: object }
export interface LlmResponse { content: string | null; toolCalls: ToolCall[] }
export interface ChatOptions { tools?: ToolSpec[]; signal?: AbortSignal; temperature?: number }

/** Any chat model backend. Cloud.ru is one implementation; tests use a scripted one. */
export interface LlmProvider {
  chat(messages: Message[], opts?: ChatOptions): Promise<LlmResponse>;
}

export interface CloudRuConfig {
  apiKey: string;
  model: string;
  /** OpenAI-compatible endpoint root. */
  baseUrl?: string;
  timeoutMs?: number;
  retries?: number;
  fetch?: typeof fetch;
}

export const CLOUDRU_DEFAULT_BASE_URL = "https://foundation-models.api.cloud.ru/v1";

export class LlmError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "LlmError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Cloud.ru Foundation Models via their OpenAI-compatible chat/completions API. */
export class CloudRuProvider implements LlmProvider {
  private readonly cfg: Required<Omit<CloudRuConfig, "fetch">> & { fetch: typeof fetch };

  constructor(cfg: CloudRuConfig) {
    if (!cfg.apiKey) throw new LlmError("CLOUDRU_API_KEY is empty");
    if (!cfg.model) throw new LlmError("CLOUDRU_MODEL is empty");
    this.cfg = {
      baseUrl: CLOUDRU_DEFAULT_BASE_URL,
      timeoutMs: 60_000,
      retries: 2,
      ...cfg,
      fetch: cfg.fetch ?? fetch,
    };
    this.cfg.baseUrl = this.cfg.baseUrl.replace(/\/+$/, "");
  }

  async chat(messages: Message[], opts: ChatOptions = {}): Promise<LlmResponse> {
    const body = {
      model: this.cfg.model,
      messages,
      temperature: opts.temperature ?? 0.3,
      ...(opts.tools?.length
        ? { tools: opts.tools.map((t) => ({ type: "function", function: t })), tool_choice: "auto" }
        : {}),
    };
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.cfg.retries; attempt++) {
      if (attempt) await sleep(500 * 2 ** (attempt - 1));
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), this.cfg.timeoutMs);
      opts.signal?.addEventListener("abort", () => ctl.abort(), { once: true });
      try {
        const res = await this.cfg.fetch(`${this.cfg.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${this.cfg.apiKey}` },
          body: JSON.stringify(body),
          signal: ctl.signal,
        });
        if (res.status === 429 || res.status >= 500) {
          lastErr = new LlmError(`Cloud.ru вернул ${res.status}`, res.status);
          continue; // retryable
        }
        if (!res.ok) {
          // never echo the request (it carries the key); surface only the server's message
          const text = (await res.text().catch(() => "")).slice(0, 300);
          throw new LlmError(`Cloud.ru вернул ${res.status}: ${text}`, res.status);
        }
        return parse(await res.json());
      } catch (e) {
        if (e instanceof LlmError && e.status && e.status < 500 && e.status !== 429) throw e;
        if (opts.signal?.aborted) throw new LlmError("Запрос отменён");
        lastErr = e;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr instanceof LlmError ? lastErr : new LlmError(`Нет связи с Cloud.ru: ${(lastErr as Error)?.message ?? lastErr}`);
  }
}

function parse(json: unknown): LlmResponse {
  const msg = (json as { choices?: { message?: { content?: string | null; tool_calls?: unknown[] } }[] })?.choices?.[0]?.message;
  if (!msg) throw new LlmError("Неожиданный ответ модели");
  const toolCalls: ToolCall[] = (msg.tool_calls ?? []).flatMap((c: any, i) =>
    c?.function?.name
      ? [{ id: String(c.id ?? `call_${i}`), name: String(c.function.name), arguments: String(c.function.arguments ?? "{}") }]
      : [],
  );
  return { content: msg.content ?? null, toolCalls };
}
