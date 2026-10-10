export interface StorageAdapter {
  load(): Promise<string | null>;
  save(data: string): Promise<void>;
}
export class MemoryAdapter implements StorageAdapter {
  private data: string | null = null;
  async load() { return this.data; }
  async save(d: string) { this.data = d; }
}

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  /** Stable identity (model + endpoint). Saved vectors are reused only for the same id. */
  readonly id?: string;
}
/** Cheap content fingerprint: a saved vector is reused only while the entry text is unchanged. */
const textKey = (text: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36) + ":" + text.length;
};
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
  /** Repeated user statements strengthen a pending proposal, never approve it. */
  mentions?: number;
  /** Marked important by the owner: ranks higher and is the last to be dropped when memory is full. */
  pinned?: boolean;
}

const normalize = (s: string) => s.normalize("NFKC").toLocaleLowerCase("ru").replace(/ё/g, "е").replace(/[.!?…]+$/u, "").replace(/\s+/g, " ").trim();
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
/** Relevance remains the main signal; stable preferences and feedback break close matches. */
const rankMemory = (entry: MemoryEntry, matches: number, now: number): number => {
  const ageDays = Math.max(0, (now - entry.createdAt) / 86_400_000);
  const recency = 0.2 / (1 + ageDays / 90);
  const preference = entry.kind === "preference" ? 0.15 : entry.kind === "lesson" ? 0.05 : 0;
  const feedback = Math.max(-0.4, Math.min(0.4, entry.score * 0.1));
  return matches * 2 + recency + preference + feedback + (entry.pinned ? 0.6 : 0);
};

