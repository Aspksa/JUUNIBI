import { reviewReasoning, type ReasoningClaim, type ReasoningEvidence } from "./reasoning-review";
import { assessKnowledgeImpact, type KnowledgeNode } from "./knowledge-impact";
import { planKnowledgeRecheck, type RecheckPriority } from "./knowledge-recheck";
import { simulateSequence, type SequenceStep } from "./sequence-simulator";
import type { PlanLimits } from "./plan-evaluator";

export interface UnifiedThoughtInput {
 claims: ReasoningClaim[]; evidence: ReasoningEvidence[];
 knowledge: KnowledgeNode[]; changedId: string; priorities: RecheckPriority[];
 steps: SequenceStep[]; limits: PlanLimits;
}
/** One read-only reasoning pass over existing brain capabilities. No actions or knowledge edits. */
export function previewUnifiedThought(input: UnifiedThoughtInput) {
 if(!input || typeof input!=="object" || Array.isArray(input))
  throw Object.assign(new Error("Некорректный запрос рассуждения"),{status:400});
 const logic=reviewReasoning(input.claims,input.evidence);
 const impact=assessKnowledgeImpact(input.knowledge,input.changedId);
 const recheck=planKnowledgeRecheck(input.knowledge,input.changedId,input.priorities);
 const plan=simulateSequence(input.steps,input.limits);
 const blockers=[
  ...(logic.reviewCount ? ["Есть утверждения, требующие логической проверки"] : []),
  ...(impact.contradictions.length ? ["Обнаружены связанные противоречия"] : []),
  ...(!plan.feasible ? ["План не удовлетворяет ограничениям"] : []),
 ];
 return {
  stages:["logic-review","knowledge-impact","recheck-priorities","plan-simulation","final-gate"],
  logic,impact,recheck,plan,blockers,
  readyForHumanReview:blockers.length===0,
  requiresApproval:true as const,
  note:"Единый расчёт использует уже существующие проверки. Он не доказывает истинность сведений и не исполняет действия.",
 };
}
