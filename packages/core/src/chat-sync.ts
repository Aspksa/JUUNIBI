/**
 * Chats shared by the computer and the phone: each side keeps its own copy and they are merged, never replaced.
 * A conversation wins by its last change (`syncAt`, else `updatedAt`); a deletion wins over changes made before it.
 */
export interface SyncConversation { id: string; updatedAt: number; syncAt?: number }
export interface ChatSyncState<C extends SyncConversation = SyncConversation> { items: C[]; deleted: Record<string, number> }

export const SYNC_MAX_CONVERSATIONS = 100;
/** Deletions older than this are forgotten: every device has long since seen them. */
const TOMBSTONE_DAYS = 90;

export const changedAt = (c: SyncConversation) => Math.max(Number(c.syncAt) || 0, Number(c.updatedAt) || 0);

export function mergeChatSync<C extends SyncConversation>(a: ChatSyncState<C>, b: ChatSyncState<C>, now = Date.now(), max = SYNC_MAX_CONVERSATIONS): ChatSyncState<C> {
  const deleted: Record<string, number> = {};
  const cutoff = now - TOMBSTONE_DAYS * 86_400_000;
  for (const src of [a.deleted, b.deleted]) for (const [id, at] of Object.entries(src ?? {})) {
    if (typeof at === "number" && Number.isFinite(at) && at > cutoff && at > (deleted[id] ?? 0)) deleted[id] = at;
  }
  const byId = new Map<string, C>();
  for (const c of [...(a.items ?? []), ...(b.items ?? [])]) {
    if (!c || typeof c.id !== "string") continue;
    const have = byId.get(c.id);
    if (!have || changedAt(c) > changedAt(have)) byId.set(c.id, c);
  }
  const items = [...byId.values()]
    .filter((c) => !(deleted[c.id] && deleted[c.id]! >= changedAt(c)))
    .sort((x, y) => y.updatedAt - x.updatedAt)
    .slice(0, max);
  return { items, deleted };
}

/** Same conversations with the same changes: nothing to send or store. */
export function sameChatSync(a: ChatSyncState, b: ChatSyncState): boolean {
  if (a.items.length !== b.items.length) return false;
  const m = new Map(b.items.map((c) => [c.id, changedAt(c)]));
  return a.items.every((c) => m.get(c.id) === changedAt(c)) && Object.keys(a.deleted).length === Object.keys(b.deleted).length;
}
