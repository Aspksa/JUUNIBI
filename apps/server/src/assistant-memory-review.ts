/** Conservative assistant memory: explicit provenance, reversible updates and no invented facts. */
export interface MemoryFact {
  id: string; topic: string; claim: string; sourceTurnId: string; createdAt: string;
  confidence: number; status: "candidate" | "verified" | "disputed" | "rejected";
  lastUsedAt?: string;
}
export interface MemorySuggestion { claim: string; topic: string; sourceTurnId: string; confidence: number }
const norm = (s: string) => s.normalize("NFKC").toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/\s+/g, " ").trim();
export class AssistantMemoryReview {
  private items: MemoryFact[];
  constructor(saved: readonly MemoryFact[] = []) { this.items = saved.map(x => ({ ...x })); }
  list(): MemoryFact[] { return this.items.map(x => ({ ...x })); }
  propose(input: MemorySuggestion, now = new Date()): MemoryFact | null {
    const topic = input.topic.trim().slice(0, 120), claim = input.claim.trim().slice(0, 800);
    if (!topic || !claim || !input.sourceTurnId || !Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) return null;
    const match = this.items.find(x => norm(x.topic) === norm(topic) && norm(x.claim) === norm(claim) && x.status !== "rejected");
    if (match) return { ...match };
    const opposite = this.items.some(x => norm(x.topic) === norm(topic) && x.status === "verified" && norm(x.claim).replace(/^(не |not )/, "") === norm(claim).replace(/^(не |not )/, "") && /^(не |not )/.test(norm(x.claim)) !== /^(не |not )/.test(norm(claim)));
    const item: MemoryFact = { id: crypto.randomUUID(), topic, claim, sourceTurnId: input.sourceTurnId, createdAt: now.toISOString(), confidence: input.confidence, status: opposite ? "disputed" : "candidate" };
    this.items.push(item);
    return { ...item };
  }
  decide(id: string, status: MemoryFact["status"]): boolean {
    const item = this.items.find(x => x.id === id);
    if (!item) return false;
    item.status = status;
    return true;
  }
  recall(query: string, limit = 5): MemoryFact[] {
    const terms = norm(query).split(/\s+/).filter(x => x.length >= 3);
    if (!terms.length) return [];
    return this.items.filter(x => x.status === "verified").map(x => ({ item: x, score: terms.reduce((n,t) => n + (norm(x.topic + " " + x.claim).includes(t) ? 1 : 0), 0) }))
      .filter(x => x.score > 0).sort((a,b) => b.score - a.score).slice(0, Math.max(0, Math.min(20, limit))).map(x => ({ ...x.item }));
  }
  explain(id: string): { sourceTurnId: string; confidence: number; status: MemoryFact["status"] } | null {
    const x = this.items.find(x => x.id === id);
    return x ? { sourceTurnId: x.sourceTurnId, confidence: x.confidence, status: x.status } : null;
  }
}
