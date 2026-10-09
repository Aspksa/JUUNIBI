import { randomUUID } from "node:crypto";
import { DecisionMemory } from "./decision-memory";
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
  private readonly decisions = new DecisionMemory();
  decisionHistory() { return { records: this.decisions.snapshot(), summary: this.decisions.summary() }; }
  rankDecisions(options: RankingOption[], enabled = true) { return { ranked: rankWithExperience(options, this.decisions.snapshot(), enabled), requiresApproval: true as const }; }
  recordDecision(input: {goal:string;chosen:string;reason:string;predictedSuccess:boolean}) { const result=this.decisions.record(input);this.persist();return result; }
  confirmDecision(id:string,outcome:"success"|"failure") { const result=this.decisions.confirm(id,outcome);this.persist();return result; }
  private plans: BrainPlan[] = [];
  private logs: { at: string; planId: string; stepId: string; outcome: string }[] = [];
  history() { return this.logs.map(e => ({ ...e })); }
  previewDecisionTree(branches: DecisionBranch[], limits: PlanLimits, event?: DecisionEvent) { return evaluateDecisionTree(branches, limits, event); }
  previewSequence(steps: SequenceStep[], limits: PlanLimits) { return simulateSequence(steps, limits); }
  suggestRepairs(steps: SequenceStep[], limits: PlanLimits) { return suggestSequenceRepairs(steps, limits); }
  /** Simulate alternatives only. The selected plan is never executed or saved. */
  compareAlternatives(options: PlanOption[], limits: PlanLimits) { return evaluateOptions(options, limits); }
  private writeQueue: Promise<void> = Promise.resolve();
  flush() { return this.writeQueue; }
  private persist() {
    if (!this.storage) return;
    const data = JSON.stringify({ mode: this.mode, plans: this.plans, logs: this.logs, decisions: this.decisions.snapshot() });
    this.writeQueue = this.writeQueue.catch(() => {}).then(() => this.storage!.save(data));
  }
  constructor(private readonly assistantReady: () => boolean, private readonly storage?: BrainStorage) {}
  async load() {
    const raw = await this.storage?.load();
    if (!raw) return;
    const state: unknown = JSON.parse(raw);
    if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("Повреждено состояние мозга");
    const saved = state as { mode?: unknown; plans?: unknown; logs?: unknown };
    if (!Array.isArray(saved.plans) || !Array.isArray(saved.logs) || saved.plans.length > 30 || saved.logs.length > 200) throw new Error("Неверный формат мозга");
    this.mode = saved.mode === "agent" || saved.mode === "analysis" || saved.mode === "creative" ? saved.mode : "chat";
    if (!saved.plans.every(p => p && typeof p.id === "string" && typeof p.goal === "string" && p.goal.length <= 1000 && Array.isArray(p.steps) && p.steps.length > 0 && p.steps.length <= 20 && p.steps.every((s: BrainStep) => s && typeof s.id === "string" && typeof s.title === "string" && s.title.length <= 300 && ["pending", "active", "done", "failed"].includes(s.status) && (s.retries === undefined || (Number.isInteger(s.retries) && s.retries >= 0 && s.retries <= 2)) && (s.lastError === undefined || (typeof s.lastError === "string" && s.lastError.length <= 300))))) throw new Error("Некорректные планы");
    this.plans = (saved.plans as BrainPlan[]).map(p => ({ ...p, status: p.status === "running" ? "planned" : p.status, steps: p.steps.map(s => ({ ...s, status: s.status === "active" ? "pending" : s.status })) }));
    this.logs = saved.logs as typeof this.logs;
    this.decisions.load((state as { decisions?: unknown }).decisions);
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
      const result = action === "list_modules" ? readModules() : await searchMemory(step.title);
      const serialized = JSON.stringify(result);
      if (serialized === undefined || serialized === "null") throw new Error("Инструмент не вернул проверяемый результат");
      const summary = serialized.slice(0, 2000);
      this.updateStep(planId, stepId, "done");
      this.logs.unshift({ at: new Date().toISOString(), planId, stepId, outcome: "verified: " + action + ": " + summary });
      this.logs = this.logs.slice(0, 200);
      this.persist();
      return { plan: this.status().plans.find(p => p.id === planId), result };
    } catch (error) {
      step.lastError = error instanceof Error ? error.message.slice(0, 300) : "Неизвестная ошибка";
      this.updateStep(planId, stepId, "failed");
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
    return this.executeReadStep(planId, stepId, action, readModules, searchMemory);
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
  updateStep(planId: string, stepId: string, status: unknown) {
    if (status !== "active" && status !== "done" && status !== "failed") throw Object.assign(new Error("Недопустимый статус"), { status: 400 });
    const plan = this.plans.find(p => p.id === planId);
    const step = plan?.steps.find(s => s.id === stepId);
    if (!plan || !step) throw Object.assign(new Error("Шаг не найден"), { status: 404 });
    if (plan.status === "completed" || plan.status === "failed") throw Object.assign(new Error("План уже завершён"), { status: 409 });
    if (status === "active" && plan.steps.some(s => s.status === "active" && s !== step)) throw Object.assign(new Error("Уже есть активный шаг"), { status: 409 });
    if (status === "active" && plan.steps.slice(0, plan.steps.indexOf(step)).some(s => s.status !== "done")) throw Object.assign(new Error("Нельзя пропускать шаги"), { status: 409 });
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
