import type { CognitiveMemory } from "./ramo-cognitive";
import { retrieveMemories } from "./ramo-cognitive";
import type { EmbeddingProvider } from "@juunibi/assistant";

export interface MemoryEdge { from: string; to: string; strength: number }
export interface LabCase { name: string; input: string; expected: string }
export interface LabResult { cases: number; passed: number; failures: string[]; score: number }
export interface PlanStep { id: string; title: string; dependsOn: string[]; status: "pending" | "done" }
const tokens = (s: string) => new Set((s.toLocaleLowerCase("ru").match(/[\p{L}\p{N}]{3,}/gu) ?? []).map(w => w.replace(/(ами|ями|ого|ему|ыми|ими|ами|ях|ах|ов|ев|ый|ий|ая|ое|ые|ом|ем|ам|ям|а|я|у|ю|ы|и|е)$/u, "")));
const overlap = (a: string, b: string) => {
  const x = tokens(a), y = tokens(b);
  return [...x].filter(t => y.has(t)).length / Math.sqrt(Math.max(1, x.size * y.size));
};
export function memoryGraph(memories: readonly CognitiveMemory[], limit = 100): MemoryEdge[] {
  const approved = memories.filter(m => m.status === "approved").slice(-Math.max(0, Math.min(limit, 100)));
  const edges: MemoryEdge[] = [];
  for (let i = 0; i < approved.length; i++) for (let j = i + 1; j < approved.length; j++) {
    const strength = overlap(approved[i]!.content, approved[j]!.content);
    if (strength >= 0.35) edges.push({ from: approved[i]!.id, to: approved[j]!.id, strength });
  }
  return edges.sort((a,b) => b.strength - a.strength).slice(0, 150);
}
export function checkMemoryConflicts(memories: readonly CognitiveMemory[]) {
  const approved = memories.filter(m => m.status === "approved");
  const neg = (s: string) => /(?:^|[^\p{L}])(?:не|никогда|never|not)(?=$|[^\p{L}])/iu.test(s);
  const warnings: { first: string; second: string }[] = [];
  for (let i = 0; i < approved.length; i++) for (let j = i + 1; j < approved.length; j++) {
    const a = approved[i]!, b = approved[j]!;
    if (neg(a.content) !== neg(b.content) && overlap(a.content, b.content) > 0.55)
      warnings.push({ first: a.id, second: b.id });
    if (warnings.length >= 30) return warnings;
  }
  return warnings; // Heuristic warnings only, never automatic deletion.
}
export function runLab(cases: readonly LabCase[], candidate: (input: string) => string): LabResult {
  const bounded = cases.slice(0, 50);
  const failures: string[] = [];
  for (const item of bounded) {
    if (!item.name || !item.expected || item.input.length > 1000 || item.expected.length > 1000) {
      failures.push(item.name || "invalid"); continue;
    }
    try {
      if (!candidate(item.input).toLocaleLowerCase("ru").includes(item.expected.toLocaleLowerCase("ru")))
        failures.push(item.name);
    } catch { failures.push(item.name); }
  }
  return { cases: bounded.length, passed: bounded.length - failures.length, failures,
    score: bounded.length ? (bounded.length - failures.length) / bounded.length : 0 };
}
export function validatePlan(steps: readonly PlanStep[]): boolean {
  if (steps.length > 50) return false;
  const nodes = new Map(steps.map(x => [x.id, x]));
  if (nodes.size !== steps.length || steps.some(x => !x || typeof x.id !== "string" || !x.id || typeof x.title !== "string" || !x.title || x.title.length > 300 || !Array.isArray(x.dependsOn) || x.dependsOn.some(d => typeof d !== "string") || !["pending","done"].includes(x.status))) return false;
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    const step = nodes.get(id);
    if (!step) return false;
    visiting.add(id);
    for (const dep of step.dependsOn) if (!visit(dep)) return false;
    visiting.delete(id); visited.add(id); return true;
  };
  return steps.every(x => visit(x.id));
}
export function nextPlanSteps(steps: readonly PlanStep[]) {
  const done = new Set(steps.filter(x => x.status === "done").map(x => x.id));
  return steps.filter(x => x.status === "pending" && x.dependsOn.every(id => done.has(id)));
}
const cosine = (a: number[], b: number[]) => {
  if (a.length !== b.length || !a.length) return 0;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; aa += a[i]! ** 2; bb += b[i]! ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
};
/** Optional real vector similarity. No embedding credentials or vectors persisted here. */
export async function semanticRecall(items: readonly CognitiveMemory[], query: string, now: number,
  provider?: EmbeddingProvider, limit = 6): Promise<CognitiveMemory[]> {
  const approved = items.filter(x => x.status === "approved" && (!x.expiresAt || x.expiresAt > now)).slice(-100);
  const lexical = retrieveMemories(approved, query, now, limit);
  if (!provider || !query.trim()) return lexical;
  try {
    const q = await provider.embed(query.slice(0, 500));
    const ranked: { memory: CognitiveMemory; score: number }[] = [];
    for (const item of approved) {
      const v = await provider.embed(item.content);
      const score = cosine(q, v);
      if (score > 0.15) ranked.push({ memory: item, score });
    }
    const selected = ranked.sort((a,b) => b.score - a.score).slice(0, Math.max(0, Math.min(limit, 10))).map(x => x.memory);
    return selected.length ? selected : lexical;
  } catch { return lexical; }
}
