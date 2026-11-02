import { memoryGraph, checkMemoryConflicts, runLab, validatePlan, nextPlanSteps, type PlanStep, type LabCase, type LabResult } from "./ramo-v6-core";
import { classifyExperience, retrieveMemories, evaluateDialogue, type CognitiveMemory, type CognitiveEvaluation } from "./ramo-cognitive";
import { analyzeDialogue, rankExperiences, type Experience, type DialogueMetrics } from "./ramo-experience";
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
  experiences: Experience[];
  metrics: DialogueMetrics;
  goals: { id: string; title: string; status: "proposed" | "approved" | "done"; createdAt: number }[];
  cognitiveMemories: CognitiveMemory[];
  evaluation: CognitiveEvaluation;
  paused: boolean;
  lastConsolidation: number;
  schemaVersion: number;
  plans: { id: string; goalId: string; steps: PlanStep[]; createdAt: number }[];
  labHistory: { at: number; result: LabResult; label: string }[];
  memoryConflicts: { first: string; second: string }[];
  graphEdges: { from: string; to: string; strength: number }[];
  forgottenIds: string[];
  audit: { at: number; action: string; id?: string }[];
  jobs: { id: string; goalId: string; kind: "memory-review" | "quality-review"; status: "pending" | "done"; createdAt: number }[];
}
const defaults = (): EvolutionState => ({
  config: { enabled: false, intervalMinutes: 30, night: true, memory: true, personality: true, quality: true },
  queue: [], processed: {}, lastRun: 0, lastError: null, runs: 0, analyzedMessages: 0, qualitySignals: 0, memoryDigest: [], experiences: [],
  metrics: { userMessages: 0, assistantMessages: 0, corrections: 0, repeatedReplies: 0, negativeRatings: 0, unresolvedGoals: 0 }, goals: [], cognitiveMemories: [],
  evaluation: { cases: 0, passed: 0, score: 0, failures: [] }, paused: false, lastConsolidation: 0, schemaVersion: 6, plans: [], labHistory: [], memoryConflicts: [], graphEdges: [], forgottenIds: [], audit: [], jobs: [],
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
    this.ready = this.load();
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
      experiences: Array.isArray(s.experiences) ? s.experiences.filter(x => x && typeof x.id === "string" && typeof x.text === "string" && x.text.length <= 350 && ["preference", "correction", "decision", "goal"].includes(x.kind)).slice(-500) : [],
      metrics: s.metrics && typeof s.metrics === "object" ? { ...defaults().metrics, ...s.metrics } : defaults().metrics,
      goals: Array.isArray(s.goals) ? s.goals.filter(x => x && typeof x.id === "string" && typeof x.title === "string" && ["proposed", "approved", "done"].includes(x.status)).slice(-50) : [],
      cognitiveMemories: Array.isArray(s.cognitiveMemories) ? s.cognitiveMemories.filter(x => x && typeof x.id === "string" && typeof x.content === "string" && x.content.length <= 350 && ["candidate", "approved", "rejected"].includes(x.status)).slice(-500) : [],
      evaluation: s.evaluation && typeof s.evaluation === "object" && Number.isFinite(s.evaluation.score) &&
        Number.isFinite(s.evaluation.cases) && Array.isArray(s.evaluation.failures) ? s.evaluation : defaults().evaluation,
      paused: s.paused === true,
      lastConsolidation: Number.isFinite(s.lastConsolidation) ? s.lastConsolidation! : 0,
      schemaVersion: 6,
      plans: Array.isArray(s.plans) ? s.plans.filter(p => p && typeof p.id === "string" && typeof p.goalId === "string" && Array.isArray(p.steps) && validatePlan(p.steps)).slice(-30) : [],
      labHistory: Array.isArray(s.labHistory) ? s.labHistory.filter(x => x && typeof x.at === "number" && typeof x.label === "string" && x.result && typeof x.result.score === "number").slice(-30) : [],
      memoryConflicts: Array.isArray(s.memoryConflicts) ? s.memoryConflicts.filter(x => x && typeof x.first === "string" && typeof x.second === "string").slice(-30) : [],
      graphEdges: Array.isArray(s.graphEdges) ? s.graphEdges.filter(x => x && typeof x.from === "string" && typeof x.to === "string" && typeof x.strength === "number").slice(-150) : [],
      forgottenIds: Array.isArray(s.forgottenIds) ? s.forgottenIds.filter(x => typeof x === "string").slice(-5000) : [],
      audit: Array.isArray(s.audit) ? s.audit.filter(x => x && typeof x.at === "number" && typeof x.action === "string").slice(-100) : [],
      jobs: Array.isArray(s.jobs) ? s.jobs.filter(x => x && typeof x.id === "string" && typeof x.goalId === "string" && ["memory-review", "quality-review"].includes(x.kind) && ["pending", "done"].includes(x.status)).slice(-50) : [],
    };
  }
  private mutate<T>(fn: () => T | Promise<T>): Promise<T> {
    const task = this.pending.then(async () => {
      await this.ready;
      const before = structuredClone(this.state);
      let result: T;
      try {
        result = await fn();
        await this.store.save(JSON.stringify(this.state));
      } catch (error) {
        this.state = before;
        throw error;
      }
      return result;
    });
    this.pending = task.then(() => undefined, () => undefined);
    return task;
  }
  async snapshot(): Promise<EvolutionState & { running: boolean }> {
    await this.ready; await this.pending;
    return { ...structuredClone(this.state), running: this.running };
  }
  cognitiveRecall(query: string): Promise<CognitiveMemory[]> {
    return this.snapshot().then(s => retrieveMemories(s.cognitiveMemories, query, this.now()));
  }
  reviewMemory(id: string, status: "approved" | "rejected"): Promise<void> {
    return this.mutate(() => {
      const memory = this.state.cognitiveMemories.find(x => x.id === id && x.status === "candidate");
      if (!memory) throw new Error("Unknown candidate memory");
      memory.status = status;
      this.record("memory-" + status, id);
      this.refreshGraph();
    });
  }
  private refreshGraph() {
    this.state.graphEdges = memoryGraph(this.state.cognitiveMemories);
    this.state.memoryConflicts = checkMemoryConflicts(this.state.cognitiveMemories);
  }
  private record(action: string, id?: string) {
    this.state.audit.push({ at: this.now(), action, ...(id ? { id } : {}) });
    this.state.audit = this.state.audit.slice(-100);
  }
  forgetMemory(id: string): Promise<void> {
    return this.mutate(() => {
      const before = this.state.cognitiveMemories.length;
      this.state.cognitiveMemories = this.state.cognitiveMemories.filter(x => x.id !== id);
      this.state.experiences = this.state.experiences.filter(x => x.id !== id);
      this.state.goals = this.state.goals.filter(x => x.id !== id);
      if (before === this.state.cognitiveMemories.length) throw new Error("Unknown memory");
      this.state.forgottenIds = [...new Set([...this.state.forgottenIds, id])].slice(-5000);
      this.record("memory-forgotten", id);
      this.refreshGraph();
    });
  }
  createPlan(goalId: string, steps: PlanStep[]): Promise<void> {
    return this.mutate(() => {
      if (!validatePlan(steps) || !steps.length || this.state.plans.some(x => x.goalId === goalId))
        throw new Error("Invalid or duplicate plan");
      if (!this.state.goals.some(x => x.id === goalId && x.status === "approved"))
        throw new Error("Goal must be approved");
      this.state.plans.push({ id: "plan-" + signature(goalId), goalId, steps: structuredClone(steps), createdAt: this.now() });
      this.state.plans = this.state.plans.slice(-30);
      this.record("plan-created", goalId);
    });
  }
  completeStep(planId: string, stepId: string): Promise<void> {
    return this.mutate(() => {
      const plan = this.state.plans.find(x => x.id === planId);
      if (!plan) throw new Error("Unknown plan");
      const step = nextPlanSteps(plan.steps).find(x => x.id === stepId);
      if (!step) throw new Error("Blocked or unknown step");
      step.status = "done";
      this.record("step-done", stepId);
    });
  }
  evaluateLab(label: string, cases: LabCase[]): Promise<LabResult> {
    return this.mutate(() => {
      if (!label || label.length > 100 || !Array.isArray(cases) || cases.length > 50) throw new Error("Invalid lab");
      // Deterministic retrieval smoke experiment. This is not an LLM evaluation.
      const result = runLab(cases, query => retrieveMemories(this.state.cognitiveMemories, query, this.now())
        .map(x => x.content).join(" "));
      this.state.labHistory.push({ at: this.now(), result, label });
      this.state.labHistory = this.state.labHistory.slice(-30);
      this.record("lab-evaluated");
      return result;
    });
  }
  queueReview(goalId: string, kind: "memory-review" | "quality-review"): Promise<void> {
    return this.mutate(() => {
      const goal = this.state.goals.find(x => x.id === goalId && x.status === "approved");
      if (!goal) throw new Error("Goal must be approved");
      const id = goalId + ":" + kind;
      if (this.state.jobs.some(x => x.id === id)) return;
      this.state.jobs.push({ id, goalId, kind, status: "pending", createdAt: this.now() });
      this.state.jobs = this.state.jobs.slice(-50);
      this.record("job-queued", id);
    });
  }
  pause(paused: boolean): Promise<void> {
    return this.mutate(() => { this.state.paused = paused; this.record(paused ? "paused" : "resumed"); });
  }
  recall(query: string): Promise<Experience[]> {
    return this.snapshot().then(state => rankExperiences(state.experiences, query));
  }
  setGoal(id: string, status: "approved" | "done"): Promise<void> {
    return this.mutate(() => {
      const goal = this.state.goals.find(x => x.id === id);
      if (!goal || (status === "done" && goal.status !== "approved")) throw new Error("Invalid goal transition");
      goal.status = status;
      this.record("goal-" + status, id);
    });
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
      this.record("lesson-" + decision, id);
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
        if (!s.config.enabled || s.paused || (!force && now - s.lastRun < s.config.intervalMinutes * 60_000)) return;
        const candidates: { role: string; content: string }[] = [];
        const newExperiences: Experience[] = [];
        const evaluationMessages: { role: string; content: string }[] = [];
        for (const chat of this.readChats().slice(-100)) {
          const analysis = analyzeDialogue(chat.messages, chat.id, now);
          evaluationMessages.push(...chat.messages.slice(-300).filter(m => m && typeof m.content === "string").map(m => ({ role: m.role, content: m.content })));
          if (s.config.memory) newExperiences.push(...analysis.experiences);

          for (const msg of chat.messages.slice(-300)) {
            if (msg.role !== "user" || typeof msg.content !== "string") continue;
            const key = signature(chat.id + ":" + (msg.id ?? "") + ":" + msg.content);
            if (s.processed[key]) continue;
            s.processed[key] = now;
            s.analyzedMessages++;
            candidates.push({ role: "user", content: msg.content });
          }
        }
        if (s.config.memory) {
          const known = new Set(s.experiences.map(x => x.id));
          for (const item of newExperiences) {
            if (known.has(item.id) || s.forgottenIds.includes(item.id)) continue;
            known.add(item.id);
            s.experiences.push(item);
            if (item.kind === "correction") s.metrics.corrections++;
            if (item.kind === "goal" && !s.goals.some(goal => goal.id === item.id))
              s.goals.push({ id: item.id, title: item.text, status: "proposed", createdAt: now });
          }
          s.experiences = s.experiences.slice(-500);
          const knownMemory = new Set(s.cognitiveMemories.map(x => x.id));
          for (const item of newExperiences) {
            if (!knownMemory.has(item.id) && !s.forgottenIds.includes(item.id)) {
              s.cognitiveMemories.push(classifyExperience(item));
              knownMemory.add(item.id);
            }
          }
          s.cognitiveMemories = s.cognitiveMemories.slice(-500);
          this.refreshGraph();
          s.goals = s.goals.slice(-50);
        }
        if (s.config.quality) {
          const aggregate = { ...defaults().metrics };
          for (const chat of this.readChats().slice(-100)) {
            const m = analyzeDialogue(chat.messages, chat.id, now).metrics;
            for (const key of Object.keys(aggregate) as (keyof DialogueMetrics)[]) aggregate[key] += m[key];
          }
          s.metrics = aggregate;
          s.evaluation = evaluateDialogue(evaluationMessages.slice(-300));
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
        if (s.config.night && new Date(now).getHours() < 7 && now - s.lastConsolidation > 20 * 60 * 60_000) {
          s.cognitiveMemories = s.cognitiveMemories.filter(x => !x.expiresAt || x.expiresAt > now).slice(-500);
          s.lastConsolidation = now;
          this.refreshGraph();
        }
        if (!s.paused) {
          for (const job of s.jobs.filter(x => x.status === "pending").slice(0, 3)) {
            // Safe background work only: review existing state; never execute external tools.
            if (job.kind === "quality-review") s.evaluation = evaluateDialogue(evaluationMessages.slice(-300));
            if (job.kind === "memory-review") {
              s.cognitiveMemories = s.cognitiveMemories.slice(-500);
              this.refreshGraph();
            }
            job.status = "done";
            this.record("job-done", job.id);
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
