import { runUnifiedBrainCycle, type UnifiedCycleInput } from "./brain-v4-cycle";

/** Automatic read-only review used by both streaming and regular chat routes. */
export function automaticBrainReview(input: UnifiedCycleInput) {
  const cycle = runUnifiedBrainCycle(input);
  return {
    cycle,
    guidance: {
      needsPlanning: cycle.advice.planBeforeAnswer,
      needsEvidenceReview: cycle.advice.checkExternalEvidence,
      needsApproval: cycle.advice.requestApprovalForRisk,
    },
  };
}
