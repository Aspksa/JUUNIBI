import { describe, expect, it } from "vitest";
import { DeliveryOutbox } from "./delivery-outbox";
describe("delivery outbox", () => {
  it("deduplicates and synchronizes acknowledgements across instances using snapshots", async () => {
    const a = new DeliveryOutbox();
    a.enqueue("owner", "reminder", "test", 100);
    a.enqueue("owner", "reminder", "test", 100);
    expect(a.snapshot()).toHaveLength(1);
    const b = new DeliveryOutbox(a.snapshot());
    expect(b.acknowledge("owner", "reminder", 200)).toBe(true);
    expect(b.snapshot("owner")[0]!.state).toBe("acknowledged");
    expect(await b.dispatch(async () => { throw Error("should not send"); }, 300)).toBe(0);
  });
  it("retries failures with exponential backoff and stops after configured attempts", async () => {
    const q = new DeliveryOutbox([], 2);
    q.enqueue("u", "r", "text", 100);
    expect(await q.dispatch(async () => { throw Error("offline"); }, 100)).toBe(1);
    expect(q.snapshot()[0]!.nextAttemptAt).toBe(30_100);
    expect(await q.dispatch(async () => {}, 101)).toBe(0);
    expect(await q.dispatch(async () => { throw Error("offline"); }, 30_100)).toBe(1);
    expect(q.snapshot()[0]!.state).toBe("failed");
  });
  it("does not retry acknowledged messages even when acknowledgement arrives during send", async () => {
    const q = new DeliveryOutbox();
    q.enqueue("u", "r", "text", 1);
    await q.dispatch(async () => { q.acknowledge("u", "r", 2); }, 1);
    expect(q.snapshot()[0]!.state).toBe("acknowledged");
  });
});
