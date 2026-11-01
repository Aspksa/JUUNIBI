/** Durable at-least-once delivery outbox. Acknowledgement is authoritative; presentation is not.
 * The caller persists snapshot() with the organizer and invokes dispatch() on ticks.
 */
export type DeliveryState = "pending" | "sent" | "acknowledged" | "failed";
export interface DeliveryRecord {
  id: string; userId: string; reminderId: string; text: string; createdAt: number;
  nextAttemptAt: number; attempts: number; state: DeliveryState; acknowledgedAt?: number;
  lastError?: string;
}
export class DeliveryOutbox {
  private records = new Map<string, DeliveryRecord>();
  constructor(saved: DeliveryRecord[] = [], private readonly maxAttempts = 12) {
    for (const item of saved) this.records.set(item.id, { ...item });
  }
  enqueue(userId: string, reminderId: string, text: string, now = Date.now()): DeliveryRecord {
    const id = userId + ":" + reminderId;
    const previous = this.records.get(id);
    if (previous) return { ...previous };
    const entry: DeliveryRecord = { id, userId, reminderId, text, createdAt: now, nextAttemptAt: now, attempts: 0, state: "pending" };
    this.records.set(id, entry);
    return { ...entry };
  }
  acknowledge(userId: string, reminderId: string, now = Date.now()): boolean {
    const item = this.records.get(userId + ":" + reminderId);
    if (!item) return false;
    item.state = "acknowledged"; item.acknowledgedAt = now; item.nextAttemptAt = Number.MAX_SAFE_INTEGER;
    return true;
  }
  /** Remove old acknowledged/terminal records; never erase pending deliveries. */
  prune(before: number): number {
    let removed = 0;
    for (const [id, entry] of this.records) {
      if ((entry.state === "acknowledged" || entry.state === "failed") && (entry.acknowledgedAt ?? entry.createdAt) < before) {
        this.records.delete(id);
        removed++;
      }
    }
    return removed;
  }
  snapshot(userId?: string): DeliveryRecord[] {
    return [...this.records.values()].filter(x => !userId || x.userId === userId).map(x => ({ ...x }));
  }
  async dispatch(send: (entry: Readonly<DeliveryRecord>) => Promise<void>, now = Date.now()): Promise<number> {
    let attempted = 0;
    for (const entry of this.records.values()) {
      if (entry.state === "acknowledged" || entry.state === "failed" || entry.nextAttemptAt > now) continue;
      attempted++;
      try {
        await send({ ...entry });
        if (this.records.get(entry.id)?.state === "acknowledged") continue;
        entry.state = "sent"; delete entry.lastError;
      } catch (error) {
        if (this.records.get(entry.id)?.state === "acknowledged") continue;
        entry.state = "pending"; entry.lastError = String(error).slice(0, 300);
      }
      entry.attempts++;
      if (entry.attempts >= this.maxAttempts) { entry.state = "failed"; continue; }
      const delay = Math.min(24 * 60 * 60_000, 30_000 * 2 ** Math.min(entry.attempts - 1, 11));
      entry.nextAttemptAt = now + delay;
    }
    return attempted;
  }
}
