/** Read-only, evidence-aware knowledge-graph diagnostics. Never infer truth from lexical overlap. */
export interface KnowledgeNode {
  id: string; topic: string; claim: string; source: string; status: "verified"|"needs-review";
  verifiedAt: string; nextReviewAt: string; reviewCount: number;
}
export interface KnowledgeConflict { left: string; right: string; reason: string; verified: false }
const arithmetic = (text:string) => {
  const m=/^\s*(\d{1,6})\s*([+×*-])\s*(\d{1,6})\s*=\s*(-?\d{1,12})\s*$/.exec(text);
  if(!m)return null;
  return {expression:m[1]+" "+m[2]+" "+m[3], result:BigInt(m[4]!).toString()};
};
export function diagnoseKnowledgeGraph(items: readonly KnowledgeNode[], at:Date=new Date()) {
  const active=items.filter(x=>x.status==="verified");
  const due=items.filter(x=>x.nextReviewAt<=at.toISOString());
  const conflicts:KnowledgeConflict[]=[];
  const seen=new Map<string,KnowledgeNode>();
  for(const item of active){
    const parsed=arithmetic(item.claim);
    if(!parsed)continue;
    const key=item.topic.normalize("NFKC").toLocaleLowerCase("ru")+"|"+parsed.expression;
    const prior=seen.get(key);
    if(prior){
      const previous=arithmetic(prior.claim);
      if(previous && previous.result!==parsed.result && conflicts.length<50){
        conflicts.push({left:prior.id,right:item.id,reason:"Разные результаты одного и того же арифметического выражения; требуется независимая перепроверка",verified:false});
      }
    } else seen.set(key,item);
  }
  const grouped=new Map<string,{topic:string;total:number;due:number}>();
  for(const item of items) {
    const key=item.topic.normalize("NFKC").toLocaleLowerCase("ru");
    const row=grouped.get(key)??{topic:item.topic,total:0,due:0};
    row.total++;
    if(item.nextReviewAt<=at.toISOString())row.due++;
    grouped.set(key,row);
  }
  return {nodes:items.length,verified:active.length,needsReview:items.length-active.length,
    due:due.length,conflicts,coverage:[...grouped.values()].sort((a,b)=>b.due-a.due||a.topic.localeCompare(b.topic,"ru")).slice(0,30),
    warning:"Связи и найденные несоответствия — диагностические подсказки, не доказательство фактов. Автоматического изменения памяти нет."};
}
