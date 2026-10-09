import { runUnifiedBrainCycle, type UnifiedCycleInput } from "./brain-v4-cycle";
import { evaluateBrainV5 } from "./brain-v5-evaluation";

/** Automatic read-only review used by both streaming and regular chat routes. */
export function automaticBrainReview(input: UnifiedCycleInput) {
  const cycle = runUnifiedBrainCycle(input);
  const diagnostics = evaluateBrainV5(input);
  return {
    cycle: { ...cycle, diagnostics },
    guidance: {
      needsPlanning: cycle.advice.planBeforeAnswer,
      needsEvidenceReview: cycle.advice.checkExternalEvidence,
      needsApproval: cycle.advice.requestApprovalForRisk,
    },
  };
}
