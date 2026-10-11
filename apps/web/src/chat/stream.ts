export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "thinking" }
  | { type: "brain_review"; review: unknown }
  | { type: "tool"; phase: "start"; id: string; name: string; args: string }
  | { type: "tool"; phase: "end"; id: string; name: string; status: "ok" | "error" | "denied"; ms: number }
  | { type: "done"; turnId: string; reply: string; tools: string[]; memory?: string[] } | { type: "error"; message: string };

/** POSTs to /api/chat/stream and yields NDJSON events. Aborting the signal cancels generation on the server too. */
export async function streamChat(body: { message: string; history: { role: string; content: string }[]; session?: string }, signal: AbortSignal, onEvent: (e: StreamEvent) => void): Promise<void> {
  const res = await fetch("/api/chat/stream", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    const j = await res.json().catch(() => ({}));
    throw new Error((j as { error?: string }).error ?? `Ошибка ${res.status}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const MAX_LINE = 2 * 1024 * 1024;
  const flushLine = (line: string) => {
    if (!line.trim()) return;
    if (line.length > MAX_LINE) throw new Error("Ответ помощницы слишком большой");
    let event: unknown;
    try { event = JSON.parse(line); } catch { throw new Error("Некорректное событие ответа помощницы"); }
    if (!event || typeof event !== "object" || !["delta", "thinking", "tool", "done", "error", "brain_review"].includes(String((event as { type?: unknown }).type))) throw new Error("Некорректное событие ответа помощницы");
    onEvent(event as StreamEvent);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    if (buf.length > MAX_LINE && !buf.includes("\n")) throw new Error("Превышен лимит буфера ответа");
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) { flushLine(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
  }
  flushLine(buf);
}
