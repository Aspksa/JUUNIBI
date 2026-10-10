export interface ToolCall { id: string; name: string; arguments: string }
export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}
export interface ToolSpec { name: string; description: string; parameters: object }
export interface LlmResponse { content: string | null; toolCalls: ToolCall[]; /** Which model actually answered (set when a fallback was used). */ model?: string }
export interface ChatOptions {
  tools?: ToolSpec[]; signal?: AbortSignal; temperature?: number; maxTokens?: number;
  /** If set, the provider streams and calls this with each text fragment as it arrives. */
  onText?: (text: string) => void;
  /** Per-call override: how long to wait for the first byte (and between streamed chunks). */
  timeoutMs?: number;
  /** Per-call override: extra attempts after a 429/5xx/timeout. */
  retries?: number;
  /** Called when the model streams its hidden reasoning (no answer text yet). */
  onReasoning?: () => void;
}

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
  /** Tried once when the main model keeps answering 5xx or times out. Empty = no fallback. */
  fallbackModel?: string;
  /** false asks the model to answer without a separate reasoning phase (vLLM-style chat_template_kwargs). */
  reasoning?: boolean;
  fetch?: typeof fetch;
}

export const CLOUDRU_DEFAULT_BASE_URL = "https://foundation-models.api.cloud.ru/v1";

