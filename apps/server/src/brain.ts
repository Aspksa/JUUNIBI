import { inspectExperienceGraph, hybridExperienceSearch, explainStrategyDecision, evaluateBrainEvolutionSuite } from "./brain-evolution";
import { evaluateStrategyCalibration, type StrategyCalibrationPolicy } from "./brain-strategy-calibration";
import { evaluateBrainPlanBenchmarks } from "./brain-plan-benchmarks";
import { BrainGraphSQLite } from "./brain-graph-sqlite";
import { inspectCognitiveEngine } from "./brain-cognitive-engine";
import { recallConfirmedExperience, evaluateExperienceRecall } from "./memory-experience-recall";
import { reviewSixSkills, type CognitiveInput } from "./brain-six-skills";
import { randomUUID } from "node:crypto";
import { comparePlanVariants } from "./plan-34-comparison";
import { proposePlanRepair } from "./plan-repair";
import { auditDraftPlan, type DraftPlan } from "./plan-25-audit";
import { RecoveryTrials } from "./recovery-trials";
import { rankRecoveryStrategies } from "./recovery-strategy-ranking";
import { analyzeToolFailures } from "./tool-failure-patterns";
import { assessToolRecovery } from "./tool-recovery-evaluation";
import { toolReliabilityGuidance } from "./tool-reliability-guidance";
import { analyzeExperience } from "./experience-learning-report";
import { reviewToolOutcome, type ToolOutcomeEvidence } from "./tool-outcome-review";
import { classifyChatTask } from "./chat-task-triage";
import { previewUnifiedThought, type UnifiedThoughtInput } from "./unified-thought";
import { planKnowledgeRecheck, type RecheckPriority } from "./knowledge-recheck";
import { assessKnowledgeImpact, type KnowledgeNode } from "./knowledge-impact";
import { assessRevisionFreshness, type FreshnessRequest } from "./revision-freshness";
import { RevisionHistory } from "./revision-history";
import { reviewReasoningRevision, type ReasoningExample, type ReasoningRevision, type RevisionEvidence } from "./reasoning-revision";
import { reviewReasoning, type ReasoningClaim, type ReasoningEvidence } from "./reasoning-review";
import { reviewLearningCase, type LearningCase } from "./learning-repair-review";
import { DecisionMemory } from "./decision-memory";
import { analyzeTaskPatterns } from "./task-patterns";
import { rankWithExperience, type RankingOption } from "./experience-ranking";
import { evaluateDecisionTree, type DecisionBranch, type DecisionEvent } from "./decision-tree";
import { simulateSequence, type SequenceStep } from "./sequence-simulator";
import { suggestSequenceRepairs } from "./sequence-repair";
import { evaluateOptions, type PlanLimits, type PlanOption } from "./plan-evaluator";

export type BrainMode = "chat" | "analysis" | "agent" | "creative";
export type StepState = "pending" | "active" | "done" | "failed";
export interface BrainStep { id: string; title: string; status: StepState; retries?: number; lastError?: string }
export interface BrainPlan { id: string; goal: string; createdAt: string; status: "planned" | "running" | "completed" | "failed"; steps: BrainStep[] }

