import { Store, attempt, mergeChatSync, sameChatSync, type ChatSyncState } from "@juunibi/core";

export interface Step { id: string; name: string; status: "running" | "ok" | "error" | "denied"; ms?: number }
/** One answer to the same question; «Сгенерировать заново» keeps the earlier ones. */
export interface Version { content: string; at: number; turnId?: string; rating?: 1 | -1; tools?: string[]; steps?: Step[]; memoryUsed?: string[]; error?: string; stopped?: boolean }
export interface ChatMsg {
  id: string; role: "user" | "assistant" | "note"; content: string; at: number;
  turnId?: string; rating?: 1 | -1; scene?: { action: string; phrase?: string }; tools?: string[];
  steps?: Step[]; memoryUsed?: string[]; files?: { name: string; size: number; text: string }[];
  error?: string; stopped?: boolean;
  /** Every answer to this question (the shown one included) and which of them is shown. */
  versions?: Version[]; vi?: number;
  /** Questions the owner may ask next (under the last answer only). */
  followUps?: string[];
}
export type ChatArea = "work" | "personal";
export interface Conversation {
  id: string; title: string; createdAt: number; updatedAt: number; messages: ChatMsg[];
  pinned?: boolean; area?: ChatArea;
  /** Last change of any kind (a rating, a finished answer): what the computer and the phone compare. */
  syncAt?: number;
  /** The title was given by the owner: the assistant does not rename it. */
  named?: boolean;
}
export interface ChatsState { items: Conversation[]; activeId: string | null }

export const DEFAULT_TITLE = "Новый чат";
const KEY = "juunibi:chats:v1";
const DELETED_KEY = "juunibi:chats:deleted:v1";
const MAX_VERSIONS = 6;
const BACKUP_KEY = "juunibi:chats:backup:v1";
const MAX_CONVERSATIONS = 100;
const MAX_MESSAGES = 300;
/**
 * crypto.randomUUID exists only in secure contexts (https or localhost). The phone opens JUUNIBI over plain
 * http on the home network, so fall back to a v4 UUID built from getRandomValues, which works everywhere.
 */
