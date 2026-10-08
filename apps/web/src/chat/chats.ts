import { Store, attempt } from "@juunibi/core";

export interface ChatMsg {
  id: string; role: "user" | "assistant"; content: string; at: number;
  turnId?: string; rating?: 1 | -1; scene?: { action: string; phrase?: string }; tools?: string[];
  error?: string; stopped?: boolean;
}
export interface Conversation { id: string; title: string; createdAt: number; updatedAt: number; messages: ChatMsg[] }
export interface ChatsState { items: Conversation[]; activeId: string | null }

export const DEFAULT_TITLE = "Новый чат";
const KEY = "juunibi:chats:v1";
const MAX_CONVERSATIONS = 100;
const MAX_MESSAGES = 300;
const uid = () => crypto.randomUUID();

function sanitize(raw: unknown): Conversation[] {
  if (!Array.isArray(raw)) return [];
  const out: Conversation[] = [];
  for (const c of raw) {
    if (!c || typeof c.id !== "string" || !Array.isArray(c.messages)) continue;
    const messages: ChatMsg[] = c.messages.filter((m: ChatMsg) => m && typeof m.id === "string" && (m.role === "user" || m.role === "assistant") && typeof m.content === "string");
    // a message that was streaming when the page closed is finished by definition
    for (const m of messages) if (m.role === "assistant" && !m.turnId && !m.error && !m.content) { m.error = "Ответ не был получен."; }
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
    const items = r.ok && r.value ? sanitize(r.value.items) : [];
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
  clearAll() { this.store.set({ items: [], activeId: null }); }

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