/** Deliberately non-executing planner: operations still require the assistant's approval gate. */
export interface BrainStorage { load(): Promise<string | null>; save(data: string): Promise<void> }
export class BrainCore {
  private mode: BrainMode = "chat";
  audit25StagePlan(input:DraftPlan){return auditDraftPlan(input);}
  repairDraftPlan(input:DraftPlan){return proposePlanRepair(input);}
  compare34StagePlans(input:DraftPlan,alternatives:DraftPlan[]){return comparePlanVariants(input,alternatives);}
  private readonly revisions = new RevisionHistory();
  revisionHistory() { return this.revisions.snapshot(); }
  reviewRevisionFreshness(input: FreshnessRequest) { return assessRevisionFreshness(input, this.revisions.snapshot()); }
  proposeRevision(input:{claimId:string;previous:boolean;proposed:boolean;reason:string}) { const r=this.revisions.add(input);this.persist();return {...r,warnings:this.revisions.warnings(input.claimId,input.proposed)}; }
  resolveRevision(id:string,outcome:"accepted"|"rejected") { const r=this.revisions.resolve(id,outcome);this.persist();return r; }
  private readonly decisions = new DecisionMemory();
  decisionHistory() { return { records: this.decisions.snapshot(), summary: this.decisions.summary() }; }
  inspectExperienceRelations(decisionId:string,limit=20) {
    return inspectExperienceGraph(this.decisions.snapshot(),decisionId,limit);
  }
  hybridSearchConfirmedExperience(query:string,limit=8,taskType?:string) {
    return hybridExperienceSearch(this.decisions.snapshot(),query,{limit,...(taskType===undefined?{}:{taskType})});
  }
  explainPlanStrategies(planId:string,strategies:import("./brain-cognitive-engine").StrategyProposal[]) {
    const plan=this.plans.find(p=>p.id===planId);
    if(!plan) throw Object.assign(new Error("План не найден"),{status:404});
    return explainStrategyDecision(plan,this.decisions.snapshot(),strategies);
  }
  brainEvolutionBenchmarks() {return evaluateBrainEvolutionSuite();}
  previewStrategyCalibration(policy:StrategyCalibrationPolicy) {
    return evaluateStrategyCalibration(policy);
  }
  evaluatePlanBenchmarks() { return evaluateBrainPlanBenchmarks(); }
  async searchGraphMemory(query:string,limit=8) { if (!this.graph) throw Object.assign(new Error("SQLite граф памяти недоступен"),{status:503}); await this.graph.sync(this.decisions.snapshot()); return this.graph.search(query,limit); }
  async relatedGraphDecisions(decisionId:string,limit=10) {
    if (!this.graph) throw Object.assign(new Error("SQLite граф памяти недоступен"),{status:503});
    await this.graph.sync(this.decisions.snapshot());
    return this.graph.relatedDecisions(decisionId,limit);
  }
  async graphMemoryStats() { if (!this.graph) throw Object.assign(new Error("SQLite граф памяти недоступен"),{status:503}); await this.graph.sync(this.decisions.snapshot()); return this.graph.stats(); }
  recallExperience(query: string) { return recallConfirmedExperience(this.decisions.snapshot(), query); }
  searchConfirmedExperience(query: unknown, taskType?: unknown, limit: unknown = 5) { return this.decisions.searchConfirmed(query, taskType, limit); }
  /** Grounded planning advisory only: no inferred permissions or automatic tool execution. */
  previewExperiencePlan(planId: string, taskType?: unknown) {
    const plan = this.plans.find(p => p.id === planId);
    if (!plan) throw Object.assign(new Error("План не найден"), { status: 404 });
    const experience = this.decisions.searchConfirmed(plan.goal, taskType, 5);
    const readiness = this.executionReadiness(planId);
    return {
      planId: plan.id,
      goal: plan.goal,
      phase: plan.status,
      experience,
      nextStepId: readiness.canResumeReadOnly ? readiness.nextStepId : null,
      missingEvidence: readiness.missingEvidence,
      requiresOwnerReview: readiness.requiresOwnerReview,
      requiresExplicitExecution: true as const,
      note: "Подтверждённые владельцем решения служат подсказками, не доказательством и не разрешением на действие.",
    };
  }
  /** Compare bounded candidate strategies using only owner-confirmed historical outcomes. */
  compareExperienceStrategies(planId: string, options: unknown, taskType?: unknown) {
    const plan = this.plans.find(p => p.id === planId);
    if (!plan) throw Object.assign(new Error("План не найден"), {status:404});
    if (!Array.isArray(options) || options.length < 2 || options.length > 8 ||
        !options.every((o:unknown) => typeof o === "string" && !!o.trim() && o.length <= 150) ||
        new Set(options.map((o:string)=>o.trim().toLocaleLowerCase("ru"))).size !== options.length)
      throw Object.assign(new Error("Укажите от 2 до 8 различных стратегий"), {status:400});
    const tokenize = (value:string) => new Set(value.toLocaleLowerCase("ru").match(/[\p{L}\p{N}]{2,}/gu) ?? []);
    const confirmed = this.decisions.snapshot().filter(r => r.observed !== undefined &&
      (taskType === undefined || r.taskType === taskType));
    const ranked = (options as string[]).map((option,index) => {
      // Attribute outcomes only to the same chosen strategy: shared words are not proof.
      const evidence = confirmed.filter(item =>
        item.chosen.trim().toLocaleLowerCase("ru") === option.trim().toLocaleLowerCase("ru"));
      const successes = evidence.filter(item=>item.observed==="success").length;
      const failures = evidence.filter(item=>item.observed==="failure").length;
      return {option,originalIndex:index,successes,failures,samples:evidence.length,
        evidenceIds:evidence.map(item=>item.id),
        score:successes-failures,
        insufficientEvidence:evidence.length < 3};
    }).sort((a,b)=>b.score-a.score || b.samples-a.samples || a.originalIndex-b.originalIndex);
    const readiness = this.executionReadiness(planId);
    return {planId,strategies:ranked,experienceSource:"owner-confirmed-decisions" as const,
      nextStepId:readiness.canResumeReadOnly?readiness.nextStepId:null,
      requiresExplicitExecution:true as const,
      note:"Эвристическое сравнение ограниченного опыта; выбор стратегии и действия требуют проверки владельцем."};
  }
  inspectCognitiveEngine(planId: string, input: unknown) {
    const plan=this.plans.find(p=>p.id===planId);
    if(!plan) throw Object.assign(new Error("План не найден"),{status:404});
    const inspection=inspectCognitiveEngine(plan,this.decisions.snapshot(),input);
    const readiness=this.executionReadiness(planId);
    return {...inspection,readiness,adaptivePlan:{...inspection.adaptivePlan,
      nextStepId:readiness.canResumeReadOnly?inspection.adaptivePlan.nextStepId:null,
      canContinueReadOnly:readiness.canResumeReadOnly}};
  }
  toolRegistry() { return { tools: [{name:"list_modules",risk:"read",requiresExplicitExecution:true},{name:"search_memory",risk:"read",requiresExplicitExecution:true}], writeEnabled:false, arbitraryToolsEnabled:false } as const; }
  reviewSixCognitiveSkills(input: CognitiveInput) { return reviewSixSkills(input); }
  /** Ground six cognitive checks in saved plan steps and observed tool outcomes.
   * This is an inspection, not a claim of causal proof or permission to act.
   */
  reviewLivePlan(planId: string) {
    const plan = this.plans.find(p => p.id === planId);
    if (!plan) throw Object.assign(new Error("План не найден"), { status: 404 });
    const recent = this.toolObservations.slice(0, 20);
    const failing = [...new Set(recent.filter(x => x.status === "error").map(x => x.tool))];
    const denials = [...new Set(recent.filter(x => x.status === "denied").map(x => x.tool))];
    const evidence = [
      ...failing.map(tool => "tool-error:" + tool),
      ...denials.map(tool => "permission-denied:" + tool),
      ...plan.steps.filter(step => step.status === "failed").map(step => "failed-step:" + step.id)
    ];
    const hypotheses = [
      ...failing.map(tool => ({ cause: "Проверить сбои инструмента " + tool, evidence: ["tool-error:" + tool] })),
      ...denials.map(tool => ({ cause: "Проверить права инструмента " + tool, evidence: ["permission-denied:" + tool] }))
    ];
    const blocked = plan.steps.some(step => step.status === "failed");
    const review = reviewSixSkills({
      goal: plan.goal.slice(0, 500), observations: evidence.slice(0, 30),
      hypotheses: hypotheses.slice(0, 15),
      options: [], claims: [],
      pastStrategies: [],
      plan: plan.steps.map(step => ({step: step.title, done: step.status === "done", blocked: step.status === "failed"})),
      questions: blocked ? ["Как устранить сбой перед продолжением?"] : ["Какие дополнительные факты необходимы для следующего шага?"]
    });
    return { planId, source: "saved-plan-and-tool-outcomes" as const, observationsCount: evidence.length,
      ...review, requiresExplicitExecution: true as const };
  }
  /** 4.1 unified cognitive preview: orchestrate six reviews over persisted evidence. */
  previewCognitiveCycle(planId: string) {
    const plan = this.plans.find(p => p.id === planId);
    if (!plan) throw Object.assign(new Error("План не найден"), { status: 404 });
    const grounded = this.reviewLivePlan(planId);
    const incomplete = plan.steps.find(s => s.status !== "done");
    const warnings = this.toolConfidenceWarnings(5);
    return {
      planId, phase: plan.status, observation: { progress: plan.steps.filter(s => s.status === "done").length,
        total: plan.steps.length, toolWarnings: warnings },
      reasoning: { causes: grounded.causalAnalysis, evidence: grounded.evidenceReview },
      planning: { nextStep: incomplete ? { id: incomplete.id, title: incomplete.title, status: incomplete.status } : null,
        blocked: grounded.replanning.needsReplan },
      execution: { allowedActions: ["list_modules", "search_memory"] as const, requiresOwnerApproval: true as const },
      verification: { completedSteps: plan.steps.filter(s => s.status === "done").map(s => s.id),
        failedSteps: plan.steps.filter(s => s.status === "failed").map(s => s.id),
        evidence: this.logs.filter(x => x.planId === planId && x.outcome.startsWith("verified:")).slice(0, 20).map(x => ({stepId:x.stepId, at:x.at})) },
      stepTrace: this.stepExecutionTrace(planId),
      experience: { confirmedMemory: this.recallExperience(plan.goal) },
      research: { openQuestions: grounded.researchGaps, requiresSourceCheck: true as const },
      adaptiveRecovery: plan.status === "failed" ? {
        failedStepId: incomplete?.id ?? null, needsOwnerReview: true as const
      } : null,
      requiresExplicitExecution: true as const,
    };
  }
  /** Executes one explicitly approved safe step; checkpoints and validates its result. */
  async runCognitiveCycleStep(planId: string, stepId: string, action: unknown,
    readModules: () => unknown, searchMemory: (query: string) => Promise<unknown>) {
    const before = this.previewCognitiveCycle(planId);
    if (before.planning.blocked || before.planning.nextStep?.id !== stepId ||
      before.planning.nextStep.status !== "pending")
      throw Object.assign(new Error("Требуется пересмотр плана или другой следующий шаг"), { status: 409 });
    const result = await this.executeReadStep(planId, stepId, action, readModules, searchMemory);
    await this.flush();
    const after = this.previewCognitiveCycle(planId);
    if (!after.verification.completedSteps.includes(stepId) ||
      !after.verification.evidence.some(e => e.stepId === stepId))
      throw new Error("Результат шага не подтверждён журналом выполнения");
    return { result: result.result, verified: true as const, before, after };
  }
  /** Unified bounded cognitive execution. All actions are validated before any tool runs.
   * The caller must explicitly invoke this method; no autonomous continuation or write access.
   */
  async runCognitiveCycleBatch(planId: string, actions: unknown, maxSteps: unknown,
    readModules: () => unknown, searchMemory: (query: string) => Promise<unknown>) {
    if (!Number.isSafeInteger(maxSteps) || (maxSteps as number) < 1 || (maxSteps as number) > 5)
      throw Object.assign(new Error("Лимит когнитивного цикла: 1–5 шагов"), { status: 400 });
    const { plan, firstPending } = this.validatedPendingSuffix(planId);
    const count = Math.min(maxSteps as number, plan.steps.length - firstPending);
    const safeActions = this.validateReadActions(actions, count);
    const checkpoints: { stepId: string; action: string; result: unknown }[] = [];
    for (let i = 0; i < count; i++) {
      const step = plan.steps[firstPending + i]!;
      const action = safeActions[i]!;
      const outcome = await this.runCognitiveCycleStep(planId, step.id, action, readModules, searchMemory);
      checkpoints.push({ stepId: step.id, action, result: outcome.result });
    }
    return { checkpoints, skippedVerifiedSteps: firstPending,
      remaining: plan.steps.filter(s => s.status === "pending").length,
      cognitiveState: this.previewCognitiveCycle(planId),
      requiresExplicitExecution: true as const };
  }
  evaluateExperienceRecall(samples: {query:string;expectedId:string}[]) { return evaluateExperienceRecall(this.decisions.snapshot(), samples); }
  taskPatterns() { return analyzeTaskPatterns(this.decisions.snapshot()); }
  reviewRepairs(input: LearningCase) { return reviewLearningCase(input, this.decisions.snapshot()); }
  rankDecisions(options: RankingOption[], enabled = true) { return { ranked: rankWithExperience(options, this.decisions.snapshot(), enabled), requiresApproval: true as const }; }
  recordDecision(input: {goal:string;chosen:string;reason:string;predictedSuccess:boolean;taskType?:string}) { const result=this.decisions.record(input);this.persist();return result; }
  confirmDecision(id:string,outcome:"success"|"failure") { const result=this.decisions.confirm(id,outcome);this.persist();void this.graph?.sync(this.decisions.snapshot()).catch(()=>{});return result; }
  private plans: BrainPlan[] = [];
  private logs: { at: string; planId: string; stepId: string; outcome: string }[] = [];
  private readonly recoveryTrials = new RecoveryTrials();
  recoveryTrialReport(){return this.recoveryTrials.report();}
  recoveryStrategyRanking(tool:string){return rankRecoveryStrategies(this.recoveryTrials.snapshot(),tool);}
  startRecoveryTrial(input:{tool:string;strategy:string;ownerConfirmed:boolean}){
    const r=this.recoveryTrials.create(input?.tool,input?.strategy,input?.ownerConfirmed,this.toolObservations);
    this.persist();return r;
  }
  private toolObservations: {tool:string;status:"ok"|"error"|"denied";risk:"read"|"write"|"danger";elapsedMs:number;at:string}[]=[];
  toolOutcomeHistory(){return this.toolObservations.map(x=>({...x}));}
  /** Per-step verified execution traces, not inferred from unrelated tool failures. */
  stepExecutionTrace(planId: string) {
    const plan = this.plans.find(p => p.id === planId);
    if (!plan) throw Object.assign(new Error("План не найден"), { status: 404 });
    return plan.steps.map(step => {
      const events = this.logs.filter(e => e.planId === planId && e.stepId === step.id);
      return { stepId: step.id, title: step.title, status: step.status,
        verified: events.some(e => e.outcome.startsWith("verified:")),
        events: events.slice(0, 10).map(e => ({at: e.at, kind: e.outcome.startsWith("verified:") ? "verified" : e.outcome.split(":")[0]})),
        error: step.lastError ?? null };
    });
  }

