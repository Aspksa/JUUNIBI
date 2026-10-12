import type { KnowledgeNode } from "./knowledge-graph-diagnostics";

/** Read-only explainable traversal; text similarity is never evidence of factual truth. */
export interface KnowledgeHit { id:string; topic:string; claim:string; source:string; status:KnowledgeNode["status"]; score:number; shared:string[]; due:boolean }
const tokens=(s:string)=>new Set((s.normalize("NFKC").toLocaleLowerCase("ru").match(/[\p{L}\p{N}]{3,}/gu)??[]).filter(w=>w.length<=50));
export function exploreKnowledge(items:readonly KnowledgeNode[], query:string, at=new Date(), limit=10) {
  if(typeof query!=="string" || !query.trim() || query.length>500 || !Number.isSafeInteger(limit) || limit<1 || limit>30)
    throw new Error("Некорректные параметры поиска знаний");
  const terms=tokens(query);
  const result:KnowledgeHit[]=items.filter(item=>item.status==="verified").map(item=>{
    const claim=tokens(item.claim),topic=tokens(item.topic);
    const shared=[...terms].filter(t=>claim.has(t)||topic.has(t));
    const score=shared.reduce((n,t)=>n+(topic.has(t)?3:1),0);
    return {id:item.id,topic:item.topic,claim:item.claim,source:item.source,status:item.status,score,shared,due:item.nextReviewAt<=at.toISOString()};
  }).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||Number(a.due)-Number(b.due)||a.id.localeCompare(b.id)).slice(0,limit);
  return {query,items:result,matched:result.length,verifiedOnly:true,evidence:"lexical",warning:"Совпадение слов — не доказательство достоверности или причинной связи."};
}
/** Deterministic neighbourhood within verified nodes; edges are only suggestions. */
export function exploreKnowledgeNeighbors(items:readonly KnowledgeNode[], id:string, limit=12) {
  if(typeof id!=="string"||!id||id.length>128||!Number.isSafeInteger(limit)||limit<1||limit>30)
    throw new Error("Некорректные параметры графа");
  const target=items.find(x=>x.id===id&&x.status==="verified");
  if(!target)return {id,items:[],verifiedOnly:true};
  const terms=tokens(target.topic+" "+target.claim);
  const entries=items.filter(x=>x.id!==id&&x.status==="verified").map(x=>{
    const shared=[...terms].filter(w=>tokens(x.topic+" "+x.claim).has(w));
    return {id:x.id,topic:x.topic,shared,score:shared.length,verified:false as const};
  }).filter(x=>x.score>=2).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,limit);
  return {id,items:entries,verifiedOnly:true};
}
