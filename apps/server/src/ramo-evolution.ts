import { suggestConversationLessons, type LessonProposal, type StorageAdapter } from "@juunibi/assistant";

export interface EvolutionConfig {
  enabled: boolean;
  intervalMinutes: 15 | 30 | 60;
  night: boolean;
  memory: boolean;
  personality: boolean;
  quality: boolean;
}
export interface EvolutionItem extends LessonProposal {
  createdAt: number;
  status: "pending" | "accepted" | "rejected";
}
export interface EvolutionState {
  config: EvolutionConfig;
  queue: EvolutionItem[];
  processed: Record<string, number>;
  lastRun: number;
  lastError: string | null;
  runs: number;
  analyzedMessages: number;
  qualitySignals: number;
  memoryDigest: string[];
}
const defaults = (): EvolutionState => ({
  config: { enabled: false, intervalMinutes: 30, night: true, memory: true, personality: true, quality: true },
  queue: [], processed: {}, lastRun: 0, lastError: null, runs: 0, analyzedMessages: 0, qualitySignals: 0, memoryDigest: [],
});
const signature = (value: string): string => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
};
/** Persistent, bounded, opt-in background analysis. Never approves or changes a lesson. */
export class RamoEvolution {
  private state = defaults();
  private readonly ready: Promise<void>;
  private pending: Promise<unknown> = Promise.resolve();
  private running = false;
  constructor(private readonly store: StorageAdapter, private readonly readChats: () => readonly {
    id: string; messages: readonly { id?: string; role: string; content: string; at?: number }[];
  }[], private readonly now: () => number = Date.now) {
    this.ready = this.load().catch(() => { this.state = defaults(); });
  }
  private async load() {
    const raw = await this.store.load();
    if (raw === null) return;
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object") throw new Error("Invalid evolution state");
    const s = data as Partial<EvolutionState>;
    if (!s.config || !Array.isArray(s.queue) || !s.processed || typeof s.processed !== "object" ||
        !Number.isFinite(s.lastRun) || !Number.isFinite(s.runs)) throw new Error("Invalid evolution state");
    const interval = s.config.intervalMinutes;
    if (![15, 30, 60].includes(interval) || ["enabled", "night", "memory", "personality", "quality"].some(k =>
      typeof s.config?.[k as keyof EvolutionConfig] !== "boolean")) throw new Error("Invalid evolution config");
    this.state = {
      config: { ...defaults().config, ...s.config },
      queue: s.queue.filter(x => x && typeof x.id === "string" && typeof x.lesson === "string" &&
        Array.isArray(x.evidence) && typeof x.confidence === "number" &&
        ["pending", "accepted", "rejected"].includes(x.status)).slice(-200),
      processed: Object.fromEntries(Object.entries(s.processed).filter(([k, v]) =>
        k.length <= 100 && typeof v === "number" && Number.isFinite(v)).slice(-10000)),
      lastRun: s.lastRun!, lastError: typeof s.lastError === "string" ? s.lastError.slice(0, 300) : null,
      runs: s.runs!, analyzedMessages: Number.isFinite(s.analyzedMessages) ? s.analyzedMessages! : 0,
      qualitySignals: Number.isFinite(s.qualitySignals) ? s.qualitySignals! : 0,
      memoryDigest: Array.isArray(s.memoryDigest) ? s.memoryDigest.filter(x => typeof x === "string").slice(-30) : [],
    };
  }
  private mutate<T>(fn: () => T | Promise<T>): Promise<T> {
    const task = this.pending.then(async () => {
      await this.ready;
      const result = await fn();
      await this.store.save(JSON.stringify(this.state));
      return result;
    });
    this.pending = task.then(() => undefined, () => undefined);
    return task;
  }
  async snapshot(): Promise<EvolutionState & { running: boolean }> {
    await this.ready; await this.pending;
    return { ...structuredClone(this.state), running: this.running };
  }
  configure(patch: Partial<EvolutionConfig>): Promise<void> {
    return this.mutate(() => {
      if (!patch || typeof patch !== "object" || Object.keys(patch).some(k =>
        !["enabled", "intervalMinutes", "night", "memory", "personality", "quality"].includes(k)))
        throw new Error("Invalid evolution settings");
      if (patch.intervalMinutes !== undefined && ![15, 30, 60].includes(patch.intervalMinutes))
        throw new Error("Invalid interval");
      for (const [k, v] of Object.entries(patch)) {
        if (k !== "intervalMinutes" && typeof v !== "boolean") throw new Error("Invalid setting");
      }
      this.state.config = { ...this.state.config, ...patch };
    });
  }
  decide(id: string, decision: "accepted" | "rejected"): Promise<EvolutionItem> {
    return this.mutate(() => {
      const item = this.state.queue.find(x => x.id === id && x.status === "pending");
      if (!item) throw new Error("Unknown pending lesson");
      item.status = decision;
      return structuredClone(item);
    });
  }
  async run(force = false): Promise<void> {
    await this.ready;
    if (this.running) return;
    this.running = true;
    try {
      await this.mutate(() => {
        const now = this.now();
        const s = this.state;
        if (!s.config.enabled || (!force && now - s.lastRun < s.config.intervalMinutes * 60_000)) return;
        const candidates: { role: string; content: string }[] = [];
        for (const chat of this.readChats().slice(-100)) {
          for (const msg of chat.messages.slice(-300)) {
            if (msg.role !== "user" || typeof msg.content !== "string") continue;
            const key = signature(chat.id + ":" + (msg.id ?? "") + ":" + msg.content);
            if (s.processed[key]) continue;
            s.processed[key] = now;
            s.analyzedMessages++;
            candidates.push({ role: "user", content: msg.content });
          }
        }
        if (s.config.quality) {
          const normalized = candidates.map(x => x.content.trim().toLowerCase());
          s.qualitySignals += normalized.length - new Set(normalized).size;
        }
        if (s.config.memory && (!s.config.night || new Date(now).getHours() < 7)) {
          s.memoryDigest = candidates.slice(-30).map(x => x.content.replace(/\\s+/g, " ").slice(0, 160));
        }
        if (s.config.personality) {
          const existing = new Set(s.queue.map(x => x.lesson.toLocaleLowerCase("ru-RU")));
          for (const suggestion of suggestConversationLessons(candidates.slice(-100))) {
            if (existing.has(suggestion.lesson.toLocaleLowerCase("ru-RU"))) continue;
            s.queue.push({ ...suggestion, id: "ramo-" + signature(suggestion.lesson), createdAt: now, status: "pending" });
            existing.add(suggestion.lesson.toLocaleLowerCase("ru-RU"));
          }
        }
        s.queue = s.queue.slice(-200);
        s.processed = Object.fromEntries(Object.entries(s.processed).slice(-10000));
        s.lastRun = now; s.runs++; s.lastError = null;
      });
    } catch (error) {
      await this.mutate(() => { this.state.lastError = String(error).slice(0, 300); });
      throw error;
    } finally { this.running = false; }
  }
  async flush() { await this.ready; await this.pending; }
}