export function uid(c: Pick<Crypto, "getRandomValues"> & { randomUUID?: () => string } = crypto): string {
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const strings = (x: unknown): string[] | undefined => (Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : undefined);
const STEP_STATUS = ["running", "ok", "error", "denied"];

/** One stored message with every optional field checked: a damaged file or storage must never break rendering. */
function cleanMessage(m: unknown): ChatMsg | null {
  if (!isObj(m) || typeof m.id !== "string" || (m.role !== "user" && m.role !== "assistant" && m.role !== "note") || typeof m.content !== "string") return null;
  const out: ChatMsg = { id: m.id, role: m.role, content: m.content, at: Number(m.at) || Date.now() };
  if (typeof m.turnId === "string") out.turnId = m.turnId;
  if (m.rating === 1 || m.rating === -1) out.rating = m.rating;
  if (isObj(m.scene) && typeof m.scene.action === "string") out.scene = { action: m.scene.action, ...(typeof m.scene.phrase === "string" ? { phrase: m.scene.phrase } : {}) };
  const tools = strings(m.tools); if (tools) out.tools = tools;
  const used = strings(m.memoryUsed); if (used) out.memoryUsed = used;
  if (Array.isArray(m.steps)) {
    // a step that was running when the page closed is finished by definition
    out.steps = m.steps.filter((st): st is Step => isObj(st) && typeof st.id === "string" && typeof st.name === "string" && STEP_STATUS.includes(st.status as string))
      .map((st) => ({ id: st.id, name: st.name, status: st.status === "running" ? "error" : st.status, ...(typeof st.ms === "number" ? { ms: st.ms } : {}) }));
  }
  if (Array.isArray(m.files)) out.files = m.files.filter((f): f is { name: string; size: number; text: string } => isObj(f) && typeof f.name === "string" && typeof f.text === "string")
    .map((f) => ({ name: f.name, size: Number(f.size) || f.text.length, text: f.text }));
  if (typeof m.error === "string") out.error = m.error;
  if (m.stopped === true) out.stopped = true;
  if (Array.isArray(m.versions)) {
    const vs = m.versions.filter((v): v is Record<string, unknown> => isObj(v) && typeof v.content === "string").slice(-MAX_VERSIONS)
      .map((v) => cleanVersion(v));
    if (vs.length > 1) { out.versions = vs; out.vi = Math.min(vs.length - 1, Math.max(0, Number(m.vi) || 0)); }
  }
  const follow = strings(m.followUps); if (follow?.length) out.followUps = follow.slice(0, 3);
  // a message that was streaming when the page closed is finished by definition
  if (out.role === "assistant" && !out.turnId && !out.error && !out.content) out.error = "Ответ не был получен.";
  return out;
}

function cleanVersion(v: Record<string, unknown>): Version {
  const out: Version = { content: String(v.content), at: Number(v.at) || Date.now() };
  if (typeof v.turnId === "string") out.turnId = v.turnId;
  if (v.rating === 1 || v.rating === -1) out.rating = v.rating;
  const tools = strings(v.tools); if (tools) out.tools = tools;
  const used = strings(v.memoryUsed); if (used) out.memoryUsed = used;
  if (Array.isArray(v.steps)) out.steps = v.steps.filter((st): st is Step => isObj(st) && typeof st.id === "string" && typeof st.name === "string" && STEP_STATUS.includes(st.status as string) && st.status !== "running");
  if (typeof v.error === "string") out.error = v.error;
  if (v.stopped === true) out.stopped = true;
  return out;
}
/** The shown answer as a version (to keep it when another one is generated or picked). */
export function versionOf(m: ChatMsg): Version {
  const v: Version = { content: m.content, at: m.at };
  if (m.turnId) v.turnId = m.turnId;
  if (m.rating) v.rating = m.rating;
  if (m.tools) v.tools = m.tools;
  if (m.steps) v.steps = m.steps;
  if (m.memoryUsed) v.memoryUsed = m.memoryUsed;
  if (m.error) v.error = m.error;
  if (m.stopped) v.stopped = true;
  return v;
}

function sanitize(raw: unknown): Conversation[] {
  if (!Array.isArray(raw)) return [];
  const out: Conversation[] = [];
  const seen = new Set<string>();
  for (const c of raw) {
    if (!isObj(c) || typeof c.id !== "string" || !Array.isArray(c.messages) || seen.has(c.id)) continue;
    seen.add(c.id);
    const messages = c.messages.map(cleanMessage).filter((m): m is ChatMsg => m !== null);
    const conv: Conversation = { id: c.id, title: typeof c.title === "string" && c.title ? c.title.slice(0, 120) : DEFAULT_TITLE, createdAt: Number(c.createdAt) || Date.now(), updatedAt: Number(c.updatedAt) || Date.now(), messages };
    if (c.pinned === true) conv.pinned = true;
    if (c.area === "work" || c.area === "personal") conv.area = c.area;
    if (Number(c.syncAt) > 0) conv.syncAt = Number(c.syncAt);
    if (c.named === true) conv.named = true;
    out.push(conv);
  }
  return out.slice(0, MAX_CONVERSATIONS);
}

/** Conversations live in this browser (localStorage); the client is the source of truth for history. */
export class Chats {
  readonly store: Store<ChatsState>;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Chats deleted here, so the other device deletes them too (id -> when). */
  private deleted: Record<string, number> = {};

  constructor() {
    const r = attempt(() => JSON.parse(localStorage.getItem(KEY) ?? "null") as { items?: unknown; activeId?: unknown } | null);
    const fallback = !r.ok || !r.value || !Array.isArray(r.value.items);
    const restored = fallback ? attempt(() => JSON.parse(localStorage.getItem(BACKUP_KEY) ?? "null") as { items?: unknown; activeId?: unknown } | null) : r;
    const source = restored.ok && restored.value && Array.isArray(restored.value.items) ? restored : r;
    const clean = source.ok && source.value ? attempt(() => sanitize(source.value!.items)) : null;
    const items = clean?.ok ? clean.value : [];
    const activeId = source.ok && source.value && typeof source.value.activeId === "string" && items.some((c) => c.id === source.value!.activeId) ? (source.value.activeId as string) : (items[0]?.id ?? null);
    this.store = new Store<ChatsState>({ items, activeId });
    const del = attempt(() => JSON.parse(localStorage.getItem(DELETED_KEY) ?? "{}") as Record<string, number>);
    if (del.ok && isObj(del.value)) for (const [id, at] of Object.entries(del.value)) if (typeof at === "number") this.deleted[id] = at;
    this.store.subscribe(() => this.schedulePersist());
    addEventListener("pagehide", () => this.persistNow());
  }

  active(): Conversation | undefined { const s = this.store.get(); return s.items.find((c) => c.id === s.activeId); }
  get(id: string): Conversation | undefined { return this.store.get().items.find((c) => c.id === id); }

  /** Starts a fresh chat; reuses the current one if it is still empty. */
  create(): Conversation {
    const cur = this.active();
    if (cur && cur.messages.length === 0) return cur;
    const c: Conversation = { id: uid(), title: DEFAULT_TITLE, createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
    this.store.set((s) => ({ items: [c, ...s.items].slice(0, MAX_CONVERSATIONS), activeId: c.id }));
    return c;
  }
  select(id: string) { if (this.get(id)) this.store.set({ activeId: id }); }
  remove(id: string) { this.removeMany([id]); }
  removeMany(ids: string[]) {
    const gone = new Set(ids);
    const now = Date.now();
    for (const id of ids) this.deleted[id] = now;
    this.store.set((s) => {
      const items = s.items.filter((c) => !gone.has(c.id));
      return { items, activeId: s.activeId && gone.has(s.activeId) ? (items[0]?.id ?? null) : s.activeId };
    });
  }
  /** Renamed by the owner: the assistant never renames it again. `auto` is the assistant's own title. */
  rename(id: string, title: string, auto = false) { const t = title.trim().slice(0, 120); if (t) this.update(id, (c) => ({ ...c, title: t, ...(auto ? {} : { named: true }) }), false); }
  setPinned(id: string, pinned: boolean) { this.update(id, (c) => { const { pinned: _, ...rest } = c; return pinned ? { ...rest, pinned: true } : rest; }, false); }
  setArea(id: string, area: ChatArea | null) { this.update(id, (c) => { const { area: _, ...rest } = c; return area ? { ...rest, area } : rest; }, false); }
  /** A copy of the chat to try another direction without losing this one. */
  duplicate(id: string): Conversation | undefined {
    const src = this.get(id);
    if (!src) return undefined;
    const now = Date.now();
    const copy: Conversation = { ...src, id: uid(), title: (src.title + " (копия)").slice(0, 120), named: true, createdAt: now, updatedAt: now, syncAt: now, messages: src.messages.map((m) => ({ ...m, id: uid() })) };
    delete copy.pinned;
    this.store.set((s) => ({ items: [copy, ...s.items].slice(0, MAX_CONVERSATIONS), activeId: copy.id }));
    return copy;
  }
  clearMessages(id: string) { this.update(id, (c) => ({ ...c, messages: [] })); }
  clearAll() { const now = Date.now(); for (const c of this.store.get().items) this.deleted[c.id] = now; this.store.set({ items: [], activeId: null }); }
  /** Puts back conversations removed by `clearAll` (the "Отменить" in the toast). */
  restore(items: Conversation[]) {
    const now = Date.now();
    for (const c of items) delete this.deleted[c.id];
    this.store.set((s) => ({ items: [...s.items, ...items.filter((c) => !s.items.some((x) => x.id === c.id)).map((c) => ({ ...c, syncAt: now }))].slice(0, MAX_CONVERSATIONS), activeId: s.activeId ?? items[0]?.id ?? null }));
  }

  /** What is sent to the other device. */
  syncState(): ChatSyncState<Conversation> { return { items: this.store.get().items, deleted: { ...this.deleted } }; }
  /**
   * Takes in what the other device has: newer chats replace older ones, deleted ones go away.
   * A chat being answered right now (`busyId`) keeps this device's copy. Returns true when something changed here.
   */
  applySync(remote: unknown, busyId: string | null = null): boolean {
    const r = isObj(remote) ? remote : {};
    const theirs = { items: sanitize(r.items), deleted: isObj(r.deleted) ? Object.fromEntries(Object.entries(r.deleted).filter((e): e is [string, number] => typeof e[1] === "number")) : {} };
    if (busyId) { theirs.items = theirs.items.filter((c) => c.id !== busyId); delete theirs.deleted[busyId]; }
    const mine = this.syncState();
    const merged = mergeChatSync(mine, theirs, Date.now(), MAX_CONVERSATIONS);
    this.deleted = merged.deleted;
    if (sameChatSync(merged, mine)) return false;
    this.store.set((s) => ({ items: merged.items, activeId: s.activeId && merged.items.some((c) => c.id === s.activeId) ? s.activeId : (merged.items[0]?.id ?? null) }));
    return true;
  }
  /**
   * Adds conversations from an exported JSON file; ones already here (same id) are skipped.
   * Chats already in this browser are never pushed out: only as many as fit under MAX_CONVERSATIONS are added
   * (newest first), and `dropped` says how many did not fit.
   */
  importJson(raw: unknown): { added: number; dropped: number } {
    const have = new Set(this.store.get().items.map((c) => c.id));
    const fresh = sanitize(raw).filter((c) => !have.has(c.id)).sort((a, b) => b.updatedAt - a.updatedAt);
    const now = Date.now();
    const fit = fresh.slice(0, Math.max(0, MAX_CONVERSATIONS - have.size)).map((c) => { delete this.deleted[c.id]; return { ...c, syncAt: now }; });
    if (fit.length) this.store.set((s) => {
      const items = [...s.items, ...fit].sort((a, b) => b.updatedAt - a.updatedAt);
      return { items, activeId: s.activeId ?? items[0]?.id ?? null };
    });
    return { added: fit.length, dropped: fresh.length - fit.length };
  }

  append(id: string, msg: Omit<ChatMsg, "id" | "at"> & Partial<Pick<ChatMsg, "id" | "at">>): ChatMsg {
    const full: ChatMsg = { id: uid(), at: Date.now(), ...msg };
    this.update(id, (c) => ({ ...c, updatedAt: Date.now(), messages: [...c.messages, full].slice(-MAX_MESSAGES) }));
    return full;
  }
  patch(id: string, msgId: string, patch: Partial<ChatMsg>) {
    this.update(id, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === msgId ? { ...m, ...patch } : m)) }), false);
  }
  /** Rewrites one message whole (for removing fields, which `patch` cannot do). */
  rewrite(id: string, msgId: string, fn: (m: ChatMsg) => ChatMsg) {
    this.update(id, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === msgId ? fn(m) : m)) }), false);
  }
  /** Drops `msgId` and everything after it (used by edit / regenerate). */
  truncateFrom(id: string, msgId: string) {
    this.update(id, (c) => { const i = c.messages.findIndex((m) => m.id === msgId); return i < 0 ? c : { ...c, messages: c.messages.slice(0, i) }; });
  }
  private update(id: string, fn: (c: Conversation) => Conversation, touch = true) {
    const now = Date.now();
    this.store.set((s) => ({ items: s.items.map((c) => (c.id === id ? { ...fn(c), ...(touch ? { updatedAt: now } : {}), syncAt: now } : c)) }));
  }

  private schedulePersist() { clearTimeout(this.timer); this.timer = setTimeout(() => this.persistNow(), 400); }
  persistNow() {
    clearTimeout(this.timer);
    const { items } = this.store.get();
    const activeId = this.store.get().activeId;
    // Never silently overwrite the durable archive with a truncated conversation list.
    // Preserve one previous complete checkpoint for recovery after a corrupt primary value.
    const previous = attempt(() => localStorage.getItem(KEY));
    if (previous.ok && previous.value) {
      const valid = attempt(() => JSON.parse(previous.value!) as { items?: unknown });
      if (valid.ok && Array.isArray(valid.value?.items)) attempt(() => localStorage.setItem(BACKUP_KEY, previous.value!));
    }
    const r = attempt(() => localStorage.setItem(KEY, JSON.stringify({ items, activeId })));
    attempt(() => localStorage.setItem(DELETED_KEY, JSON.stringify(this.deleted)));
    if (!r.ok) console.error("JUUNIBI: не удалось сохранить историю чатов — хранилище браузера заполнено", r.error);
  }
}

export function groupLabel(ts: number, now = new Date()): string {
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(new Date(ts))) / 86_400_000);
  return days <= 0 ? "Сегодня" : days === 1 ? "Вчера" : days <= 7 ? "Предыдущие 7 дней" : days <= 30 ? "Предыдущие 30 дней" : "Ранее";
}

export function titleFrom(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 48 ? t.slice(0, 47).trimEnd() + "…" : t || DEFAULT_TITLE;
}
