export interface StorageAdapter {
  load(): Promise<string | null>;
  save(data: string): Promise<void>;
}
export class MemoryAdapter implements StorageAdapter {
  private data: string | null = null;
  async load() { return this.data; }
  async save(d: string) { this.data = d; }
}

export type MemoryKind = "fact" | "preference" | "lesson";
export interface MemoryEntry {
  id: string;
  kind: MemoryKind;
  text: string;
  /** pending entries are proposals; only the user's approval makes them active. */
  status: "active" | "pending";
  score: number;
  createdAt: number;
  expiresAt?: number;
  supersededBy?: string;
  relatedIds?: string[];
}

const normalize = (s: string) => s.normalize("NFKC").toLocaleLowerCase("ru").replace(/ё/g, "е").replace(/\s+/g, " ").trim();
const tokens = (s: string) => normalize(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
const RELATED: readonly (readonly string[])[] = [
  ["помощница", "помощник", "ассистент", "assistant"],
  ["ошибка", "ошибки", "сбой", "сбои", "неполадка"],
  ["проект", "репозиторий", "repository"],
  ["настройка", "настройки", "конфигурация"],
  ["запомни", "память", "воспоминание"],
];
const meaning = (word: string): string => {
  for (const [i, group] of RELATED.entries()) if (group.includes(word)) return "concept:" + i;
  return word.length >= 5 ? word.slice(0, word.length - 2) : word;
};
const concepts = (s: string) => new Set(tokens(s).map(meaning));
const MAX_ENTRIES = 2000;
const MAX_TEXT = 500;

/** Long-term memory with human-approved learning and keyword retrieval. */
export class Memory {
  private entries: MemoryEntry[] = [];
  private ready: Promise<void>;
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly store: StorageAdapter = new MemoryAdapter()) {
    this.ready = this.load();
  }

  private async load() {
    const raw = await this.store.load();
    if (!raw) return;
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) this.entries = arr.slice(0, MAX_ENTRIES).filter((e): e is MemoryEntry =>
        e && typeof e.id === "string" && typeof e.text === "string" && e.text.length <= MAX_TEXT &&
        (e.kind === "fact" || e.kind === "preference" || e.kind === "lesson") &&
        (e.status === "active" || e.status === "pending") &&
        Number.isFinite(e.score) && Number.isFinite(e.createdAt) &&
        (e.expiresAt === undefined || Number.isFinite(e.expiresAt)) &&
        (e.supersededBy === undefined || typeof e.supersededBy === "string") &&
        (e.relatedIds === undefined || (Array.isArray(e.relatedIds) && e.relatedIds.length <= 20 && e.relatedIds.every((id: unknown) => typeof id === "string"))));
    } catch { /* corrupt file: start empty rather than crash */ }
  }
  private persist() {
    const snapshot = JSON.stringify(this.entries);
    this.writing = this.writing.catch(() => {}).then(() => this.store.save(snapshot));
    return this.writing;
  }

  async add(kind: MemoryKind, text: string, status: MemoryEntry["status"] = "pending"): Promise<MemoryEntry> {
    await this.ready;
    const clean = text.trim().slice(0, MAX_TEXT);
    if (!clean) throw new Error("Пустая запись");
    const dup = this.entries.find((e) => normalize(e.text) === normalize(clean));
    if (dup) {
      if (status === "active" && dup.status === "pending") {
        dup.status = "active";
        await this.persist();
      }
      return { ...dup };
    }
    const entry: MemoryEntry = { id: crypto.randomUUID(), kind, text: clean, status, score: 0, createdAt: Date.now() };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      const drop = [...this.entries].sort((a, b) => a.score - b.score || a.createdAt - b.createdAt)[0]!;
      this.entries = this.entries.filter((e) => e !== drop);
    }
    await this.persist();
    return { ...entry };
  }
  async list(status?: MemoryEntry["status"]): Promise<MemoryEntry[]> {
    await this.ready;
    return this.entries.filter((e) => !status || e.status === status).map(e => ({ ...e }));
  }
  async approve(id: string): Promise<boolean> {
    await this.ready;
    const e = this.entries.find((x) => x.id === id);
    if (!e) return false;
    e.status = "active";
    await this.persist();
    return true;
  }
  async forget(id: string): Promise<boolean> {
    await this.ready;
    const n = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    if (this.entries.length === n) return false;
    await this.persist();
    return true;
  }
  /** Mark a fact as superseded only after an explicit caller decision. */
  async supersede(oldId: string, replacementId: string): Promise<boolean> {
    await this.ready;
    if (oldId === replacementId) return false;
    const old = this.entries.find(e => e.id === oldId);
    const next = this.entries.find(e => e.id === replacementId && e.status === "active" && !e.supersededBy);
    if (!old || !next || old.status !== "active") return false;
    old.supersededBy = next.id;
    await this.persist();
    return true;
  }
  async setExpiry(id: string, until: number | null): Promise<boolean> {
    await this.ready;
    const entry = this.entries.find(e => e.id === id);
    if (!entry || (until !== null && (!Number.isFinite(until) || until <= 0))) return false;
    if (until === null) delete entry.expiresAt;
    else entry.expiresAt = until;
    await this.persist();
    return true;
  }
  /** Explicitly connect related facts, without changing their approval status. */
  async relate(aId: string, bId: string): Promise<boolean> {
    await this.ready;
    if (aId === bId) return false;
    const a = this.entries.find(e => e.id === aId);
    const b = this.entries.find(e => e.id === bId);
    if (!a || !b || a.status !== "active" || b.status !== "active") return false;
    a.relatedIds = [...new Set([...(a.relatedIds ?? []), bId])].slice(0, 20);
    b.relatedIds = [...new Set([...(b.relatedIds ?? []), aId])].slice(0, 20);
    await this.persist();
    return true;
  }
  /** Reward/punish entries that were used in an answer. */
  async feedback(ids: string[], delta: number): Promise<void> {
    await this.ready;
    for (const e of this.entries) if (ids.includes(e.id)) e.score += delta;
    await this.persist();
  }
  /** Active entries ranked by word overlap, boosted by past feedback. */
  async search(query: string, k = 5): Promise<MemoryEntry[]> {
    await this.ready;
    if (!Number.isFinite(k) || k <= 0) return [];
    const q = concepts(query);
    if (!q.size) return [];
    return this.entries
      .filter((e) => e.status === "active" && e.score > -3 && !e.supersededBy && (e.expiresAt === undefined || e.expiresAt > Date.now()))
      .map((e) => ({ e, s: [...concepts(e.text)].filter((t) => q.has(t)).length }))
      .filter((x) => x.s > 0)
      .sort((a, b) => (b.s + b.e.score * 0.1) - (a.s + a.e.score * 0.1) || b.e.createdAt - a.e.createdAt)
      .slice(0, Math.min(20, Math.floor(k)))
      .map((x) => ({ ...x.e }));
  }
}
