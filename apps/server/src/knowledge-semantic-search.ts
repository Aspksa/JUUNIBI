import type { EmbeddingProvider } from "@juunibi/assistant";
import type { KnowledgeNode } from "./knowledge-graph-diagnostics";
import { exploreKnowledge } from "./knowledge-graph-explorer";

/** Optional hybrid retrieval, read-only. No embedding means a fully functional lexical fallback. */
export async function searchKnowledgeSemantic(items: readonly KnowledgeNode[], query: string,
  provider?: EmbeddingProvider, limit=10) {
  const lexical=exploreKnowledge(items,query,new Date(),limit);
  if (!provider) return {...lexical,searchMode:"lexical" as const};
  try {
    const verified=items.filter(x=>x.status==="verified").slice(-100);
    const q=await provider.embed(query);
    if(!valid(q)) throw new Error("invalid query vector");
    const ranked=await Promise.all(verified.map(async item=>{
      const vector=await provider.embed(item.topic+" "+item.claim);
      if(!valid(vector)||vector.length!==q.length)throw new Error("invalid knowledge vector");
      const score=cosine(q,vector);
      const hit=lexical.items.find(x=>x.id===item.id);
      return {id:item.id,topic:item.topic,claim:item.claim,source:item.source,
        status:item.status,score:score*10+(hit?.score??0),semanticScore:score,
        shared:hit?.shared??[],due:item.nextReviewAt<=new Date().toISOString()};
    }));
    return {query,items:ranked.filter(x=>x.semanticScore>0||x.shared.length).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,limit),
      matched:ranked.length,verifiedOnly:true,evidence:"hybrid",searchMode:"hybrid" as const,
      warning:"Близость эмбеддингов — гипотеза о релевантности, а не проверка фактической истинности."};
  } catch {
    return {...lexical,searchMode:"lexical-fallback" as const};
  }
}
const valid=(v:number[])=>Array.isArray(v)&&v.length>0&&v.length<=4096&&v.every(Number.isFinite);
function cosine(a:number[],b:number[]) {
  let dot=0,aa=0,bb=0;
  for(let i=0;i<a.length;i++){dot+=a[i]!*b[i]!;aa+=a[i]!*a[i]!;bb+=b[i]!*b[i]!;}
  return aa>0&&bb>0?dot/Math.sqrt(aa*bb):0;
}
