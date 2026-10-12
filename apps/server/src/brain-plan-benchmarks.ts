import { inspectCognitiveEngine, type StrategyProposal } from "./brain-cognitive-engine";
import type { BrainPlan } from "./brain";
import type { DecisionRecord } from "./decision-memory";

interface Case {id:string; goal:string; strategies:StrategyProposal[]; history:DecisionRecord[]; expectBest?:string; expectBlocked?:string; expectExcluded?:number}
const decision=(id:string,goal:string,chosen:string,outcome?:"success"|"failure"):DecisionRecord=>({
  id,at:"2026-01-01T00:00:00Z",goal,chosen,reason:"Проверочная запись",predictedSuccess:true,
  ...(outcome?{observed:outcome,observedAt:"2026-01-02T00:00:00Z"}:{})
});
const cases:Case[]=[
  {id:"irreversible-risk",goal:"проверить архив",strategies:[
    {name:"удалить",risk:"high",reversible:false},{name:"просмотреть",risk:"low",reversible:true}],history:[],expectBest:"просмотреть"},
  {id:"confirmed-failure",goal:"проверить архив",strategies:[
    {name:"быстро",risk:"low",reversible:true},{name:"бережно",risk:"low",reversible:true}],
    history:[decision("a","проверить архив","быстро","failure"),decision("b","проверить архив","бережно","success")],expectBest:"бережно"},
  {id:"dependency-block",goal:"проверить архив",strategies:[
    {name:"просмотреть",risk:"low",reversible:true,dependsOn:["подготовка"]},{name:"удалить",risk:"high",reversible:false}],
    history:[],expectBlocked:"просмотреть"},
  {id:"unconfirmed-is-not-evidence",goal:"проверить архив",strategies:[
    {name:"быстро",risk:"low",reversible:true},{name:"бережно",risk:"low",reversible:true}],
    history:[decision("c","проверить архив","быстро")],expectExcluded:1},
  {id:"confirmed-graph-link",goal:"проверить архив",strategies:[
    {name:"просмотреть",risk:"low",reversible:true},{name:"удалить",risk:"high",reversible:false}],
    history:[decision("d","проверить архив","просмотреть","success")],expectBest:"просмотреть"}
];
/** Deterministic regression cases; not a measured LLM intelligence score. */
export function evaluateBrainPlanBenchmarks(){
  const items=cases.map(c=>{
    const plan:BrainPlan={id:"benchmark:"+c.id,goal:c.goal,createdAt:"2026-01-01",status:"planned",
      steps:[{id:"step-1",title:"проверить",status:"pending"}]};
    const output=inspectCognitiveEngine(plan,c.history,{strategies:c.strategies});
    const checks=[
      c.expectBest===undefined || output.strategies[0]?.name===c.expectBest,
      c.expectBlocked===undefined || output.strategies.some(s=>s.name===c.expectBlocked&&s.blocked),
      c.expectExcluded===undefined || output.reflection.unconfirmedExcluded===c.expectExcluded,
      output.adaptivePlan.executesAutomatically===false && output.requiresExplicitExecution===true
    ];
    return {id:c.id,passed:checks.every(Boolean),checks:checks.length,failedChecks:checks.filter(x=>!x).length};
  });
  return {total:items.length,passed:items.filter(x=>x.passed).length,failed:items.filter(x=>!x.passed).length,
    items,method:"deterministic-fixture-regression" as const,
    note:"Это проверки логики алгоритма на фиксированных примерах, не оценка интеллекта модели."};
}

/** Retrieval benchmark: precision/recall at K, MRR and hit rate on labelled fixtures.
 * The caller supplies actual ranked search results; this function does not claim model accuracy.
 */
export function evaluateRetrievalQuality(fixtures:{
  query:string; relevantIds:string[]; retrievedIds:string[];
}[],k=5){
  if(!Number.isSafeInteger(k)||k<1||k>20 || fixtures.length>100)
    throw new Error("Invalid retrieval benchmark");
  const cases=fixtures.map(item=>{
    const relevant=new Set(item.relevantIds);
    const ranked=[...new Set(item.retrievedIds)].slice(0,k);
    const hits=ranked.filter(id=>relevant.has(id)).length;
    const first=ranked.findIndex(id=>relevant.has(id));
    return {query:item.query,precisionAtK:hits/k,
      recallAtK:relevant.size?hits/relevant.size:0,
      reciprocalRank:first<0?0:1/(first+1),
      hitAtK:first>=0?1:0};
  });
  const mean=(key:"precisionAtK"|"recallAtK"|"reciprocalRank"|"hitAtK")=>
    cases.length?cases.reduce((total,item)=>total+item[key],0)/cases.length:0;
  return {count:cases.length,k,precisionAtK:mean("precisionAtK"),
    recallAtK:mean("recallAtK"),mrr:mean("reciprocalRank"),
    hitRate:mean("hitAtK"),cases,method:"labelled-retrieval-evaluation" as const};
}
