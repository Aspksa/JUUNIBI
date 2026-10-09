/** Deterministic, read-only consistency review over explicit propositions. */
export interface ReasoningClaim {
  id: string; proposition: string; stance: "true" | "false";
  evidenceIds: string[]; dependsOn: string[];
}
export interface ReasoningEvidence { id: string; verified: boolean }
const validId=(x:unknown):x is string=>typeof x==="string" && /^[a-zA-Z0-9_-]{1,60}$/.test(x);
const invalid=():never=>{throw Object.assign(new Error("Некорректные утверждения или доказательства"),{status:400});};
export function reviewReasoning(claims:ReasoningClaim[], evidence:ReasoningEvidence[]) {
  if (!Array.isArray(claims) || claims.length<1 || claims.length>30 ||
    !Array.isArray(evidence) || evidence.length>60 ||
    claims.some(c=>!c || !validId(c.id) || typeof c.proposition!=="string" ||
      !c.proposition.trim() || c.proposition.length>250 || (c.stance!=="true" && c.stance!=="false") ||
      !Array.isArray(c.evidenceIds) || c.evidenceIds.length>20 || !c.evidenceIds.every(validId) ||
      !Array.isArray(c.dependsOn) || c.dependsOn.length>20 || !c.dependsOn.every(validId)) ||
    evidence.some(e=>!e || !validId(e.id) || typeof e.verified!=="boolean") ||
    new Set(claims.map(c=>c.id)).size!==claims.length ||
    new Set(evidence.map(e=>e.id)).size!==evidence.length) invalid();
  const known=new Map(evidence.map(e=>[e.id,e.verified]));
  const index=new Map(claims.map(c=>[c.id,c]));
  if (claims.some(c=>c.dependsOn.includes(c.id) || c.dependsOn.some(d=>!index.has(d)))) invalid();
  const visited=new Set<string>(), active=new Set<string>();
  const cycle=(id:string):boolean=>{
    if(active.has(id))return true;
    if(visited.has(id))return false;
    active.add(id);
    for(const dep of index.get(id)!.dependsOn)if(cycle(dep))return true;
    active.delete(id);visited.add(id);return false;
  };
  if(claims.some(c=>cycle(c.id)))invalid();
  const conflicts: {proposition:string; claimIds:string[]}[]=[];
  const byProposition=new Map<string,ReasoningClaim[]>();
  for(const c of claims){
    const key=c.proposition.trim().toLowerCase();
    byProposition.set(key,[...(byProposition.get(key)??[]),c]);
  }
  for(const [proposition,group] of byProposition) {
    if(group.some(c=>c.stance==="true") && group.some(c=>c.stance==="false"))
      conflicts.push({proposition,claimIds:group.map(c=>c.id)});
  }
  const findings=claims.map(c=>{
    const issues:string[]=[];
    if(c.evidenceIds.length===0)issues.push("Нет подтверждающих источников");
    for(const id of c.evidenceIds) {
      if(!known.has(id))issues.push("Неизвестный источник: "+id);
      else if(!known.get(id))issues.push("Источник не подтверждён: "+id);
    }
    if(conflicts.some(g=>g.claimIds.includes(c.id)))issues.push("Противоречие с другим утверждением");
    return {id:c.id,issues,needsReview:issues.length>0,
      suggestion:issues.length?"Перепроверить исходные предположения и доказательства":"Нет обнаруженных формальных проблем"};
  });
  return {findings,conflicts,reviewCount:findings.filter(f=>f.needsReview).length,
    note:"Формальная проверка структуры и отметок подтверждения, не независимая проверка истинности утверждений.",
    requiresApproval:true as const};
}
