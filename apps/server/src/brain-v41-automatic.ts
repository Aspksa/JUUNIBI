import { runUnifiedBrainCycle, type UnifiedCycleInput } from "./brain-v4-cycle";
import { evaluateBrainV5 } from "./brain-v5-evaluation";
import { evaluateBrainV6 } from "./brain-v6-engine";

/** Automatic read-only review used by both streaming and regular chat routes. */
export function automaticBrainReview(input: UnifiedCycleInput) {
  const cycle = runUnifiedBrainCycle(input);
  const diagnostics = evaluateBrainV5(input);
  const reviewV6 = evaluateBrainV6(input);
  return {
    cycle: { ...cycle, diagnostics, reviewV6 },
    guidance: {
      needsPlanning: cycle.advice.planBeforeAnswer,
      needsEvidenceReview: cycle.advice.checkExternalEvidence,
      needsApproval: cycle.advice.requestApprovalForRisk,
    },
  };
}
