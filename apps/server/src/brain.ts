import { randomUUID } from "node:crypto";

export type BrainMode = "chat" | "analysis" | "agent" | "creative";
export type StepState = "pending" | "active" | "done" | "failed";
export interface BrainStep { id: string; title: string; status: StepState }
export interface BrainPlan { id: string; goal: string; createdAt: string; status: "planned" | "running" | "completed" | "failed"; steps: BrainStep[] }

/** Deliberately non-executing planner: operations still require the assistant's approval gate. */
export interface BrainStorage { load(): Promise<string | null>; save(data: string): Promise<void> }
export class BrainCore {
  private mode: BrainMode = "chat";
  private plans: BrainPlan[] = [];
  private logs: { at: string; planId: string; stepId: string; outcome: string }[] = [];
  history() { return this.logs.map(e => ({ ...e })); }
  private writeQueue: Promise<void> = Promise.resolve();
  flush() { return this.writeQueue; }
  private persist() {
    if (!this.storage) return;
    const data = JSON.stringify({ mode: this.mode, plans: this.plans, logs: this.logs });
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
    if (!saved.plans.every(p => p && typeof p.id === "string" && typeof p.goal === "string" && p.goal.length <= 1000 && Array.isArray(p.steps) && p.steps.length > 0 && p.steps.length <= 20 && p.steps.every((s: BrainStep) => s && typeof s.id === "string" && typeof s.title === "string" && s.title.length <= 300 && ["pending", "active", "done", "failed"].includes(s.status)))) throw new Error("Некорректные планы");
    this.plans = (saved.plans as BrainPlan[]).map(p => ({ ...p, status: p.status === "running" ? "planned" : p.status, steps: p.steps.map(s => ({ ...s, status: s.status === "active" ? "pending" : s.status })) }));
    this.logs = saved.logs as typeof this.logs;
  }
  status() {
    return { mode: this.mode, assistantReady: this.assistantReady(), plans: this.plans.map(p => ({ ...p, steps: p.steps.map(s => ({ ...s })) })), capabilities: ["memory", "planning", "tools", "approvals", "scenes"] };
  }
  setMode(value: unknown) {
    if (value !== "chat" && value !== "analysis" && value !== "agent" && value !== "creative") throw Object.assign(new Error("Неизвестный режим мозга"), { status: 400 });
    this.mode = value;
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
    this.updateStep(planId, stepId, "active");
    try {
      const result = action === "list_modules" ? readModules() : await searchMemory(step.title);
      const summary = JSON.stringify(result).slice(0, 2000);
      this.updateStep(planId, stepId, "done");
      this.logs.unshift({ at: new Date().toISOString(), planId, stepId, outcome: "verified: " + action + ": " + summary });
      this.logs = this.logs.slice(0, 200);
      return { plan: this.status().plans.find(p => p.id === planId), result };
    } catch (error) {
      this.updateStep(planId, stepId, "failed");
      throw error;
    }
  }
  updateStep(planId: string, stepId: string, status: unknown) {
    if (status !== "active" && status !== "done" && status !== "failed") throw Object.assign(new Error("Недопустимый статус"), { status: 400 });
    const plan = this.plans.find(p => p.id === planId);
    const step = plan?.steps.find(s => s.id === stepId);
    if (!plan || !step) throw Object.assign(new Error("Шаг не найден"), { status: 404 });
    if (plan.status === "completed" || plan.status === "failed") throw Object.assign(new Error("План уже завершён"), { status: 409 });
    if (status === "active" && plan.steps.some(s => s.status === "active" && s !== step)) throw Object.assign(new Error("Уже есть активный шаг"), { status: 409 });
    if (status === "done" && step.status !== "active") throw Object.assign(new Error("Сначала активируйте шаг"), { status: 409 });
    if (status === "active" && step.status !== "pending") throw Object.assign(new Error("Шаг нельзя активировать"), { status: 409 });
    step.status = status;
    this.logs.unshift({ at: new Date().toISOString(), planId, stepId, outcome: status });
    this.logs = this.logs.slice(0, 200);
    plan.status = plan.steps.some(s => s.status === "failed") ? "failed" : plan.steps.every(s => s.status === "done") ? "completed" : "running";
    return plan;
  }
}
