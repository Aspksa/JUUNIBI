import type { Tool } from "./tools";

/** Trusted tool registration metadata, never supplied by the chat model. */
export interface DangerousActionPlan {
  purpose: string;
  expectedEffect: string;
  recovery: string;
  checks: string[];
}

/** Fail closed: dangerous tools require a declared plan before approval is requested. */
export function reviewDangerousTool(tool: Tool) {
  if (tool.risk !== "danger") return { valid: true, blockers: [] as string[], requiresApproval: tool.risk !== "read" };
  const plan = tool.actionPlan;
  const bounded = (x: unknown) => typeof x === "string" && x.trim().length >= 8 && x.length <= 500;
  const blockers: string[] = [];
  if (!plan || !bounded(plan.purpose)) blockers.push("Отсутствует цель опасной операции");
  if (!plan || !bounded(plan.expectedEffect)) blockers.push("Не описаны последствия операции");
  if (!plan || !bounded(plan.recovery)) blockers.push("Не указан план восстановления или объяснение необратимости");
  if (!plan || !Array.isArray(plan.checks) || plan.checks.length < 1 || plan.checks.length > 10 ||
      !plan.checks.every(bounded)) blockers.push("Не заданы обязательные проверки");
  return { valid: blockers.length === 0, blockers, requiresApproval: true as const };
}
