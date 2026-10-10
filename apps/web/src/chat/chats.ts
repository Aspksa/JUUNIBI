import { Store, attempt } from "@juunibi/core";

export interface Step { id: string; name: string; status: "running" | "ok" | "error" | "denied"; ms?: number }
export interface ChatMsg {
  id: string; role: "user" | "assistant" | "note"; content: string; at: number;
  turnId?: string; rating?: 1 | -1; scene?: { action: string; phrase?: string }; tools?: string[];
  steps?: Step[]; memoryUsed?: string[]; files?: { name: string; size: number; text: string }[];
  error?: string; stopped?: boolean;
}
export interface Conversation { id: string; title: string; createdAt: number; updatedAt: number; messages: ChatMsg[] }
export interface ChatsState { items: Conversation[]; activeId: string | null }

export const DEFAULT_TITLE = "Новый чат";
const KEY = "juunibi:chats:v1";
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
  // a message that was streaming when the page closed is finished by definition
  if (out.role === "assistant" && !out.turnId && !out.error && !out.content) out.error = "Ответ не был получен.";
  return out;
}

function sanitize(raw: unknown): Conversation[] {
  if (!Array.isArray(raw)) return [];
  const out: Conversation[] = [];
  const seen = new Set<string>();
  for (const c of raw) {
    if (!isObj(c) || typeof c.id !== "string" || !Array.isArray(c.messages) || seen.has(c.id)) continue;
    seen.add(c.id);
    const messages = c.messages.map(cleanMessage).filter((m): m is ChatMsg => m !== null);
    out.push({ id: c.id, title: typeof c.title === "string" && c.title ? c.title.slice(0, 120) : DEFAULT_TITLE, createdAt: Number(c.createdAt) || Date.now(), updatedAt: Number(c.updatedAt) || Date.now(), messages });
  }
  return out.slice(0, MAX_CONVERSATIONS);
}

/** Conversations live in this browser (localStorage); the client is the source of truth for history. */
export class Chats {
  readonly store: Store<ChatsState>;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    const r = attempt(() => JSON.parse(localStorage.getItem(KEY) ?? "null") as { items?: unknown; activeId?: unknown } | null);
    const clean = r.ok && r.value ? attempt(() => sanitize(r.value!.items)) : null;
    const items = clean?.ok ? clean.value : [];
    const activeId = r.ok && r.value && typeof r.value.activeId === "string" && items.some((c) => c.id === r.value!.activeId) ? (r.value.activeId as string) : (items[0]?.id ?? null);
    this.store = new Store<ChatsState>({ items, activeId });
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
  remove(id: string) {
    this.store.set((s) => {
      const items = s.items.filter((c) => c.id !== id);
      return { items, activeId: s.activeId === id ? (items[0]?.id ?? null) : s.activeId };
    });
  }
  rename(id: string, title: string) { const t = title.trim().slice(0, 120); if (t) this.update(id, (c) => ({ ...c, title: t })); }
  clearMessages(id: string) { this.update(id, (c) => ({ ...c, messages: [] })); }
  clearAll() { this.store.set({ items: [], activeId: null }); }
  /** Puts back conversations removed by `clearAll` (the "Отменить" in the toast). */
  restore(items: Conversation[]) { this.store.set((s) => ({ items: [...s.items, ...items.filter((c) => !s.items.some((x) => x.id === c.id))].slice(0, MAX_CONVERSATIONS), activeId: s.activeId ?? items[0]?.id ?? null })); }
  /**
   * Adds conversations from an exported JSON file; ones already here (same id) are skipped.
   * Chats already in this browser are never pushed out: only as many as fit under MAX_CONVERSATIONS are added
   * (newest first), and `dropped` says how many did not fit.
   */
  importJson(raw: unknown): { added: number; dropped: number } {
    const have = new Set(this.store.get().items.map((c) => c.id));
    const fresh = sanitize(raw).filter((c) => !have.has(c.id)).sort((a, b) => b.updatedAt - a.updatedAt);
    const fit = fresh.slice(0, Math.max(0, MAX_CONVERSATIONS - have.size));
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
  /** Drops `msgId` and everything after it (used by edit / regenerate). */
  truncateFrom(id: string, msgId: string) {
    this.update(id, (c) => { const i = c.messages.findIndex((m) => m.id === msgId); return i < 0 ? c : { ...c, messages: c.messages.slice(0, i) }; });
  }
  private update(id: string, fn: (c: Conversation) => Conversation, touch = true) {
    this.store.set((s) => ({ items: s.items.map((c) => (c.id === id ? (touch ? { ...fn(c), updatedAt: Date.now() } : fn(c)) : c)) }));
  }

  private schedulePersist() { clearTimeout(this.timer); this.timer = setTimeout(() => this.persistNow(), 400); }
  persistNow() {
    clearTimeout(this.timer);
    let { items } = this.store.get();
    const activeId = this.store.get().activeId;
    for (let tries = 0; tries < 6; tries++) {
      const r = attempt(() => localStorage.setItem(KEY, JSON.stringify({ items, activeId })));
      if (r.ok) return;
      items = items.slice(0, Math.max(1, Math.floor(items.length / 2))); // quota: keep the newest half
    }
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