/** Long-term memory with human-approved learning and keyword retrieval. */
export class Memory {
  private entries: MemoryEntry[] = [];
  private ready: Promise<void>;
  private writing: Promise<void> = Promise.resolve();
  private readonly vectors = new Map<string, { key: string; v: number[] }>();
  private vectorStore: StorageAdapter | undefined;
  private vectorCache: { provider?: string; items?: Record<string, { key: string; v: number[] }> } | null = null;
  private vectorSave: ReturnType<typeof setTimeout> | undefined;
  private embedding: EmbeddingProvider | undefined;
  private embeddingChecks = 0;
  private embeddingFailures = 0;
  private failStreak = 0;
  private pausedUntil = 0;
  private clock: () => number = Date.now;
  /** Tests only. */
  setClock(clock: () => number) { this.clock = clock; }
  /** After this many failures in a row semantic search is skipped for a while, so a wrong model name never slows every reply. */
  static readonly BREAKER_FAILS = 3;
  static readonly BREAKER_PAUSE_MS = 10 * 60_000;
  /** Semantic search may delay a reply at most this long; slower work finishes in the background and is cached. */
  static readonly CHAT_EMBED_BUDGET_MS = 3000;
  embeddingDiagnostics() {
    const paused = this.pausedUntil > this.clock();
    return { configured: !!this.embedding, checks: this.embeddingChecks, failures: this.embeddingFailures, paused,
      ...(paused ? { pausedUntil: this.pausedUntil } : {}), mode: this.embedding ? (paused ? "lexical" : "hybrid") : "lexical" };
  }
  setEmbeddingProvider(provider?: EmbeddingProvider) {
    this.embedding = provider; this.vectors.clear(); this.failStreak = 0; this.pausedUntil = 0;
    this.restoreVectors();
  }
  /** Keeps computed vectors on disk, so the first reply after a restart does not wait for dozens of embedding requests. */
  async setVectorStore(store: StorageAdapter) {
    this.vectorStore = store;
    try {
      const raw = await store.load();
      const parsed = raw ? JSON.parse(raw) : null;
      this.vectorCache = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch { this.vectorCache = null; }
    this.restoreVectors();
  }
  private restoreVectors() {
    const cache = this.vectorCache;
    if (!this.embedding?.id || !cache || cache.provider !== this.embedding.id || !cache.items || typeof cache.items !== "object") return;
    for (const [id, item] of Object.entries(cache.items).slice(0, MAX_ENTRIES)) {
      if (item && typeof item.key === "string" && Array.isArray(item.v) && item.v.length > 0 && item.v.length <= 4096 && item.v.every(Number.isFinite))
        this.vectors.set(id, { key: item.key, v: item.v });
    }
  }
  private rememberVector(id: string, text: string, v: number[]) {
    this.vectors.set(id, { key: textKey(text), v });
    if (!this.vectorStore || !this.embedding?.id || this.vectorSave) return;
    const provider = this.embedding.id;
    this.vectorSave = setTimeout(() => {
      this.vectorSave = undefined;
      if (this.embedding?.id !== provider) return;
      const live = new Set(this.entries.map(e => e.id));
      const items = Object.fromEntries([...this.vectors].filter(([id]) => live.has(id)));
      this.vectorCache = { provider, items };
      void this.vectorStore!.save(JSON.stringify(this.vectorCache)).catch(() => {});
    }, 2000);
    (this.vectorSave as { unref?: () => void }).unref?.();
  }
  /** Try the embedding provider once, bypassing the pause; used by the "check connection" button. */
  async probeEmbedding(): Promise<{ ok: boolean; dims?: number; ms: number; error?: string }> {
    const t0 = this.clock();
    if (!this.embedding) return { ok: false, ms: 0, error: "Поиск по смыслу не настроен" };
    try {
      const v = await this.embedding.embed("проверка соединения");
      this.failStreak = 0; this.pausedUntil = 0;
      return { ok: true, dims: v.length, ms: this.clock() - t0 };
    } catch (e) { return { ok: false, ms: this.clock() - t0, error: (e as Error).message.slice(0, 200) }; }
  }

  constructor(private readonly store: StorageAdapter = new MemoryAdapter()) {
    this.ready = this.load();
  }

  private async load() {
    const raw = await this.store.load();
    if (!raw) return;
    try {
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) throw new Error("Память: неверный формат файла");
      const validated = arr.slice(0, MAX_ENTRIES).filter((e): e is MemoryEntry =>
        e && typeof e.id === "string" && typeof e.text === "string" && e.text.length <= MAX_TEXT &&
        (e.kind === "fact" || e.kind === "preference" || e.kind === "lesson") &&
        (e.status === "active" || e.status === "pending") &&
        Number.isFinite(e.score) && Number.isFinite(e.createdAt) &&
        (e.expiresAt === undefined || Number.isFinite(e.expiresAt)) &&
        (e.supersededBy === undefined || typeof e.supersededBy === "string") &&
        (e.revisesId === undefined || typeof e.revisesId === "string") &&
        (e.mentions === undefined || (Number.isInteger(e.mentions) && e.mentions >= 1 && e.mentions <= 100)) &&
        (e.pinned === undefined || typeof e.pinned === "boolean") &&
        (e.relatedIds === undefined || (Array.isArray(e.relatedIds) && e.relatedIds.length <= 20 && e.relatedIds.every((id: unknown) => typeof id === "string"))));
      if (arr.length > MAX_ENTRIES || validated.length !== arr.length) throw new Error("Память: некоторые записи повреждены");
      this.entries = validated;
    } catch (error) { throw new Error("Память повреждена: изменения заблокированы для предотвращения потери данных", { cause: error }); }
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
      if (status === "pending" && dup.status === "pending") {
        dup.mentions = Math.min(100, (dup.mentions ?? 1) + 1);
        await this.persist();
      }
      if (status === "active" && dup.status === "pending") {
        dup.status = "active";
        await this.persist();
      }
      return copyEntry(dup);
    }
    const entry: MemoryEntry = { id: crypto.randomUUID(), kind, text: clean, status, score: 0, createdAt: Date.now(), mentions: 1 };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      // Never evict the record being added; prefer pending proposals over approved knowledge.
      const others = this.entries.filter((e) => e !== entry);
      const drop = (others.some((e) => !e.pinned) ? others.filter((e) => !e.pinned) : others)
        .sort((a, b) => Number(a.status === "active") - Number(b.status === "active") || a.score - b.score || a.createdAt - b.createdAt)[0]!;
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
  /** Mark an entry as important (or not). Pinned entries rank higher and are dropped last. */
  async setPinned(id: string, pinned: boolean): Promise<boolean> {
    await this.ready;
    const entry = this.entries.find(e => e.id === id);
    if (!entry) return false;
    if (pinned) entry.pinned = true; else delete entry.pinned;
    await this.persist();
    return true;
  }
  /** Everything worth carrying to another installation. Vectors and feedback scores stay behind. */
  async exportData(): Promise<{ app: "JUUNIBI"; kind: "memory"; version: 1; exportedAt: string; entries: Pick<MemoryEntry, "kind" | "text" | "status" | "createdAt" | "expiresAt" | "pinned">[] }> {
    await this.ready;
    return { app: "JUUNIBI", kind: "memory", version: 1, exportedAt: new Date(this.clock()).toISOString(),
      entries: this.entries.filter(e => !e.supersededBy).map(e => ({ kind: e.kind, text: e.text, status: e.status, createdAt: e.createdAt, ...(e.expiresAt !== undefined ? { expiresAt: e.expiresAt } : {}), ...(e.pinned ? { pinned: true } : {}) })) };
  }
  /**
   * Imported entries ALWAYS arrive as pending proposals: a file can never put anything into active memory.
   * Duplicates, oversized and secret-looking texts are skipped and counted.
   */
  async importData(input: unknown): Promise<{ added: number; duplicates: number; skipped: number }> {
    await this.ready;
    const list = Array.isArray(input) ? input : input && typeof input === "object" ? (input as { entries?: unknown }).entries : undefined;
    if (!Array.isArray(list)) throw Object.assign(new Error("Ожидается файл экспорта памяти JUUNIBI"), { status: 400 });
    if (list.length > 500) throw Object.assign(new Error("В одном файле не больше 500 записей"), { status: 400 });
    const secret = /(?:api[_ -]?key|парол[ья]|password|токен|secret|bearer|ключ доступа|паспорт|снилс)/iu;
    let added = 0, duplicates = 0, skipped = 0;
    for (const raw of list) {
      const r = raw as { kind?: unknown; text?: unknown; expiresAt?: unknown } | null;
      const kind = r?.kind === "preference" || r?.kind === "lesson" ? r.kind : r?.kind === "fact" ? "fact" : null;
      const text = typeof r?.text === "string" ? r.text.trim() : "";
      if (!kind || !text || text.length > MAX_TEXT || secret.test(text) || /\d(?:[ -]?\d){9,}/u.test(text)) { skipped++; continue; }
      if (this.entries.some(e => normalize(e.text) === normalize(text))) { duplicates++; continue; }
      const entry = await this.add(kind, text, "pending");
      const stored = this.entries.find(e => e.id === entry.id);
      if (stored && typeof r?.expiresAt === "number" && Number.isFinite(r.expiresAt) && r.expiresAt > this.clock()) { stored.expiresAt = r.expiresAt; await this.persist(); }
      added++;
    }
    return { added, duplicates, skipped };
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
    if (!this.embedding || !query.trim() || k <= 0 || this.pausedUntil > this.clock()) return lexical.slice(0, Math.max(0, k));
    this.embeddingChecks++;
    const embedding = this.embedding;
    const valid = (v: number[]) => v.length > 0 && v.length <= 4096 && v.every(Number.isFinite);
    let gotQuery = false;
    const semantic = (async () => {
      const q = await embedding.embed(query);
      gotQuery = true;
      if (!valid(q)) return lexical.slice(0, k);
      const recent = (await this.list("active")).filter(e => !e.supersededBy && (e.expiresAt === undefined || e.expiresAt > Date.now()) && e.score > -3).slice(-20);
      const active = [...new Map([...lexical, ...recent].map(e => [e.id, e])).values()];
      const ranked = await Promise.all(active.map(async e => {
        const cached = this.vectors.get(e.id);
        let v = cached && cached.key === textKey(e.text) ? cached.v : undefined;
        if (!v) { v = await embedding.embed(e.text); if (valid(v)) this.rememberVector(e.id, e.text, v); }
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
    })();
    const failed = () => {
      this.embeddingFailures++;
      if (++this.failStreak >= Memory.BREAKER_FAILS) this.pausedUntil = this.clock() + Memory.BREAKER_PAUSE_MS;
      return lexical.slice(0, Math.min(20, Math.floor(k)));
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const slow = new Promise<"slow">((resolve) => { timer = setTimeout(() => resolve("slow"), Memory.CHAT_EMBED_BUDGET_MS); });
    try {
      const result = await Promise.race([semantic, slow]);
      if (result === "slow") {
        // Too slow for a waiting user: answer by keywords now; vectors that arrive later are kept for next time.
        semantic.catch(() => {});
        return gotQuery ? lexical.slice(0, Math.min(20, Math.floor(k))) : failed();
      }
      this.failStreak = 0;
      return result;
    } catch {
      return failed();
    } finally { clearTimeout(timer); }
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
  /** A model may nominate a replacement, but only existing pending entries can be linked. */
  async linkPendingRevision(pendingId: string, oldId: string): Promise<boolean> {
    await this.ready;
    if (pendingId === oldId) return false;
    const pending = this.entries.find(e => e.id === pendingId && e.status === "pending" && e.kind === "preference");
    const old = this.entries.find(e => e.id === oldId && e.status === "active" && e.kind === "preference" && !e.supersededBy && (e.expiresAt === undefined || e.expiresAt > Date.now()));
    if (!pending || !old || pending.revisesId || this.entries.some(e => e.id !== pendingId && e.status === "pending" && e.revisesId === oldId)) return false;
    const stop = new Set(["я", "мне", "мой", "моя", "мои", "предпочитаю", "люблю", "нравится", "когда", "чтобы", "всегда", "обычно", "больше", "меньше"]);
    const topic = (text: string) => new Set(tokens(text).map(meaning).filter(w => !stop.has(w) && w.length > 2));
    const current = topic(pending.text), previous = topic(old.text);
    if (![...current].some(word => previous.has(word))) return false;
    pending.revisesId = oldId;
    await this.persist();
    return true;
  }
  /** Only recognize explicit opposite values of the same named preference, never guess contradictions. */
  private conflictingPreference(candidate: string): MemoryEntry | undefined {
    const pairs: readonly (readonly string[])[] = [
      ["тёмную", "светлую"], ["темную", "светлую"],
      ["тёмный", "светлый"], ["темный", "светлый"],
      ["включённые", "выключенные"], ["включенные", "выключенные"],
    ];
    const clean = normalize(candidate);
    const words = clean.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    for (const [left, right] of pairs) {
      const hasLeft = words.includes(normalize(left!));
      const hasRight = words.includes(normalize(right!));
      if (hasLeft === hasRight) continue;
      const opposite = hasLeft ? normalize(right!) : normalize(left!);
      const shared = words.filter(w => w !== (hasLeft ? normalize(left!) : normalize(right!)));
      if (!shared.length) continue;
      const old = this.entries.find(e => {
        if (e.kind !== "preference" || e.status !== "active" || e.supersededBy || (e.expiresAt !== undefined && e.expiresAt <= Date.now())) return false;
        const oldWords = normalize(e.text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
        return oldWords.includes(opposite) && shared.every(w => oldWords.includes(w)) &&
          oldWords.filter(w => w !== opposite).every(w => shared.includes(w));
      });
      if (old) return old;
    }
    return undefined;
  }
  /** Conservative opt-in-style extraction from direct user statements. Never auto-approves. */
  async suggestFromUserText(input: string): Promise<MemoryEntry[]> {
    if (typeof input !== "string" || input.length > 2000) return [];
    const text = input.trim();
    if (text.includes("?")) return []; // questions are not statements about the user
    if (text.includes("\n") || text.startsWith(">") || text.startsWith("\"") || text.startsWith("«")) return [];
    const patterns: { re: RegExp; kind: MemoryKind; whole?: boolean }[] = [
      { re: /^(?:запомни|пожалуйста,? запомни)(?:,? что)?[:\s]+(.+)$/iu, kind: "fact" },
      { re: /^(?:имей в виду|не забудь|помни)(?:,? что)?[:\s]+(.+)$/iu, kind: "fact" },
      { re: /^я предпочитаю[:\s]+(.+)$/iu, kind: "preference" },
      { re: /^мне нравится,? когда[:\s]+(.+)$/iu, kind: "preference" },
      // Statements that only make sense with their opening words are stored whole.
      { re: /^(?:меня зовут|моё имя|мое имя)\s+\S.*$/iu, kind: "fact", whole: true },
      { re: /^я (?:живу|работаю|учусь|занимаюсь)\s+\S.*$/iu, kind: "fact", whole: true },
      { re: /^(?:называй меня|не называй меня)\s+\S.*$/iu, kind: "preference", whole: true },
      { re: /^(?:всегда|обычно|пожалуйста)\s+(?:отвечай|пиши|говори|объясняй)\s+\S.*$/iu, kind: "preference", whole: true },
      { re: /^мне (?:не )?(?:нравится|нравятся|подходит|подходят)\s+\S.*$/iu, kind: "preference", whole: true },
    ];
    if (/(?:api[_ -]?key|парол[ья]|password|токен|secret|bearer|ключ доступа|паспорт|снилс|диагноз|телефон|адрес проживания)/iu.test(text)) return [];
    for (const { re, kind, whole } of patterns) {
      const match = re.exec(text);
      if (!match) continue;
      const candidate = (whole ? match[0] : match[1])?.trim().replace(/[.!]+$/u, "");
      if (!candidate || candidate.length < 6 || candidate.length > 300 ||
          /(?:api[_ -]?key|парол[ья]|password|токен|secret|bearer|ключ доступа)/iu.test(candidate)) return [];
      const conflict = kind === "preference" ? this.conflictingPreference(candidate) : undefined;
      if (conflict) {
        const proposal = await this.proposeRevision(conflict.id, candidate);
        return proposal ? [proposal] : [];
      }
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
    const now = Date.now();
    return this.entries
      .filter((e) => e.status === "active" && e.score > -3 && !e.supersededBy && (e.expiresAt === undefined || e.expiresAt > now))
      .map((e) => ({ e, s: [...concepts(e.text)].filter((t) => q.has(t)).length }))
      .filter((x) => x.s > 0)
      .sort((a, b) => rankMemory(b.e, b.s, now) - rankMemory(a.e, a.s, now) || b.e.createdAt - a.e.createdAt)
      .slice(0, Math.min(20, Math.floor(k)))
      .map((x) => copyEntry(x.e));
  }
}
