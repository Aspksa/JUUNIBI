/** Read-only calibration and revision preview; evidence flags are caller-supplied, not independently verified. */
export interface ReasoningExample { id:string; expected:boolean; predicted:boolean; verified:boolean }
export interface ReasoningRevision { id:string; stance:boolean; evidenceIds:string[] }
export interface RevisionEvidence { id:string; supports:boolean; verified:boolean }
const safe=(v:unknown):v is string=>typeof v==="string" && /^[a-zA-Z0-9_-]{1,60}$/.test(v);
const bad=():never=>{throw Object.assign(new Error("Некорректные контрольные данные"),{status:400});};
export function reviewReasoningRevision(examples:ReasoningExample[], claim:ReasoningRevision, evidence:RevisionEvidence[]) {
  if (!Array.isArray(examples) || examples.length>100 || !Array.isArray(evidence) || evidence.length>60 ||
    !claim || !safe(claim.id) || typeof claim.stance!=="boolean" || !Array.isArray(claim.evidenceIds) ||
    claim.evidenceIds.length>30 || !claim.evidenceIds.every(safe) ||
    examples.some(e=>!e || !safe(e.id) || typeof e.expected!=="boolean" ||
      typeof e.predicted!=="boolean" || typeof e.verified!=="boolean") ||
    evidence.some(e=>!e || !safe(e.id) || typeof e.supports!=="boolean" || typeof e.verified!=="boolean") ||
    new Set(examples.map(e=>e.id)).size!==examples.length ||
    new Set(evidence.map(e=>e.id)).size!==evidence.length) bad();
  const checked=examples.filter(e=>e.verified);
  const correct=checked.filter(e=>e.expected===e.predicted).length;
  const accuracy=checked.length?correct/checked.length:null;
  const known=new Map(evidence.map(e=>[e.id,e]));
  const supported=claim.evidenceIds.map(id=>known.get(id)).filter((e):e is RevisionEvidence=>!!e && e.verified);
  const votesFor=supported.filter(e=>e.supports).length;
  const votesAgainst=supported.length-votesFor;
  const missing=claim.evidenceIds.filter(id=>!known.get(id)?.verified);
  const recommendedStance= votesFor>votesAgainst ? true : votesAgainst>votesFor ? false : null;
  const revise=recommendedStance!==null && recommendedStance!==claim.stance;
  return {claimId:claim.id,tests:{verified:checked.length,correct,accuracy},
    evidence:{supporting:votesFor,opposing:votesAgainst,missing},
    previousStance:claim.stance,proposedStance:revise?recommendedStance:null,
    assessment:missing.length?"Требуются дополнительные подтверждения источников":revise?"Есть основания пересмотреть позицию":"Недостаточно оснований менять позицию",
    confidence: supported.length>=3 && checked.length>=3 ? "moderate" as const : "insufficient" as const,
    note:"Доли совпадений и подсчёт свидетельств не являются вероятностью истинности. Решение не обновляется автоматически.",
    requiresApproval:true as const};
}
