import { api } from "../api";
import type { Chats } from "./chats";
import type { ChatController } from "./controller";

const PUSH_DELAY = 1500;
const PULL_EVERY = 20_000;

/**
 * Keeps the chats of this browser and of the computer's server in step, so the phone and the computer
 * see the same history. Both sides merge (never replace); a chat being answered right now is left alone.
 */
export class ChatSync {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private applying = false;
  private inFlight = false;
  private dirty = false;
  /** Off after the server said it has no such route (an older server): no point asking again. */
  private off = false;

  constructor(private readonly chats: Chats, private readonly ctl: ChatController) {}

  start() {
    void this.pull(true);
    this.chats.store.subscribe(() => { if (!this.applying) this.schedule(); });
    // a reply that finished streaming is sent at once
    this.ctl.store.subscribe(() => { if (!this.ctl.busy && this.dirty) this.schedule(); });
    setInterval(() => { if (document.visibilityState === "visible") void this.pull(); }, PULL_EVERY);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void this.pull(); });
    addEventListener("pagehide", () => { if (this.dirty) void this.push(); });
  }

  private schedule() {
    this.dirty = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.push(), PUSH_DELAY);
  }

  private take(remote: unknown) {
    this.applying = true;
    try { return this.chats.applySync(remote, this.ctl.store.get().busyId); }
    finally { this.applying = false; }
  }

  private async pull(first = false) {
    if (this.off || this.inFlight) return;
    this.inFlight = true;
    try {
      const r = await api.chatsGet();
      if (!r.ok) { if (/404|Не найдено/.test(r.error.message)) this.off = true; return; }
      this.take(r.value);
      // the first time, send what only this browser had (chats from before syncing existed)
      if (first) this.schedule();
    } finally { this.inFlight = false; }
  }

  private async push() {
    if (this.off) return;
    // while an answer streams, its chat changes many times a second: send once it is done
    if (this.ctl.busy) { this.dirty = true; return; }
    if (this.inFlight) { this.schedule(); return; }
    this.inFlight = true; this.dirty = false;
    try {
      const r = await api.chatsPut(this.chats.syncState());
      if (r.ok) this.take(r.value);
      else if (/404|Не найдено/.test(r.error.message)) this.off = true;
      else this.dirty = true;
    } finally { this.inFlight = false; }
  }
}
