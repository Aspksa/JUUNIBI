/** Read-only orchestration for six cognitive reviews. No tools or plans are executed. */
export interface CognitiveEvidence { claim: string; source: string; supports: boolean }
export interface CognitiveOption { name: string; benefits: number; costs: number; risks: number; constraintsMet: boolean }
export interface CognitiveInput {
  goal: string;
  observations: string[];
  hypotheses: { cause: string; evidence: string[] }[];
  options: CognitiveOption[];
  claims: CognitiveEvidence[];
  pastStrategies: { name: string; verified: boolean; outcome: "success" | "failure" }[];
  plan: { step: string; done: boolean; blocked: boolean }[];
  questions: string[];
}
export function reviewSixSkills(input: CognitiveInput) {
  if (!input || typeof input.goal !== "string" || !input.goal.trim() || input.goal.length > 500 ||
    !Array.isArray(input.observations) || !Array.isArray(input.hypotheses) || !Array.isArray(input.options) ||
    !Array.isArray(input.claims) || !Array.isArray(input.pastStrategies) || !Array.isArray(input.plan) ||
    !Array.isArray(input.questions)) throw new Error("Неверные данные когнитивного анализа");
  const strings = (xs: unknown[], max: number) => xs.length <= max && xs.every(x => typeof x === "string" && x.length <= 300);
  if (!strings(input.observations, 30) || !strings(input.questions, 15) ||
    input.hypotheses.length > 15 || input.options.length > 15 || input.claims.length > 30 ||
    input.pastStrategies.length > 30 || input.plan.length > 20 ||
    input.hypotheses.some(h => !h || typeof h.cause !== "string" || h.cause.length > 300 || !Array.isArray(h.evidence) || !strings(h.evidence, 15)) ||
    input.options.some(o => !o || typeof o.name !== "string" || o.name.length > 200 || ![o.benefits,o.costs,o.risks].every(n=>Number.isFinite(n)&&n>=0&&n<=100) || typeof o.constraintsMet !== "boolean") ||
    input.claims.some(c => !c || typeof c.claim !== "string" || c.claim.length > 300 || typeof c.source !== "string" || c.source.length > 300 || typeof c.supports !== "boolean") ||
    input.pastStrategies.some(p => !p || typeof p.name !== "string" || p.name.length > 200 || typeof p.verified !== "boolean" || !["success","failure"].includes(p.outcome)) ||
    input.plan.some(p => !p || typeof p.step !== "string" || p.step.length > 300 || typeof p.done !== "boolean" || typeof p.blocked !== "boolean"))
    throw new Error("Когнитивный анализ превышает лимиты или содержит неверные поля");
  const observed = new Set(input.observations.map(x=>x.trim().toLowerCase()));
  const causes = input.hypotheses.map(h=>({cause:h.cause,matchedEvidence:h.evidence.filter(e=>observed.has(e.trim().toLowerCase())),requiresVerification:h.evidence.every(e=>!observed.has(e.trim().toLowerCase()))}))
    .sort((a,b)=>b.matchedEvidence.length-a.matchedEvidence.length || a.cause.localeCompare(b.cause));
  const ranked = input.options.filter(o=>o.constraintsMet).map(o=>({name:o.name,score:o.benefits-o.costs-o.risks}))
    .sort((a,b)=>b.score-a.score || a.name.localeCompare(b.name));
  const claims = [...new Set(input.claims.map(c=>c.claim))].map(claim=>{
    const ev=input.claims.filter(c=>c.claim===claim);
    return {claim,status:ev.some(c=>c.supports)&&ev.some(c=>!c.supports)?"conflicting" as const:ev.some(c=>c.supports)?"supported-by-input" as const:"unverified" as const,sources:ev.map(c=>c.source)};
  });
  const reusable=input.pastStrategies.filter(s=>s.verified&&s.outcome==="success").map(s=>s.name);
  const blocked=input.plan.find(p=>!p.done&&p.blocked);
  const next=input.plan.find(p=>!p.done&&!p.blocked);
  const unknowns=input.questions.filter(q=>!observed.has(q.trim().toLowerCase()));
  return { goal:input.goal, causalAnalysis:causes, options:ranked, evidenceReview:claims,
    reusableStrategies:reusable, replanning:{blockedAt:blocked?.step??null,nextStep:blocked?null:next?.step??null,needsReplan:!!blocked},
    researchGaps:unknowns, requiresHumanReview:true as const,
    note:"Анализ входных свидетельств, не доказательство причинности, достоверности источников или безопасности внешних действий." };
}
