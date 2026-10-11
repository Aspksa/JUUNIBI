import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { mergeChatSync, sameChatSync, type ChatSyncState, type SyncConversation } from "@juunibi/core";

type Conv = SyncConversation & Record<string, unknown>;
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/** Only the outline is checked here; each browser cleans every message itself when it reads the chats. */
export function cleanSync(raw: unknown): ChatSyncState<Conv> {
  const o = isObj(raw) ? raw : {};
  const items = (Array.isArray(o.items) ? o.items : [])
    .filter((c): c is Conv => isObj(c) && typeof c.id === "string" && c.id.length <= 64 && Array.isArray(c.messages) && Number.isFinite(Number(c.updatedAt)))
    .map((c) => ({ ...c, updatedAt: Number(c.updatedAt), ...(c.syncAt !== undefined ? { syncAt: Number(c.syncAt) || 0 } : {}) }));
  const deleted: Record<string, number> = {};
  if (isObj(o.deleted)) for (const [id, at] of Object.entries(o.deleted)) if (id.length <= 64 && typeof at === "number" && Number.isFinite(at)) deleted[id] = at;
  return { items, deleted };
}

/** Chats shared by the computer and the phone (data/chats.json). Every write is a merge, so no device erases another's chats. */
export class ChatStore {
  private state: ChatSyncState<Conv> = { items: [], deleted: {} };
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string) {}

  async load() {
    let text: string;
    try { text = await readFile(this.file, "utf8"); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return; throw e; }
    this.state = cleanSync(JSON.parse(text));
  }
  get(): ChatSyncState<Conv> { return this.state; }

  /** Merges what a device sent and returns the result, which the device merges back. */
  put(raw: unknown): Promise<ChatSyncState<Conv>> {
    const run = this.queue.then(async () => {
      const next = mergeChatSync(this.state, cleanSync(raw));
      if (!sameChatSync(next, this.state)) { this.state = next; await this.save(); }
      return this.state;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Atomic replace; Windows with OneDrive sometimes holds the file for a moment, so the rename is retried. */
  private async save() {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = this.file + "." + randomUUID() + ".tmp";
    await writeFile(tmp, JSON.stringify(this.state));
    for (let i = 0; ; i++) {
      try { await rename(tmp, this.file); return; }
      catch (e) {
        if (i >= 4) { await rm(tmp, { force: true }); throw e; }
        await new Promise((r) => setTimeout(r, 120 * (i + 1)));
      }
    }
  }
}
