import { runUnifiedBrainCycle, type UnifiedCycleInput } from "./brain-v4-cycle";
import { evaluateBrainV5 } from "./brain-v5-evaluation";
import { evaluateBrainV6 } from "./brain-v6-engine";
import { evaluateBrainV7 } from "./brain-v7-engine";

/** Automatic read-only review used by both streaming and regular chat routes. */
export function automaticBrainReview(input: UnifiedCycleInput) {
  const cycle = runUnifiedBrainCycle(input);
  const diagnostics = evaluateBrainV5(input);
  const reviewV6 = evaluateBrainV6(input);
  const reviewV7 = evaluateBrainV7(input);
  const arithmeticMismatch = reviewV7.repair.verifiable && !reviewV7.repair.correct;
  const insufficientProof = reviewV7.groups.some(group => group.stages.some(stage =>
    (stage.id === "quality.answer_accuracy" || stage.id === "quality.before_after") && stage.state === "unknown"));
  const toolCautions = (input.recentToolWarnings ?? []).some(w => w.caution || w.denied > 0);
  return {
    cycle: { ...cycle, diagnostics, reviewV6, reviewV7 },
    guidance: {
      needsPlanning: cycle.advice.planBeforeAnswer || arithmeticMismatch,
      needsEvidenceReview: cycle.advice.checkExternalEvidence || arithmeticMismatch || toolCautions,
      needsApproval: cycle.advice.requestApprovalForRisk,
      evidenceWarnings: [
        ...(arithmeticMismatch ? ["Обнаружена арифметическая ошибка; проверенный результат: " + reviewV7.repair.expected + ". Не утверждай, что ошибочное равенство верно."] : []),
        ...(toolCautions ? ["Есть подтверждённые предупреждения или отказы инструментов. Проверяй предусловия, не обходи ограничения."] : []),
        ...(insufficientProof ? ["Достоверность произвольного ответа и улучшение после обучения не измерены независимым эталоном. Не заявляй об их доказанности."] : []),
      ],
    },
  };
}