export class LlmError extends Error {
  constructor(message: string, readonly status?: number, readonly detail?: string) {
    super(message);
    this.name = "LlmError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Cloud.ru Foundation Models via their OpenAI-compatible chat/completions API. */
export class CloudRuProvider implements LlmProvider {
  private readonly cfg: Required<Omit<CloudRuConfig, "fetch">> & { fetch: typeof fetch };
  /** Which model answered the last successful call. */
  lastModel: string | undefined;

  constructor(cfg: CloudRuConfig) {
    if (!cfg.apiKey) throw new LlmError("CLOUDRU_API_KEY is empty");
    if (!cfg.model) throw new LlmError("CLOUDRU_MODEL is empty");
    this.cfg = {
      baseUrl: CLOUDRU_DEFAULT_BASE_URL,
      timeoutMs: 60_000,
      retries: 2,
      fallbackModel: "",
      reasoning: true,
      ...cfg,
      fetch: cfg.fetch ?? fetch,
    };
    this.cfg.baseUrl = this.cfg.baseUrl.replace(/\/+$/, "");
  }

  /** Switches models without rebuilding the provider (settings page). */
  setModels(m: { model?: string; fallbackModel?: string; reasoning?: boolean }) {
    if (m.model) this.cfg.model = m.model;
    if (m.fallbackModel !== undefined) this.cfg.fallbackModel = m.fallbackModel;
    if (m.reasoning !== undefined) this.cfg.reasoning = m.reasoning;
  }
  models() { return { model: this.cfg.model, fallbackModel: this.cfg.fallbackModel, reasoning: this.cfg.reasoning }; }

  /** Model ids available to this key (GET /models). */
  async listModels(signal?: AbortSignal): Promise<string[]> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15_000);
    const onAbort = () => ctl.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const res = await this.cfg.fetch(`${this.cfg.baseUrl}/models`, { headers: { authorization: `Bearer ${this.cfg.apiKey}` }, signal: ctl.signal });
      if (!res.ok) throw new LlmError(`Cloud.ru вернул ${res.status}${describeBody(await res.text().catch(() => ""), this.cfg.apiKey)}`, res.status);
      const data = ((await res.json()) as { data?: { id?: unknown }[] })?.data;
      return (Array.isArray(data) ? data : []).map((m) => m?.id).filter((id): id is string => typeof id === "string" && id.length <= 200).sort();
    } catch (e) {
      if (e instanceof LlmError) throw this.safeError(e);
      throw new LlmError(`Нет связи с Cloud.ru: ${(e as Error)?.message ?? e}`);
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); }
  }

  /** One tiny request to `model` only (no fallback, no retries): the settings page's «Проверить всё». Returns the time it took. */
  async ping(model: string, timeoutMs = 20_000): Promise<number> {
    const t0 = Date.now();
    await this.attempt(model, [{ role: "user", content: "Ответь одним словом: готово" }], { maxTokens: 8, temperature: 0, timeoutMs }, 0, { streamed: false });
    return Date.now() - t0;
  }

  async chat(messages: Message[], opts: ChatOptions = {}): Promise<LlmResponse> {
    const primary = this.cfg.model;
    const fallback = this.cfg.fallbackModel && this.cfg.fallbackModel !== primary ? this.cfg.fallbackModel : "";
    const state = { streamed: false };
    try {
      return await this.attempt(primary, messages, opts, opts.retries ?? this.cfg.retries, state);
    } catch (e) {
      // A fallback helps only with an outage of the main model, and only before any text reached the user.
      const outage = e instanceof LlmError && (e.status === undefined ? /тайм-аут/.test(e.message) : e.status >= 500 || e.status === 429);
      if (!fallback || !outage || state.streamed || opts.signal?.aborted) throw e;
      try { return await this.attempt(fallback, messages, opts, 0, state); }
      catch (second) {
        if (second instanceof LlmError) throw new LlmError(`${e.message} Запасная модель ${fallback} тоже не ответила: ${second.message}`, (e as LlmError).status, (e as LlmError).detail);
        throw e;
      }
    }
  }

  private async attempt(model: string, messages: Message[], opts: ChatOptions, retries: number, state: { streamed: boolean }): Promise<LlmResponse> {
    const body = {
      model,
      messages: messages.map(({ tool_calls, ...message }) => ({
        ...message,
        ...(tool_calls ? { tool_calls: tool_calls.map(call => ({
          id: call.id, type: "function", function: { name: call.name, arguments: call.arguments },
        })) } : {}),
      })),
      temperature: opts.temperature ?? 0.3,
      ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
      ...(opts.onText ? { stream: true } : {}),
      ...(this.cfg.reasoning ? {} : { chat_template_kwargs: { thinking: false, enable_thinking: false } }),
      ...(opts.tools?.length
        ? { tools: opts.tools.map((t) => ({ type: "function", function: t })), tool_choice: "auto" }
        : {}),
    };
    let lastErr: unknown;
    const onText = opts.onText ? (t: string) => { state.streamed = true; opts.onText!(t); } : undefined;
    const timeoutMs = opts.timeoutMs ?? this.cfg.timeoutMs;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (opts.signal?.aborted) throw new LlmError("Запрос отменён");
      if (attempt) await sleep(500 * 2 ** (attempt - 1));
      const ctl = new AbortController();
      let timer = setTimeout(() => ctl.abort(), timeoutMs);
      const onAbort = () => ctl.abort();
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      try {
        const res = await this.cfg.fetch(`${this.cfg.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${this.cfg.apiKey}` },
          body: JSON.stringify(body),
          signal: ctl.signal,
        });
        if (res.status === 429 || res.status >= 500) {
          // Keep Cloud.ru's own explanation: it tells an outage apart from, say, a model that is not deployed.
          const detail = describeBody(await res.text().catch(() => ""), this.cfg.apiKey).replace(/^: /, "");
          lastErr = new LlmError(`Cloud.ru вернул ${res.status}`, res.status, detail || undefined);
          continue; // retryable
        }
        if (!res.ok) {
          // never echo the request (it carries the key); surface only the server's message
          const text = (await res.text().catch(() => "")).slice(0, 300);
          throw new LlmError(`Cloud.ru вернул ${res.status}: ${text}`, res.status);
        }
        if (opts.onText && /text\/event-stream/i.test(res.headers.get("content-type") ?? "") && res.body) {
          const r = await readStream(res.body, onText!, () => { clearTimeout(timer); timer = setTimeout(() => ctl.abort(), timeoutMs); }, opts.onReasoning);
          this.lastModel = model;
          return model === this.cfg.model ? r : { ...r, model };
        }
        const parsed = parse(await res.json()); // server ignored `stream`: deliver the whole text at once
        if (opts.onText && parsed.content) opts.onText(parsed.content);
        this.lastModel = model;
        return model === this.cfg.model ? parsed : { ...parsed, model };
      } catch (e) {
        if (e instanceof LlmError && e.status && e.status < 500 && e.status !== 429) throw this.safeError(e);
        if (opts.signal?.aborted) throw new LlmError("Запрос отменён");
        lastErr = e;
        if (state.streamed) break;
      } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
      }
    }
    if (lastErr instanceof LlmError && lastErr.status && lastErr.status >= 500) {
      const why = lastErr.detail ? ` Ответ Cloud.ru: «${lastErr.detail}».` : "";
      throw new LlmError(`Cloud.ru временно недоступен (HTTP ${lastErr.status}, модель ${model}).${why} Попробуйте чуть позже.`, lastErr.status, lastErr.detail);
    }
    if (!(lastErr instanceof LlmError) && /abort/i.test(String((lastErr as Error)?.name ?? "") + String((lastErr as Error)?.message ?? "")))
      throw new LlmError(`Cloud.ru недоступен: нет ответа за ${Math.round(timeoutMs / 1000)} с (тайм-аут, модель ${model}). Попробуйте чуть позже.`);
    throw this.safeError(lastErr instanceof LlmError ? lastErr : new LlmError(`Нет связи с Cloud.ru: ${(lastErr as Error)?.message ?? lastErr}`));
  }

  private safeError(error: LlmError): LlmError {
    return new LlmError(error.message.split(this.cfg.apiKey).join("[redacted]"), error.status, error.detail?.split(this.cfg.apiKey).join("[redacted]"));
  }
}

