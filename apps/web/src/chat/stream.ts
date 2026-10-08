export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "tool"; phase: "start"; id: string; name: string; args: string }
  | { type: "tool"; phase: "end"; id: string; name: string; status: "ok" | "error" | "denied"; ms: number }
  | { type: "done"; turnId: string; reply: string; tools: string[]; memory?: string[] } | { type: "error"; message: string };

/** POSTs to /api/chat/stream and yields NDJSON events. Aborting the signal cancels generation on the server too. */
export async function streamChat(body: { message: string; history: { role: string; content: string }[] }, signal: AbortSignal, onEvent: (e: StreamEvent) => void): Promise<void> {
  const res = await fetch("/api/chat/stream", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    const j = await res.json().catch(() => ({}));
    throw new Error((j as { error?: string }).error ?? `Ошибка ${res.status}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const flushLine = (line: string) => { if (!line.trim()) return; try { onEvent(JSON.parse(line) as StreamEvent); } catch { /* ignore a malformed line */ } };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) { flushLine(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
  }
  flushLine(buf);
}
