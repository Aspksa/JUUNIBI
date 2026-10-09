import type { DecisionRecord } from "./decision-memory";

export interface LearningCase {
  id: string; taskType: string; symptoms: string[]; candidateFixes: {
    id: string; title: string; cost: number; risk: number; coveredSymptoms: string[];
  }[];
  checks: { id: string; fixId: string; passed: boolean; verified: boolean }[];
}
const valid = (s: unknown): s is string => typeof s === "string" && /^[a-zA-Z0-9_-]{1,60}$/.test(s);
const reject = (): never => { throw Object.assign(new Error("Некорректная учебная задача"), {status:400}); };
/**
 * Ten explicitly numbered, deterministic, read-only reasoning stages.
 * Reports are hypotheses rather than observed improvements; approval always required.
 */
export function reviewLearningCase(input: LearningCase, history: DecisionRecord[]) {
  if (!input || !valid(input.id) || !valid(input.taskType) ||
      !Array.isArray(input.symptoms) || input.symptoms.length > 20 || !input.symptoms.every(valid) ||
      !Array.isArray(input.candidateFixes) || input.candidateFixes.length < 1 || input.candidateFixes.length > 12 ||
      !Array.isArray(input.checks) || input.checks.length > 80) reject();
  if (input.candidateFixes.some(f => !f || !valid(f.id) || typeof f.title!=="string" ||
      f.title.length>160 || !f.title.trim() || !Number.isFinite(f.cost) || f.cost<0 || f.cost>1000000 ||
      !Number.isFinite(f.risk) || f.risk<0 || f.risk>100 ||
      !Array.isArray(f.coveredSymptoms) || f.coveredSymptoms.length>20 || !f.coveredSymptoms.every(valid)) ||
      new Set(input.candidateFixes.map(f=>f.id)).size!==input.candidateFixes.length ||
      input.checks.some(c=>!c || !valid(c.id) || !valid(c.fixId) ||
        typeof c.passed!=="boolean" || typeof c.verified!=="boolean" ||
        !input.candidateFixes.some(f=>f.id===c.fixId)) ||
      new Set(input.checks.map(c=>c.id)).size!==input.checks.length) reject();

  // 1: classify; 2: collect confirmed outcomes; 3: detect repetition.
  const observed=(Array.isArray(history)?history:[]).slice(-100).filter(r=>r.taskType===input.taskType &&
    (r.observed==="success" || r.observed==="failure"));
  const failures=observed.filter(r=>r.observed==="failure").length;
  const repeated=failures>=3;
  // 4: enumerate countermeasures; 5: score symptom coverage; 6: enforce risk bound.
  const symptoms=new Set(input.symptoms);
  const assessed=input.candidateFixes.map(f=>{
    const coverage=new Set(f.coveredSymptoms.filter(s=>symptoms.has(s))).size;
    // 7: distinguish unverified tests; 8: count verified passes and failures.
    const confirmed=input.checks.filter(c=>c.fixId===f.id && c.verified);
    const passed=confirmed.filter(c=>c.passed).length;
    const failed=confirmed.length-passed;
    // 9: no recommendation until at least one verified successful test and no verified failure.
    const eligible=coverage>0 && f.risk<=30 && passed>0 && failed===0;
    return {id:f.id,title:f.title,cost:f.cost,risk:f.risk,coverage,verifiedPasses:passed,
      verifiedFailures:failed,unverifiedChecks:input.checks.filter(c=>c.fixId===f.id && !c.verified).length,
      eligible,score:eligible?coverage*10 + passed*2 - f.cost*0.01 - f.risk:null};
  });
  // 10: transparent, deterministic choice with strict safety and approval gate.
  const ranked=assessed.filter(a=>a.eligible).sort((a,b)=>(b.score??0)-(a.score??0) ||
    a.id.localeCompare(b.id));
  return {caseId:input.id,taskType:input.taskType,history:{confirmed:observed.length,failures,repeated},
    stages:["classify-task","collect-confirmed-outcomes","detect-repeated-errors","enumerate-fixes",
      "measure-coverage","check-risk","separate-unverified-checks","evaluate-verified-tests",
      "reject-unsafe-or-untested","rank-and-request-approval"],
    fixes:assessed,recommendedId:ranked[0]?.id??null,
    note:"Тесты имеют статус verified только по данным запроса. Этот метод сам не проверяет достоверность источника и не выполняет исправления.",
    requiresApproval:true as const};
}
