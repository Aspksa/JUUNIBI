/** Read-only dependency-impact preview for changes to one knowledge claim. */
export interface KnowledgeNode { id:string; assertion:string; dependsOn:string[]; contradicts:string[] }
const valid=(x:unknown):x is string=>typeof x==="string"&&/^[a-zA-Z0-9_-]{1,60}$/.test(x);
const fail=():never=>{throw Object.assign(new Error("Некорректный граф знаний"),{status:400});};
export function assessKnowledgeImpact(nodes:KnowledgeNode[],changedId:string) {
 if(!Array.isArray(nodes)||nodes.length<1||nodes.length>100||!valid(changedId)||
 nodes.some(n=>!n||!valid(n.id)||typeof n.assertion!=="string"||!n.assertion.trim()||n.assertion.length>400||
 !Array.isArray(n.dependsOn)||!Array.isArray(n.contradicts)||n.dependsOn.length>30||n.contradicts.length>30||
 !n.dependsOn.every(valid)||!n.contradicts.every(valid))||
 new Set(nodes.map(n=>n.id)).size!==nodes.length)fail();
 const ids=new Set(nodes.map(n=>n.id));
 if(!ids.has(changedId)||nodes.some(n=>[...n.dependsOn,...n.contradicts].some(id=>!ids.has(id)||id===n.id)))fail();
 const affected=new Map<string,number>([[changedId,0]]);
 const queue=[changedId];
 for(let i=0;i<queue.length;i++){
  const id=queue[i]!;
  for(const n of nodes)if(n.dependsOn.includes(id)&&!affected.has(n.id)){
   affected.set(n.id,affected.get(id)!+1);queue.push(n.id);
  }
 }
 const contradictions=nodes.filter(n=>affected.has(n.id)).flatMap(n=>n.contradicts.map(other=>[n.id,other] as const));
 const pairIds=new Set<string>();
 const conflictPairs=contradictions.filter(([a,b])=>{const key=[a,b].sort().join(":");if(pairIds.has(key))return false;pairIds.add(key);return true;});
 const impacted=nodes.filter(n=>affected.has(n.id)&&n.id!==changedId).map(n=>({id:n.id,depth:affected.get(n.id)!,reason:"Зависит от изменённого утверждения прямо или через другие выводы"})).sort((a,b)=>a.depth-b.depth||a.id.localeCompare(b.id));
 return {changedId,impacted,contradictions:conflictPairs.map(([a,b])=>({left:a,right:b})),
  affectedCount:impacted.length,requiresApproval:true as const,
  note:"Анализ использует переданные зависимости и конфликты; истинность знаний не устанавливается и данные автоматически не изменяются."};
}
