import type { VerifiedKnowledge } from "./knowledge-ledger";
import { searchVerifiedKnowledge } from "./brain-knowledge-search";

/** Evidence-aware, read-only memory analysis. No automatic promotion or deletion. */
export function analyzeMemoryV4(items: readonly VerifiedKnowledge[], query: string, at = new Date()) {
  const verified = items.filter(x => x.status === "verified");
  const normalize = (s: string) => s.normalize("NFKC").toLocaleLowerCase("ru").replace(/ё/g,"е").replace(/\s+/g," ").trim();
  const duplicates = new Map<string,string[]>();
  for (const x of items) {
    const key = normalize(x.topic)+"|"+normalize(x.claim);
    duplicates.set(key,[...(duplicates.get(key) ?? []),x.id]);
  }
  const duplicateGroups = [...duplicates.values()].filter(group => group.length>1).slice(0,30);
  const dueForReview = items.filter(x=>x.status==="needs-review" || (Number.isFinite(Date.parse(x.nextReviewAt)) && Date.parse(x.nextReviewAt)<=at.getTime())).map(x=>x.id).slice(0,100);
  const edges: {from:string;to:string;relation:"same-topic";verified:false}[]=[];
  for (let i=0;i<verified.length;i++) for(let j=i+1;j<verified.length;j++) {
    if (normalize(verified[i]!.topic)!==normalize(verified[j]!.topic)) continue;
    edges.push({from:verified[i]!.id,to:verified[j]!.id,relation:"same-topic",verified:false});
    if(edges.length>=100)break;
  }
  const conflicts: {left:string;right:string;reason:string;verified:false}[]=[];
  for(let i=0;i<verified.length;i++) for(let j=i+1;j<verified.length;j++) {
    const a=verified[i]!,b=verified[j]!;
    if(normalize(a.topic)!==normalize(b.topic))continue;
    const x=normalize(a.claim),y=normalize(b.claim);
    const strip=(s:string)=>s.replace(/^(?:не |not )/,"");
    if(x!==y && strip(x)===strip(y) && (x.startsWith("не ")!==y.startsWith("не "))) {
      conflicts.push({left:a.id,right:b.id,reason:"Противоположное отрицание; требуется проверка контекста и времени",verified:false});
    }
  }
  const recall=searchVerifiedKnowledge(verified,query,3);
  return {version:"4.0",recall,duplicateGroups,links:edges.slice(0,100),potentialConflicts:conflicts.slice(0,30),
    dueForReview,stats:{records:items.length,verified:verified.length,matched:recall.length},
    note:"Связи и конфликты — кандидаты на проверку, а не доказанные факты; исходные записи не меняются."};
}