/** A short, single-line, key-free excerpt of an error body (JSON message preferred, HTML tags stripped). */
function describeBody(raw: string, apiKey: string): string {
  let text = raw;
  try {
    const j = JSON.parse(raw) as { error?: { message?: unknown } | string; message?: unknown; detail?: unknown };
    const m = typeof j?.error === "string" ? j.error : j?.error?.message ?? j?.message ?? j?.detail;
    if (typeof m === "string") text = m;
  } catch { /* not JSON */ }
  text = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().split(apiKey).join("[redacted]").slice(0, 200);
  return text ? ": " + text : "";
}

/** Parses an OpenAI-style SSE stream into text deltas + assembled tool calls. */
export async function readStream(body: ReadableStream<Uint8Array>, onText: (t: string) => void, onChunk: () => void = () => {}, onReasoning?: () => void): Promise<LlmResponse> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let content = "";
  const calls = new Map<number, ToolCall>();
  const handle = (line: string): boolean => {
    if (!line.startsWith("data:")) return false;
    const data = line.slice(5).trim();
    if (data === "[DONE]") return true;
    let j: any;
    try { j = JSON.parse(data); } catch { return false; }
    if (j?.error) throw new LlmError(`Cloud.ru: ${String(j.error?.message ?? j.error).slice(0, 300)}`);
    const d = j?.choices?.[0]?.delta;
    if (typeof d?.content === "string" && d.content) { content += d.content; onText(d.content); }
    else if ((typeof d?.reasoning_content === "string" && d.reasoning_content) || (typeof d?.reasoning === "string" && d.reasoning)) onReasoning?.();
    for (const t of d?.tool_calls ?? []) {
      const i = Number(t.index ?? 0);
      const c = calls.get(i) ?? { id: "", name: "", arguments: "" };
      if (t.id) c.id = String(t.id);
      if (t.function?.name) c.name += String(t.function.name);
      if (t.function?.arguments) c.arguments += String(t.function.arguments);
      calls.set(i, c);
    }
    return false;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      onChunk();
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        if (handle(line)) return finish();
      }
    }
    if (buf.trim()) handle(buf.trim());
  } catch (e) {
    if (e instanceof LlmError) throw e;
    throw new LlmError(`Поток прерван: ${(e as Error).message}`);
  } finally { reader.releaseLock?.(); }
  return finish();
  function finish(): LlmResponse {
    const toolCalls = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([i, c]) => ({ id: c.id || `call_${i}`, name: c.name, arguments: c.arguments || "{}" })).filter((c) => c.name);
    return { content: content || null, toolCalls };
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