  /** Evidence-based tool reliability: insufficient samples never imply success. */
  toolConfidence(tool: string) {
    const samples = this.toolObservations.filter(x => x.tool === tool).slice(0, 20);
    const success = samples.filter(x => x.status === "ok").length;
    const failed = samples.filter(x => x.status === "error").length;
    const denied = samples.filter(x => x.status === "denied").length;
    const total = samples.length;
    return {
      tool, samples: total, success, failed, denied,
      status: total < 3 ? "insufficient-evidence" as const
        : failed >= 2 || failed / total >= 0.5 ? "needs-review" as const
        : denied >= 2 ? "permission-blocked" as const
        : "observed-stable" as const,
      confidence: total < 3 ? "unknown" as const : total < 10 ? "low" as const : "moderate" as const,
      note: "Оценка основана только на последних наблюдавшихся вызовах. Не является гарантией успешного выполнения."
    };
  }
  /** Only tools with repeated observed failures enter the brain's warning feed. */
  toolConfidenceWarnings(limit = 5) {
    const names = [...new Set(this.toolObservations.map(x => x.tool))].sort();
    return names.map(name => this.toolConfidence(name))
      .filter(x => x.status === "needs-review" || x.status === "permission-blocked")
      .slice(0, Math.max(0, Math.min(20, Number.isSafeInteger(limit) ? limit : 5)));
  }

