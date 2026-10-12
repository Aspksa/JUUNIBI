import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeMemoryV4 } from "./memory-v4-engine";
import { diagnoseKnowledgeGraph } from "./knowledge-graph-diagnostics";
import { exploreKnowledge, exploreKnowledgeNeighbors } from "./knowledge-graph-explorer";
import { searchKnowledgeSemantic } from "./knowledge-semantic-search";
import type { EmbeddingProvider } from "@juunibi/assistant";

export interface VerifiedKnowledge {
  id: string; topic: string; claim: string; source: string;
  verifiedAt: string; nextReviewAt: string; reviewCount: number;
  status: "verified" | "needs-review";
  history?: { at: string; action: "created" | "reviewed" | "flagged"; status: "verified" | "needs-review"; source: string }[];
}
type KnowledgeHistory = NonNullable<VerifiedKnowledge["history"]>[number];
const validHistory = (value: unknown): value is KnowledgeHistory => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const h = value as Record<string, unknown>;
  return typeof h.at === "string" && h.at.length <= 40 &&
    typeof h.source === "string" && h.source.length <= 300 &&
    (h.action === "created" || h.action === "reviewed" || h.action === "flagged") &&
    (h.status === "verified" || h.status === "needs-review");
};
const validKnowledge = (value: unknown): value is VerifiedKnowledge => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const x = value as Record<string, unknown>;
  return typeof x.id === "string" && typeof x.claim === "string" && x.claim.length <= 1000 &&
    typeof x.topic === "string" && typeof x.source === "string" &&
    typeof x.verifiedAt === "string" && typeof x.nextReviewAt === "string" &&
    Number.isInteger(x.reviewCount) && Number(x.reviewCount) >= 0 &&
    (x.status === "verified" || x.status === "needs-review") &&
    (x.history === undefined ||
      (Array.isArray(x.history) && x.history.length <= 50 && x.history.every(validHistory)));
};
/** Isolated knowledge ledger: only exact deterministic evidence or human approval can promote facts. */
export class KnowledgeLedger {
  private items: VerifiedKnowledge[] = [];
  private writes: Promise<void> = Promise.resolve();
  private embeddingProvider: EmbeddingProvider | undefined;
  constructor(private readonly filename: string) {}
  async load() {
    try {
      const state: unknown = JSON.parse(await readFile(this.filename, "utf8"));
      if (!Array.isArray(state) || state.length > 500 ||
        !state.every((x: unknown) => validKnowledge(x))) throw new Error("Повреждён журнал знаний");
      this.items = state;
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
  list() { return this.items.map(x => ({ ...x, ...(x.history ? {history:x.history.map(h=>({...h}))} : {}) })); }
  analyze(query = "") { return analyzeMemoryV4(this.list(), query); }
  /** Conservative live diagnostics; does not promote or rewrite memories. */
  diagnostics(at = new Date()) { return diagnoseKnowledgeGraph(this.list(), at); }
  /** Source-aware lexical retrieval across verified knowledge only. */
  searchGraph(query: string, limit = 10) { return exploreKnowledge(this.list(), query, new Date(), limit); }
  /** Explainable, unverified edge suggestions around a verified knowledge record. */
  neighbors(id: string, limit = 12) { return exploreKnowledgeNeighbors(this.list(), id, limit); }
  /** Optional meaning-aware ranking, with verified-only lexical fallback. */
  setEmbeddingProvider(provider?: EmbeddingProvider) { this.embeddingProvider = provider; }
  semanticSearch(query: string, provider?: EmbeddingProvider, limit = 10) { return searchKnowledgeSemantic(this.list(), query, provider ?? this.embeddingProvider, limit); }
  /** Unverified topical suggestions, never factual or causal claims. */
  suggestedLinks() {
    const entries=this.items.filter(x=>x.status==="verified");
    const links: {from:string;to:string;relation:"same-topic"|"same-operation";reason:string;verified:false}[]=[];
    const operation=(s:string)=>/^\s*\d+\s*([×+÷−-])\s*\d+\s*=\s*\d+\s*$/.exec(s)?.[1];
    for(let i=0;i<entries.length;i++) for(let j=i+1;j<entries.length;j++){
      const a=entries[i]!,b=entries[j]!;
      if(a.topic.toLowerCase()!==b.topic.toLowerCase())continue;
      const same=!!operation(a.claim)&&operation(a.claim)===operation(b.claim);
      links.push({from:a.id,to:b.id,relation:same?"same-operation":"same-topic",reason:same?"Одинаковая арифметическая операция; метод не проверен":"Общая тема, смысловая связь не доказана",verified:false});
      if(links.length===300)return links;
    }
    return links;
  }
  /** Read-only learning priorities: records needing review, unconnected topics, and sparse coverage. */
  gaps() {
    const connected=new Set(this.graph().edges.flatMap(e=>[e.from,e.to]));
    for(const e of this.suggestedLinks()){connected.add(e.from);connected.add(e.to);}
    const grouped=new Map<string,{id:string;topic:string;reason:string;priority:number;count:number}>();
    for(const item of this.items){
      const review=item.status==="needs-review";
      if(!review&&connected.has(item.id))continue;
      const reason=review?"Требует повторной проверки":"Нет связей с другими знаниями";
      const key=item.topic.toLowerCase()+"|"+reason,old=grouped.get(key);
      if(old)old.count++;
      else grouped.set(key,{id:item.id,topic:item.topic,reason,priority:review?2:1,count:1});
    }
    return [...grouped.values()].sort((a,b)=>b.priority-a.priority).slice(0,30);
  }
  /** Explainable, derived edges; similarity never implies factual correctness. */
  graph() {
    const words = (s: string) => new Set((s.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []).filter(w =>
      !["который", "этого", "после", "проверка", "знание"].includes(w)));
    const entries = this.items.filter(x => x.status === "verified").map(x => ({ id: x.id, topic: x.topic, words: words(x.topic + " " + x.claim) }));
    const edges: { from: string; to: string; shared: string[] }[] = [];
    for (let i = 0; i < entries.length; i++)
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i]!, b = entries[j]!;
        const shared = [...a.words].filter(w => b.words.has(w)).slice(0, 8);
        if (shared.length >= 2) edges.push({ from: a.id, to: b.id, shared });
        if (edges.length >= 300) return { nodes: entries.map(({id, topic}) => ({id, topic})), edges };
      }
    return { nodes: entries.map(({id, topic}) => ({id, topic})), edges };
  }
  due(at = new Date()) { return this.list().filter(x => x.nextReviewAt <= at.toISOString()); }
  addVerified(input: { topic: string; claim: string; source: string; evidence: "deterministic-test" | "owner-confirmed" }) {
    if (!["deterministic-test", "owner-confirmed"].includes(input.evidence) ||
      !input.topic?.trim() || input.topic.length > 100 || !input.claim?.trim() || input.claim.length > 1000 ||
      !input.source?.trim() || input.source.length > 300)
      throw Object.assign(new Error("Нужны проверенные данные с источником"), { status: 400 });
    const existing = this.items.find(x => x.claim === input.claim.trim() && x.topic === input.topic.trim());
    if (existing) return existing;
    const at = new Date();
    const item: VerifiedKnowledge = {
      id: randomUUID(), topic: input.topic.trim(), claim: input.claim.trim(),
      source: input.source.trim(), verifiedAt: at.toISOString(),
      nextReviewAt: new Date(at.getTime() + 86400000).toISOString(), reviewCount: 0, status: "verified",
      history: [{ at: at.toISOString(), action: "created", status: "verified", source: input.source.trim() }],
    };
    this.items.push(item);
    this.items = this.items.slice(-500);
    this.save().catch(() => {});
    return item;
  }
  review(id: string, correct: boolean) {
    const item = this.items.find(x => x.id === id);
    if (!item) throw Object.assign(new Error("Знание не найдено"), { status: 404 });
    item.reviewCount++;
    item.status = correct ? "verified" : "needs-review";
    item.history = [...(item.history ?? []), { at: new Date().toISOString(), action: correct ? "reviewed" as const : "flagged" as const, status: item.status, source: "knowledge-review" }].slice(-50);
    const hours = correct ? Math.min(24 * 30, 24 * 2 ** Math.min(item.reviewCount, 5)) : 24;
    item.nextReviewAt = new Date(Date.now() + hours * 3600000).toISOString();
    this.save().catch(() => {});
    return { ...item };
  }
  flush() { return this.writes; }
  private save() {
    const data = JSON.stringify(this.items);
    this.writes = this.writes.catch(() => {}).then(async () => {
      await mkdir(path.dirname(this.filename), { recursive: true });
      const tmp = this.filename + ".tmp";
      await writeFile(tmp, data, { mode: 0o600 });
      await rename(tmp, this.filename);
    });
    return this.writes;
  }
}
