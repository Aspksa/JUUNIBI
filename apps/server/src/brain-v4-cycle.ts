import { classifyChatTask } from "./chat-task-triage";
import type { VerifiedKnowledge } from "./knowledge-ledger";

export const BRAIN_V4_STAGES = [
  "understand-goal", "retrieve-memory", "reasoning-review", "confidence-check",
  "contradiction-check", "causal-review", "decompose-task", "compare-strategies",
  "forecast-outcomes", "review-answer", "failure-adaptation", "learning-priorities",
  "knowledge-retention", "skill-transfer", "effectiveness-review",
  "conversation-context", "multi-goal-planning", "approval-gate",
  "learning-evaluation", "unified-report",
] as const;

export interface UnifiedCycleInput {
  message: string;
  verifiedKnowledge?: readonly Pick<VerifiedKnowledge, "topic" | "claim" | "status">[];
  recentToolWarnings?: readonly { tool: string; caution: boolean; denied: number }[];
  decisionGroups?: readonly { name: string; confirmed: number; successRate: number | null }[];
  learningEnabled?: boolean;
}

/** Twenty bounded advisory checkpoints. Not twenty autonomous actions, model training, or permissions. */
export function runUnifiedBrainCycle(input: UnifiedCycleInput) {
  if (!input || typeof input.message !== "string" || input.message.length > 100000)
    throw Object.assign(new Error("Некорректный запрос мозга"), { status: 400 });
  const triage = classifyChatTask(input.message);
  const knowledge = (input.verifiedKnowledge ?? []).filter(x => x.status === "verified");
  const tokens = new Set((input.message.toLocaleLowerCase("ru").match(/[\p{L}\p{N}]{3,}/gu) ?? []));
  const matched = knowledge.filter(x => {
    const text = (x.topic + " " + x.claim).toLocaleLowerCase("ru");
    return [...tokens].some(token => text.includes(token));
  }).length;
  const warnings = (input.recentToolWarnings ?? []).filter(x => x.caution || x.denied > 0).length;
  const confirmed = (input.decisionGroups ?? []).filter(x => x.confirmed >= 5 && x.successRate !== null);
  const insufficientEvidence = matched === 0;
  const checkpoints = BRAIN_V4_STAGES.map((id, index) => ({
    number: index + 1, id,
    state: ("advisory" as const),
    // Unavailable evidence is an explicit gap, never silently treated as a pass.
    needsEvidence: [3, 4, 5, 6, 9, 10, 13, 14, 19].includes(index + 1) && insufficientEvidence,
  }));
  return {
    version: "4.0",
    checkpoints,
    stageCount: checkpoints.length,
    advice: {
      planBeforeAnswer: triage.needsPlanning,
      checkExternalEvidence: triage.needsEvidenceReview || insufficientEvidence,
      requestApprovalForRisk: triage.needsApproval,
      prioritizeToolPreconditions: warnings > 0,
      historyIsReliable: confirmed.length > 0,
      learningConfigured: input.learningEnabled === true,
    },
    evidence: { matchedVerifiedRecords: matched, toolWarnings: warnings, confirmedDecisionCategories: confirmed.length },
    requiresApprovalForActions: true as const,
    executionPerformed: false as const,
    modelWeightsUpdated: false as const,
    note: "Единый цикл выдаёт рекомендации для чата. Он не подтверждает истинность ответов и не заменяет исполнение 20 независимых механизмов.",
  };
}