  toolFailurePatterns(){return analyzeToolFailures(this.toolObservations);}
  toolRecoveryReport(){return assessToolRecovery(this.toolObservations);}
  toolReliabilityGuidance(){return toolReliabilityGuidance(this.toolObservations);}
  experienceLearningReport(){return analyzeExperience(this.toolObservations,this.decisions.snapshot());}
  observeToolOutcome(event:{tool:string;status:"ok"|"error"|"denied";risk:"read"|"write"|"danger";elapsedMs:number}){
    if (!event || !/^[a-zA-Z0-9_-]{1,64}$/.test(event.tool) ||
       !["ok","error","denied"].includes(event.status) || !["read","write","danger"].includes(event.risk) ||
       !Number.isFinite(event.elapsedMs) || event.elapsedMs<0 || event.elapsedMs>3600000) return;
    this.recoveryTrials.observe(event);
    this.toolObservations.unshift({...event,at:new Date().toISOString()});
    this.toolObservations=this.toolObservations.slice(0,100);
    this.persist();
  }
  /** Incomplete work survives restart, but no external action is replayed automatically. */
  pendingWork() {
    return this.plans.filter(p => p.status !== "completed").map(p => {
      const next = p.steps.find(s => s.status !== "done");
      return {
        id: p.id, goal: p.goal, status: p.status,
        completed: p.steps.filter(s => s.status === "done").length,
        total: p.steps.length,
        nextStep: next ? { id: next.id, title: next.title, status: next.status, lastError: next.lastError ?? null } : null,
        requiresExplicitExecution: true as const
      };
    });
  }
  /** Stable, read-only attention feed. Never queues or executes an action. */
  attentionFeed(limit = 5) {
    const count = Number.isSafeInteger(limit) ? Math.max(1, Math.min(limit, 20)) : 5;
    const items = this.pendingWork().map(p => ({
      id: p.id,
      kind: p.status === "failed" ? "needs-review" as const : "resume" as const,
      priority: p.status === "failed" ? 0 : p.completed > 0 ? 1 : 2,
      goal: p.goal,
      detail: p.nextStep?.lastError ?? p.nextStep?.title ?? "Проверьте план",
      progress: { completed: p.completed, total: p.total },
      requiresExplicitExecution: true as const
    }));
    return items.sort((a,b) => a.priority - b.priority || a.id.localeCompare(b.id)).slice(0, count);
  }
  history() { return this.logs.map(e => ({ ...e })); }
  reviewToolOutcome(input: ToolOutcomeEvidence) { return reviewToolOutcome(input); }
  previewThoughtCycle(input: UnifiedThoughtInput) { return previewUnifiedThought(input); }
  classifyTask(message: string) { return classifyChatTask(message); }
  /** Review a persisted task plan using actual saved steps; numeric estimates remain user supplied. */
  previewActivePlan(planId: string, input: Omit<UnifiedThoughtInput, "steps"> & {
    estimates: { stepId: string; cost: number; duration: number; risk: number; benefit: number; requires: string[]; effects: { resource: string; delta: number }[] }[];
  }) {
    const plan = this.plans.find(p => p.id === planId);
    if (!plan) throw Object.assign(new Error("План не найден"), { status: 404 });
    if (plan.status === "completed" || plan.status === "failed")
      throw Object.assign(new Error("Недоступен пересмотр завершённого плана"), { status: 409 });
    if (!input || !Array.isArray(input.estimates) || input.estimates.length !== plan.steps.length ||
        new Set(input.estimates.map(e => e?.stepId)).size !== plan.steps.length ||
        input.estimates.some(e => !e || !plan.steps.some(s => s.id === e.stepId)))
      throw Object.assign(new Error("Оценки должны точно соответствовать шагам сохранённого плана"), { status: 400 });
    const estimates = new Map(input.estimates.map(e => [e.stepId, e]));
    const steps: SequenceStep[] = plan.steps.map((step, index) => {
      const estimate = estimates.get(step.id)!;
      return { id: "step_" + index, title: step.title, cost: estimate.cost,
        duration: estimate.duration, risk: estimate.risk, benefit: estimate.benefit,
        requires: estimate.requires, effects: estimate.effects,
        after: index === 0 ? [] : ["step_" + (index - 1)] };
    });
    const { estimates: _estimates, ...review } = input;
    const result = previewUnifiedThought({ ...review, steps });
    return { planId: plan.id, goal: plan.goal, steps: plan.steps.map((step, index) => ({
      id: step.id, title: step.title, simulatedId: "step_" + index, status: step.status
    })), review: result, requiresApproval: true as const,
      note: "Проверяется существующий план. Числовые оценки и свидетельства предоставлены вызывающей стороной; выполнение не запускается." };
  }
  previewKnowledgeRecheck(nodes: KnowledgeNode[], changedId: string, priorities: RecheckPriority[]) { return planKnowledgeRecheck(nodes, changedId, priorities); }
  previewKnowledgeImpact(nodes: KnowledgeNode[], changedId: string) { return assessKnowledgeImpact(nodes, changedId); }
  previewReasoningRevision(examples: ReasoningExample[], claim: ReasoningRevision, evidence: RevisionEvidence[]) { return reviewReasoningRevision(examples, claim, evidence); }
  reviewOwnReasoning(claims: ReasoningClaim[], evidence: ReasoningEvidence[]) { return reviewReasoning(claims, evidence); }
  previewDecisionTree(branches: DecisionBranch[], limits: PlanLimits, event?: DecisionEvent) { return evaluateDecisionTree(branches, limits, event); }
  previewSequence(steps: SequenceStep[], limits: PlanLimits) { return simulateSequence(steps, limits); }
  suggestRepairs(steps: SequenceStep[], limits: PlanLimits) { return suggestSequenceRepairs(steps, limits); }
  /** Simulate alternatives only. The selected plan is never executed or saved. */
  compareAlternatives(options: PlanOption[], limits: PlanLimits) { return evaluateOptions(options, limits); }
  private writeQueue: Promise<void> = Promise.resolve();
  flush() { return this.writeQueue; }
  private persist() {
    if (!this.storage) return;
    const data = JSON.stringify({ mode: this.mode, plans: this.plans, logs: this.logs, decisions: this.decisions.snapshot(), revisions: this.revisions.snapshot(), toolObservations: this.toolObservations, recoveryTrials: this.recoveryTrials.snapshot() });
    this.writeQueue = this.writeQueue.catch(() => {}).then(() => this.storage!.save(data));
  }
  /** Surface a failed save instead of silently treating in-memory data as durable. */
  async verifyPersistence() { await this.flush(); return { persisted: true as const }; }
  constructor(private readonly assistantReady: () => boolean, private readonly storage?: BrainStorage, private readonly graph?: BrainGraphSQLite) {}
  async load() {
    const raw = await this.storage?.load();
    if (!raw) return;
    const state: unknown = JSON.parse(raw);
    if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("Повреждено состояние мозга");
    const saved = state as { mode?: unknown; plans?: unknown; logs?: unknown };
    if (!Array.isArray(saved.plans) || !Array.isArray(saved.logs) || saved.plans.length > 30 || saved.logs.length > 200) throw new Error("Неверный формат мозга");
    this.mode = saved.mode === "agent" || saved.mode === "analysis" || saved.mode === "creative" ? saved.mode : "chat";
    if (!saved.plans.every(p => p && typeof p.id === "string" && typeof p.goal === "string" && p.goal.length <= 1000 && ["planned", "running", "completed", "failed"].includes(p.status) && typeof p.createdAt === "string" && Number.isFinite(Date.parse(p.createdAt)) && Array.isArray(p.steps) && p.steps.length > 0 && p.steps.length <= 20 && p.steps.every((s: BrainStep) => s && typeof s.id === "string" && s.id.length <= 100 && typeof s.title === "string" && s.title.length <= 300 && ["pending", "active", "done", "failed"].includes(s.status) && (s.retries === undefined || (Number.isInteger(s.retries) && s.retries >= 0 && s.retries <= 2)) && (s.lastError === undefined || (typeof s.lastError === "string" && s.lastError.length <= 300))))) throw new Error("Некорректные планы");
    // Duplicate persisted identifiers could route a confirmation to the wrong step.
    const ids = new Set<string>();
    for (const plan of saved.plans as BrainPlan[]) {
      if (ids.has(plan.id) || new Set(plan.steps.map(step => step.id)).size !== plan.steps.length)
        throw new Error("Повторные идентификаторы плана или шага");
      ids.add(plan.id);
    }
    this.plans = (saved.plans as BrainPlan[]).map(p => {
      const interrupted = p.steps.some(s => s.status === "active");
      const steps = p.steps.map(s => s.status === "active" ? { ...s, status: "failed" as const, lastError: "Выполнение прервано. Проверьте результат перед повтором." } : { ...s });
      // Derive the plan status from durable steps, never trust an inconsistent saved status.
      const failed = steps.some(s => s.status === "failed");
      const completed = steps.every(s => s.status === "done");
      const started = steps.some(s => s.status === "done");
      const status: BrainPlan["status"] = interrupted || failed ? "failed" : completed ? "completed" : started ? "running" : "planned";
      return { ...p, status, steps };
    });
    // Stored log data is external input: malformed entries must not leak into diagnostics.
    this.logs = saved.logs.filter((e): e is (typeof this.logs)[number] =>
      !!e && typeof e === "object" && typeof e.at === "string" &&
      Number.isFinite(Date.parse(e.at)) && typeof e.planId === "string" &&
      typeof e.stepId === "string" && typeof e.outcome === "string" &&
      e.outcome.length <= 2500);
    this.decisions.load((state as { decisions?: unknown }).decisions);
    this.revisions.load((state as { revisions?: unknown }).revisions);
    this.recoveryTrials.load((state as {recoveryTrials?:unknown}).recoveryTrials);
    const observations = (state as {toolObservations?:unknown}).toolObservations;
    if (Array.isArray(observations)) this.toolObservations=observations.filter(e=>e&&typeof e==="object"&&/^[a-zA-Z0-9_-]{1,64}$/.test(e.tool)&&["ok","error","denied"].includes(e.status)&&["read","write","danger"].includes(e.risk)&&Number.isFinite(e.elapsedMs)&&e.elapsedMs>=0&&e.elapsedMs<=3600000&&typeof e.at==="string"&&!Number.isNaN(Date.parse(e.at))).slice(0,100);
  }
  /** Read-only Brain Next diagnostics. Never executes, grants permissions or mutates plans. */
  executionReadiness(planId: string) {
    const plan = this.plans.find(p => p.id === planId);
    if (!plan) throw Object.assign(new Error("План не найден"), { status: 404 });
    const completed = plan.steps.filter(s => s.status === "done").length;
    const failed = plan.steps.filter(s => s.status === "failed");
    const active = plan.steps.filter(s => s.status === "active");
    const next = plan.steps.find(s => s.status === "pending");
    const previousComplete = next ? plan.steps.slice(0, plan.steps.indexOf(next)).every(s => s.status === "done") : false;
    const resumable = failed.length === 0 && active.length === 0 && previousComplete && !!next;
    const verified = new Set(this.logs.filter(e => e.planId === planId && e.outcome.startsWith("verified:")).map(e => e.stepId));
    const missingEvidence = plan.steps.filter(s => s.status === "done" && !verified.has(s.id)).map(s => s.id);
    return {
      planId, phase: plan.status, completed, total: plan.steps.length,
      verifiedCompleted: plan.steps.filter(s => s.status === "done" && verified.has(s.id)).length,
      missingEvidence, failedSteps: failed.map(s => s.id), interruptedSteps: active.map(s => s.id),
      nextStepId: resumable ? next!.id : null,
      canResumeReadOnly: resumable && missingEvidence.length === 0,
      requiresOwnerReview: failed.length > 0 || active.length > 0 || missingEvidence.length > 0,
      supportedActions: ["list_modules", "search_memory"] as const,
      note: "Диагностика не запускает инструменты и не выдаёт разрешений.",
    };
  }
  /** Produces a bounded, read-only recovery proposal; never retries tools automatically. */
  recoveryPreview(planId: string) {
    const plan = this.plans.find(p => p.id === planId);
    if (!plan) throw Object.assign(new Error("План не найден",), {status:404});
    const readiness = this.executionReadiness(planId);
    const firstFailed = plan.steps.findIndex(s => s.status === "failed");
    const failedStep = firstFailed < 0 ? null : plan.steps[firstFailed]!;
    const canRetry = !!failedStep && firstFailed >= 0 &&
      plan.steps.slice(0, firstFailed).every(s => s.status === "done") &&
      plan.steps.slice(firstFailed + 1).every(s => s.status === "pending") &&
      (failedStep.retries ?? 0) < 2;
    return {
      planId, phase: plan.status,
      proposedAction: canRetry ? {stepId:failedStep!.id, title:failedStep!.title,
        attemptsRemaining:2 - (failedStep!.retries ?? 0),
        permittedActions:["list_modules","search_memory"] as const} : null,
      readyForContinuation: readiness.canResumeReadOnly,
      verifiedCompleted: readiness.verifiedCompleted,
      missingEvidence: readiness.missingEvidence,
      requiresExplicitApproval: true as const,
      note:"Предложение восстановления не выполняет инструменты и не подтверждает результат.",
    };
  }
  /** Evidence quality indicators, not an LLM intelligence score. */
  brainEvaluation() {
    const plans = this.plans.map(p => this.executionReadiness(p.id));
    const completed = plans.filter(p => p.phase === "completed").length;
    const failed = plans.filter(p => p.phase === "failed").length;
    const gaps = plans.reduce((total, p) => total + p.missingEvidence.length, 0);
    return { plans: { total: plans.length, completed, failed, resumable: plans.filter(p => p.canResumeReadOnly).length },
      evidence: { missingVerifiedSteps: gaps, verifiedCompletedSteps: plans.reduce((total, p) => total + p.verifiedCompleted, 0) },
      decisions: this.decisions.summary(),
      security: { writeActionsAvailable: false, explicitExecutionRequired: true },
      note: "Это состояние планов и подтверждений, а не независимая оценка качества мышления.",
    };
  }
  status() {
    return { mode: this.mode, assistantReady: this.assistantReady(), plans: this.plans.map(p => ({ ...p, steps: p.steps.map(s => ({ ...s })) })), capabilities: ["memory", "planning", "tools", "approvals", "scenes"] };
  }
  setMode(value: unknown) {
    if (value !== "chat" && value !== "analysis" && value !== "agent" && value !== "creative") throw Object.assign(new Error("Неизвестный режим мозга"), { status: 400 });
    this.mode = value;
    this.persist();
    return this.status();
  }
  plan(goal: unknown, tasks: unknown) {
    if (typeof goal !== "string" || !goal.trim() || goal.length > 1000 || !Array.isArray(tasks) || !tasks.length || tasks.length > 20 ||
      !tasks.every(s => typeof s === "string" && s.trim().length > 0 && s.length <= 300))
      throw Object.assign(new Error("Укажите цель и от 1 до 20 коротких шагов"), { status: 400 });
    const item: BrainPlan = { id: randomUUID(), goal: goal.trim(), createdAt: new Date().toISOString(), status: "planned",
      steps: tasks.map((title: string) => ({ id: randomUUID(), title: title.trim(), status: "pending" })) };
    this.plans.unshift(item);
    this.plans = this.plans.slice(0, 30);
    this.persist();
    return item;
  }
  /** Executes an explicitly selected read-only action; never accepts shell commands or arbitrary tool names. */
  async executeReadStep(planId: string, stepId: string, action: unknown,
    readModules: () => unknown, searchMemory: (query: string) => Promise<unknown>) {
    if (action !== "list_modules" && action !== "search_memory")
      throw Object.assign(new Error("Допускаются только безопасные действия чтения"), { status: 400 });
    const plan = this.plans.find(p => p.id === planId);
    const step = plan?.steps.find(s => s.id === stepId);
    if (!plan || !step) throw Object.assign(new Error("Шаг не найден"), { status: 404 });
    if (step.status !== "pending") throw Object.assign(new Error("Шаг уже запущен"), { status: 409 });
    if (plan.steps.some(s => s !== step && s.status === "active") || plan.steps.slice(0, plan.steps.indexOf(step)).some(s => s.status !== "done"))
      throw Object.assign(new Error("Предыдущие шаги ещё не завершены"), { status: 409 });
    this.updateStep(planId, stepId, "active");
    try {
      await this.flush(); // no tool executes if its active checkpoint cannot be saved
      const result = action === "list_modules" ? readModules() : await searchMemory(step.title);
      const serialized = JSON.stringify(result);
      if (serialized === undefined || serialized === "null" ||
        (action === "list_modules" && !Array.isArray(result)) ||
        (action === "search_memory" && (!Array.isArray(result) || !result.every(x => typeof x === "string"))))
        throw new Error("Инструмент не вернул проверяемый результат");
      if (serialized.length > 65_536) throw new Error("Результат инструмента превышает безопасный лимит 64 КиБ");
      const summary = `items=${(result as unknown[]).length}; bytes=${Buffer.byteLength(serialized, "utf8")}`;
      this.updateStep(planId, stepId, "done");
      this.logs.unshift({ at: new Date().toISOString(), planId, stepId, outcome: "verified: " + action + ": " + summary });
      this.logs = this.logs.slice(0, 200);
      this.persist();
      await this.flush(); // do not acknowledge success before the verified result is durable
      return { plan: this.status().plans.find(p => p.id === planId), result };
    } catch (error) {
      step.lastError = error instanceof Error ? error.message.slice(0, 300) : "Неизвестная ошибка";
      this.updateStep(planId, stepId, "failed");
      // A failed tool must not be reported until its failure checkpoint is durable.
      await this.flush();
      throw error;
    }
  }
  /** Read-only diagnosis: suggests an alternative, but never runs a tool or mutates a plan. */
  diagnoseFailure(planId: string, stepId: string) {
    const plan = this.plans.find(p => p.id === planId);
    const step = plan?.steps.find(s => s.id === stepId);
    if (!plan || !step) throw Object.assign(new Error("Шаг не найден"), { status: 404 });
    if (step.status !== "failed") throw Object.assign(new Error("Диагностика доступна после ошибки"), { status: 409 });
    const reason = step.lastError ?? "Причина не сохранена";
    const exhausted = (step.retries ?? 0) >= 2;
    return {
      planId, stepId, reason, retriesRemaining: Math.max(0, 2 - (step.retries ?? 0)),
      alternatives: exhausted ? [] : [
        { action: "list_modules" as const, purpose: "Проверить доступность модулей без изменений данных" },
        { action: "search_memory" as const, purpose: "Повторно проверить память по заголовку шага" },
      ],
      requiresExplicitExecution: true as const,
    };
  }
  /** Build a validated recovery proposal without changing or executing the original plan. */
  previewRecovery(planId: string, stepId: string, actions: unknown) {
    const plan = this.plans.find(p => p.id === planId);
    const step = plan?.steps.find(s => s.id === stepId);
    if (!plan || !step) throw Object.assign(new Error("Шаг не найден"), { status: 404 });
    if (plan.status !== "failed" || step.status !== "failed")
      throw Object.assign(new Error("Восстановление доступно только после ошибки"), { status: 409 });
    const index = plan.steps.indexOf(step);
    if (plan.steps.slice(0, index).some(s => s.status !== "done") || plan.steps.slice(index + 1).some(s => s.status !== "pending"))
      throw Object.assign(new Error("Нарушена последовательность плана"), { status: 409 });
    const remaining = plan.steps.length - index;
    if (!Array.isArray(actions) || actions.length !== remaining ||
      !actions.every(action => action === "list_modules" || action === "search_memory"))
      throw Object.assign(new Error("Допускается только последовательность безопасного чтения"), { status: 400 });
    if ((step.retries ?? 0) >= 2) throw Object.assign(new Error("Исчерпан лимит повторов"), { status: 409 });
    return {
      planId, failedStepId: stepId, reason: step.lastError ?? "Причина не сохранена",
      completedSteps: plan.steps.slice(0, index).map(s => ({ id: s.id, title: s.title })),
      proposedSteps: plan.steps.slice(index).map((s, i) => ({ id: s.id, title: s.title, action: actions[i] as "list_modules" | "search_memory" })),
      requiresExplicitExecution: true as const,
    };
  }
  /** Retry an explicitly selected failed read-only step, preserving verified earlier work. */
  async retryFailedReadStep(planId: string, stepId: string, action: unknown,
    readModules: () => unknown, searchMemory: (query: string) => Promise<unknown>) {
    if (action !== "list_modules" && action !== "search_memory")
      throw Object.assign(new Error("Повтор разрешён только для безопасного чтения"), { status: 400 });
    const plan = this.plans.find(p => p.id === planId);
    const step = plan?.steps.find(s => s.id === stepId);
    if (!plan || !step) throw Object.assign(new Error("Шаг не найден"), { status: 404 });
    if (plan.status !== "failed" || step.status !== "failed")
      throw Object.assign(new Error("Повторить можно только неудавшийся шаг"), { status: 409 });
    if (plan.steps.some(s => s.status === "active") || plan.steps.slice(0, plan.steps.indexOf(step)).some(s => s.status !== "done"))
      throw Object.assign(new Error("Предыдущие шаги должны быть завершены"), { status: 409 });
    if ((step.retries ?? 0) >= 2) throw Object.assign(new Error("Исчерпан лимит повторов шага"), { status: 409 });
    step.retries = (step.retries ?? 0) + 1;
    step.status = "pending";
    delete step.lastError;
    plan.status = plan.steps.some(s => s.status === "done") ? "running" : "planned";
    this.logs.unshift({ at: new Date().toISOString(), planId, stepId, outcome: "retry: " + action });
    this.logs = this.logs.slice(0, 200);
    this.persist();
    await this.flush(); // retry authorization and count must survive a restart before execution
    return this.executeReadStep(planId, stepId, action, readModules, searchMemory);
  }
  /** Shared fail-closed validation across sequence, resume, and agent batch. */
  private validatedPendingSuffix(planId: string) {
    const plan = this.plans.find(p => p.id === planId);
    if (!plan) throw Object.assign(new Error("План не найден"), { status: 404 });
    if (plan.status === "failed" || plan.status === "completed" ||
      plan.steps.some(s => s.status === "active" || s.status === "failed"))
      throw Object.assign(new Error("План требует проверки перед запуском"), { status: 409 });
    const firstPending = plan.steps.findIndex(s => s.status === "pending");
    if (firstPending < 0 || plan.steps.slice(0, firstPending).some(s => s.status !== "done") ||
      plan.steps.slice(firstPending).some(s => s.status !== "pending"))
      throw Object.assign(new Error("Нарушена последовательность шагов"), { status: 409 });
    return { plan, firstPending };
  }
  private validateReadActions(actions: unknown, count: number) {
    if (!Array.isArray(actions) || actions.length !== count ||
      !actions.every(a => a === "list_modules" || a === "search_memory"))
      throw Object.assign(new Error("Допускаются только безопасные действия чтения для выбранных шагов"), { status: 400 });
    return actions as ("list_modules" | "search_memory")[];
  }
  async executeSequence(planId: string, actions: unknown,
    readModules: () => unknown, searchMemory: (query: string) => Promise<unknown>) {
    const plan = this.plans.find(p => p.id === planId);
    if (!plan) throw Object.assign(new Error("План не найден"), { status: 404 });
    if (!Array.isArray(actions) || actions.length !== plan.steps.length ||
      !actions.every(a => a === "list_modules" || a === "search_memory"))
      throw Object.assign(new Error("Недопустимые действия"), { status: 400 });
    if (plan.status !== "planned" || plan.steps.some(s => s.status !== "pending"))
      throw Object.assign(new Error("План уже запускался"), { status: 409 });
    const results: unknown[] = [];
    for (let i = 0; i < actions.length; i++) {
      const output = await this.executeReadStep(planId, plan.steps[i]!.id, actions[i], readModules, searchMemory);
      results.push(output.result);
      await this.flush();
    }
    return { plan: this.status().plans.find(p => p.id === planId), results };
  }
  /** Continue only the pending suffix of an explicitly selected read-only plan.
   * Completed steps are never replayed. No automatic restart is performed on load.
   */
  async resumeReadSequence(planId: string, actions: unknown,
    readModules: () => unknown, searchMemory: (query: string) => Promise<unknown>) {
    const { plan, firstPending } = this.validatedPendingSuffix(planId);
    const safeActions = this.validateReadActions(actions, plan.steps.length - firstPending);
    const results: unknown[] = [];
    for (let i = firstPending; i < plan.steps.length; i++) {
      const output = await this.executeReadStep(planId, plan.steps[i]!.id,
        safeActions[i - firstPending], readModules, searchMemory);
      results.push(output.result);
      await this.flush();
    }
    return { plan: this.status().plans.find(p => p.id === planId), skippedCompleted: firstPending, results };
  }
  /** Agent 4.2: bounded, explicitly approved read-only execution with checkpoints.
   * An interrupted or failed step is never automatically retried.
   */
  async executeAgentBatch(planId: string, actions: unknown, maxSteps: unknown,
    readModules: () => unknown, searchMemory: (query: string) => Promise<unknown>) {
    if (!Number.isSafeInteger(maxSteps) || (maxSteps as number) < 1 || (maxSteps as number) > 5)
      throw Object.assign(new Error("Лимит выполнения: от 1 до 5 шагов"), { status: 400 });
    const { plan, firstPending } = this.validatedPendingSuffix(planId);
    const allowed = Math.min(maxSteps as number, plan.steps.length - firstPending);
    const safeActions = this.validateReadActions(actions, allowed);
    const completed: { stepId: string; action: string }[] = [];
    for (let offset = 0; offset < allowed; offset++) {
      const step = plan.steps[firstPending + offset]!;
      const action = safeActions[offset]!;
      await this.executeReadStep(planId, step.id, action, readModules, searchMemory);
      await this.flush();
      completed.push({ stepId: step.id, action });
    }
    const state = this.previewCognitiveCycle(planId);
    return { completed, skippedPreviouslyCompleted: firstPending,
      remaining: plan.steps.filter(s => s.status === "pending").length,
      verifiedStepIds: state.verification.evidence.map(e => e.stepId),
      nextAction: state.planning.nextStep, requiresExplicitExecution: true as const };
  }
  updateStep(planId: string, stepId: string, status: unknown) {
    if (status !== "active" && status !== "done" && status !== "failed") throw Object.assign(new Error("Недопустимый статус"), { status: 400 });
    const plan = this.plans.find(p => p.id === planId);
    const step = plan?.steps.find(s => s.id === stepId);
    if (!plan || !step) throw Object.assign(new Error("Шаг не найден"), { status: 404 });
    if (plan.status === "completed" || plan.status === "failed") throw Object.assign(new Error("План уже завершён"), { status: 409 });
    if (status === "active" && plan.steps.some(s => s.status === "active" && s !== step)) throw Object.assign(new Error("Уже есть активный шаг"), { status: 409 });
    if (status === "active" && plan.steps.slice(0, plan.steps.indexOf(step)).some(s => s.status !== "done")) throw Object.assign(new Error("Нельзя пропускать шаги"), { status: 409 });
    if (status === "failed" && step.status !== "active") throw Object.assign(new Error("Ошибка допустима только для выполняемого шага"), { status: 409 });
    if (status === "done" && step.status !== "active") throw Object.assign(new Error("Сначала активируйте шаг"), { status: 409 });
    if (status === "active" && step.status !== "pending") throw Object.assign(new Error("Шаг нельзя активировать"), { status: 409 });
    step.status = status;
    this.logs.unshift({ at: new Date().toISOString(), planId, stepId, outcome: status });
    this.logs = this.logs.slice(0, 200);
    plan.status = plan.steps.some(s => s.status === "failed") ? "failed" : plan.steps.every(s => s.status === "done") ? "completed" : "running";
    this.persist();
    return plan;
  }
}
