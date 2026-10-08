export interface StorageAdapter {
  load(): Promise<string | null>;
  save(data: string): Promise<void>;
}
export class MemoryAdapter implements StorageAdapter {
  private data: string | null = null;
  async load() { return this.data; }
  async save(d: string) { this.data = d; }
}

export interface EmbeddingProvider { embed(text: string): Promise<number[]> }
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
  revisesId?: string;
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
  const nounForm = word.replace(/(?:ами|ями|ого|ому|ему|ом|ем|ах|ях|ов|ев|ы|и|а|я|у|ю|е|о)$/u, "");
  for (const [i, group] of RELATED.entries()) {
    if (group.includes(word) || group.includes(nounForm)) return "concept:" + i;
  }
  return word.length >= 5 ? word.slice(0, word.length - 2) : word;
};
const concepts = (s: string) => new Set(tokens(s).map(meaning));
const copyEntry = (entry: MemoryEntry): MemoryEntry => ({ ...entry, ...(entry.relatedIds ? { relatedIds: [...entry.relatedIds] } : {}) });
const MAX_ENTRIES = 2000;
const MAX_TEXT = 500;

/** Long-term memory with human-approved learning and keyword retrieval. */
export class Memory {
  private entries: MemoryEntry[] = [];
  private ready: Promise<void>;
  private writing: Promise<void> = Promise.resolve();
  private readonly vectors = new Map<string, number[]>();
  private embedding: EmbeddingProvider | undefined;
  private embeddingChecks = 0;
  private embeddingFailures = 0;
  embeddingDiagnostics() { return { configured: !!this.embedding, checks: this.embeddingChecks, failures: this.embeddingFailures, mode: this.embedding ? "hybrid" : "lexical" }; }
  setEmbeddingProvider(provider?: EmbeddingProvider) { this.embedding = provider; this.vectors.clear(); }

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
        (e.revisesId === undefined || typeof e.revisesId === "string") &&
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
      return copyEntry(dup);
    }
    const entry: MemoryEntry = { id: crypto.randomUUID(), kind, text: clean, status, score: 0, createdAt: Date.now() };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      const drop = [...this.entries].sort((a, b) => a.score - b.score || a.createdAt - b.createdAt)[0]!;
      this.entries = this.entries.filter((e) => e !== drop);
    }
    await this.persist();
    return copyEntry(entry);
  }
  async list(status?: MemoryEntry["status"]): Promise<MemoryEntry[]> {
    await this.ready;
    return this.entries.filter((e) => !status || e.status === status).map(copyEntry);
  }
  async approve(id: string): Promise<boolean> {
    await this.ready;
    const e = this.entries.find((x) => x.id === id);
    if (!e || e.status !== "pending") return false;
    if (e.revisesId && !this.entries.some(x => x.id === e.revisesId && x.status === "active" && !x.supersededBy)) return false;
    e.status = "active";
    if (e.revisesId) {
      const old = this.entries.find(x => x.id === e.revisesId && x.status === "active" && !x.supersededBy);
      if (old) old.supersededBy = e.id;
    }
    await this.persist();
    return true;
  }
  async forget(id: string): Promise<boolean> {
    await this.ready;
    const n = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    if (this.entries.length === n) return false;
    for (const entry of this.entries) {
      if (entry.relatedIds) entry.relatedIds = entry.relatedIds.filter(link => link !== id);
      if (entry.revisesId === id) delete entry.revisesId;
      if (entry.supersededBy === id) delete entry.supersededBy;
    }
    this.vectors.delete(id);
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
  /** Optional semantic reranking. Lexical results remain available when the provider fails. */
  async searchHybrid(query: string, k = 5): Promise<MemoryEntry[]> {
    const lexical = await this.search(query, 20);
    if (!this.embedding || !query.trim() || k <= 0) return lexical.slice(0, Math.max(0, k));
    try {
      this.embeddingChecks++;
      const q = await this.embedding.embed(query);
      const valid = (v: number[]) => v.length > 0 && v.length <= 4096 && v.every(Number.isFinite);
      if (!valid(q)) return lexical.slice(0, k);
      const recent = (await this.list("active")).filter(e => !e.supersededBy && (e.expiresAt === undefined || e.expiresAt > Date.now()) && e.score > -3).slice(-20);
      const active = [...new Map([...lexical, ...recent].map(e => [e.id, e])).values()];
      const ranked = await Promise.all(active.map(async e => {
        let v = this.vectors.get(e.id);
        if (!v) { v = await this.embedding!.embed(e.text); if (valid(v)) this.vectors.set(e.id, v); }
        if (!v || !valid(v) || v.length !== q.length) return { e, score: -1 };
        const dot = v.reduce((n, x, i) => n + x * q[i]!, 0);
        const na = Math.hypot(...v), nb = Math.hypot(...q);
        const similarity = na && nb ? dot / (na * nb) : -1;
        return { e, score: similarity };
      }));
      const lexicalRanks = new Map(lexical.map((e, i) => [e.id, i]));
      return ranked.filter(x => x.score > 0.15 || lexicalRanks.has(x.e.id))
        .sort((a, b) => (b.score + (lexicalRanks.has(b.e.id) ? 0.2 / (1 + lexicalRanks.get(b.e.id)!) : 0)) -
          (a.score + (lexicalRanks.has(a.e.id) ? 0.2 / (1 + lexicalRanks.get(a.e.id)!) : 0)))
        .slice(0, Math.min(20, Math.floor(k))).map(x => copyEntry(x.e));
    } catch {
      this.embeddingFailures++;
      return lexical.slice(0, Math.min(20, Math.floor(k)));
    }
  }
  /** Explicitly propose a new version; it stays pending until approved. */
  async proposeRevision(oldId: string, newText: string): Promise<MemoryEntry | null> {
    await this.ready;
    const old = this.entries.find(e => e.id === oldId && e.status === "active" && !e.supersededBy && (e.expiresAt === undefined || e.expiresAt > Date.now()));
    if (!old || !newText.trim() || normalize(old.text) === normalize(newText)) return null;
    if (this.entries.some(e => e.status === "pending" && e.revisesId === oldId)) return null;
    const proposal = await this.add(old.kind, newText, "pending");
    const stored = this.entries.find(e => e.id === proposal.id);
    if (!stored || stored.status !== "pending" || (stored.revisesId && stored.revisesId !== oldId)) return null;
    stored.revisesId = oldId;
    await this.persist();
    return copyEntry(stored);
  }
  /** Conservative opt-in-style extraction from direct user statements. Never auto-approves. */
  async suggestFromUserText(input: string): Promise<MemoryEntry[]> {
    if (typeof input !== "string" || input.length > 2000) return [];
    const text = input.trim();
    if (text.includes("\n") || text.startsWith(">") || text.startsWith("\"") || text.startsWith("«")) return [];
    const patterns: { re: RegExp; kind: MemoryKind }[] = [
      { re: /^(?:запомни|пожалуйста,? запомни)(?:,? что)?[:\s]+(.+)$/iu, kind: "fact" },
      { re: /^я предпочитаю[:\s]+(.+)$/iu, kind: "preference" },
      { re: /^мне нравится,? когда[:\s]+(.+)$/iu, kind: "preference" },
    ];
    if (/(?:api[_ -]?key|парол[ья]|password|токен|secret|bearer|ключ доступа|паспорт|снилс|диагноз|телефон|адрес проживания)/iu.test(text)) return [];
    for (const { re, kind } of patterns) {
      const match = re.exec(text);
      if (!match) continue;
      const candidate = match?.[1]?.trim();
      if (!candidate || candidate.length < 6 || candidate.length > 300 ||
          /(?:api[_ -]?key|парол[ья]|password|токен|secret|bearer|ключ доступа)/iu.test(candidate)) return [];
      const entry = await this.add(kind, candidate, "pending");
      return entry.status === "pending" ? [entry] : [];
    }
    return [];
  }
  /** Keep context compact and only include confirmed, non-expired records. */
  async context(query: string, maxChars = 1500): Promise<MemoryEntry[]> {
    const results = await this.searchHybrid(query, 8);
    const selected: MemoryEntry[] = [];
    let used = 0;
    for (const e of results) {
      if (used + e.text.length > Math.max(0, maxChars)) continue;
      selected.push(e); used += e.text.length;
    }
    return selected;
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
      .map((x) => copyEntry(x.e));
  }
}
