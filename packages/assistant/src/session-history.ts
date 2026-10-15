import type { Message } from "./llm";

/**
 * Small in-process fallback history for callers that do not provide client-held history.
 * It is intentionally non-persistent: durable conversation state belongs to the client/turn journal.
 */
export class SessionHistory {
  private readonly sessions = new Map<string, Message[]>();

  constructor(private readonly maxMessages: number) {
    if (!Number.isInteger(maxMessages) || maxMessages < 1) throw new RangeError("maxMessages must be a positive integer");
  }

  get(session: string): Message[] {
    return (this.sessions.get(session) ?? []).map((message) => ({ ...message }));
  }

  appendTurn(session: string, user: string, assistant: string): void {
    const current = this.sessions.get(session) ?? [];
    current.push(
      { role: "user", content: user },
      { role: "assistant", content: assistant },
    );
    this.sessions.set(session, current.slice(-this.maxMessages));
  }

  clear(session: string): void {
    this.sessions.delete(session);
  }
}
