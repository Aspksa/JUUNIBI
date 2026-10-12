import type { DecisionRecord } from "./decision-memory";
import type { BrainPlan } from "./brain";
import { inspectCognitiveEngine, type StrategyProposal } from "./brain-cognitive-engine";
import { evaluateRetrievalQuality } from "./brain-plan-benchmarks";
import { evaluateStrategyCalibration, type StrategyCalibrationPolicy } from "./brain-strategy-calibration";

type Confirmed = DecisionRecord & {observed:"success"|"failure"};
const norm=(s:string)=>s.trim().toLocaleLowerCase("ru");
const words=(s:string)=>new Set(s.toLocaleLowerCase("ru").match(/[\p{L}\p{N}]{2,}/gu)??[]);
const overlap=(a:string,b:string)=>{const x=words(a),y=words(b);return [...x].filter(w=>y.has(w)).length;};
const confirmed=(items:DecisionRecord[]):Confirmed[]=>
  items.filter((x):x is Confirmed=>x.observed==="success"||x.observed==="failure");
export interface EvolutionSearchResult {
 id:string; goal:string; chosen:string; outcome:"success"|"failure";
 score:number; lexicalScore:number; graphScore:number; semanticScore:number|null;
 reasons:string[];
}
/** Evidence graph built exclusively from observed owner-confirmed decisions. */
export function inspectExperienceGraph(records:DecisionRecord[],decisionId:string,limit=20){
 if(!decisionId||!Number.isSafeInteger(limit)||limit<1||limit>50) throw new Error("Invalid graph inspection");
 const nodes=confirmed(records);
 const source=nodes.find(x=>x.id===decisionId);
 if(!source) return {sourceFound:false,edges:[],conflicts:[],inferredOutcomes:false};
 const edges=nodes.filter(x=>x.id!==source.id).map(x=>{
   const relations:string[]=[];
   if(norm(x.goal)===norm(source.goal))relations.push("shared-goal");
   if(x.taskType&&source.taskType&&norm(x.taskType)===norm(source.taskType))relations.push("shared-task-type");
   if(norm(x.chosen)===norm(source.chosen))relations.push("shared-strategy");
   return {from:source.id,to:x.id,relations,weight:relations.length,observed:x.observed};
 }).filter(x=>x.weight>0).sort((a,b)=>b.weight-a.weight||a.to.localeCompare(b.to)).slice(0,limit);
 const conflicts=edges.filter(x=>x.relations.includes("shared-strategy") &&
    x.relations.includes("shared-goal") && x.observed!==source.observed)
    .map(x=>({decisionIds:[source.id,x.to],reason:"opposite-confirmed-outcomes"}));
 return {sourceFound:true,edges,conflicts,inferredOutcomes:false};
}
/** Bounded lexical + graph retrieval; optional supplied semantic scores cannot create facts. */
export function hybridExperienceSearch(records:DecisionRecord[],query:string,options:{
 limit?:number;taskType?:string;semanticScores?:Record<string,number>;
}={}){
 if(typeof query!=="string"||!query.trim()||query.length>500)throw new Error("Invalid query");
 const limit=options.limit??8;
 if(!Number.isSafeInteger(limit)||limit<1||limit>20)throw new Error("Invalid limit");
 const recordsConfirmed=confirmed(records);
 const taskType=options.taskType?norm(options.taskType):null;
 const scored:EvolutionSearchResult[]=recordsConfirmed.map(x=>{
   const lexicalScore=overlap(query,x.goal+" "+x.chosen);
   const graphScore=taskType&&x.taskType&&norm(x.taskType)===taskType?1:0;
   const raw=options.semanticScores?.[x.id];
   const semanticScore=typeof raw==="number"&&Number.isFinite(raw)&&raw>=-1&&raw<=1?raw:null;
   const score=lexicalScore*2+graphScore+(semanticScore===null?0:Math.max(semanticScore,0));
   return {id:x.id,goal:x.goal,chosen:x.chosen,outcome:x.observed,score,lexicalScore,graphScore,
     semanticScore,reasons:[...(lexicalScore?["lexical-match"]:[]),...(graphScore?["task-type-link"]:[]),
       ...(semanticScore!==null?["semantic-similarity"]:[])]};
 }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,limit);
 return {items:scored,searchMode:"hybrid-evidence",examined:recordsConfirmed.length,
   excludedUnconfirmed:records.length-recordsConfirmed.length,requiresOwnerApproval:true};
}
/** Read-only strategy explanation with optional calibration preview, never an execution command. */
export function explainStrategyDecision(plan:BrainPlan,records:DecisionRecord[],strategies:StrategyProposal[],
 policy?:StrategyCalibrationPolicy){
 const review=inspectCognitiveEngine(plan,records,{strategies});
 const calibration=policy?evaluateStrategyCalibration(policy):null;
 const best=review.strategies[0];
 return {planId:plan.id,recommended:best&&!best.blocked?best.name:null,
   alternatives:review.strategies.map(s=>({name:s.name,score:s.score,
     evidenceIds:s.evidenceIds,successes:s.successes,failures:s.failures,
     insufficientEvidence:s.insufficientEvidence,blocked:s.blocked,
     unresolvedDependencies:s.unresolvedDependencies,risk:s.risk,
     requiresOwnerApproval:true})),
   calibration,unconfirmedExcluded:review.reflection.unconfirmedExcluded,
   confidence:best&&best.sampleSize>=3?"limited-confirmed-history":"insufficient-evidence",
   executesAutomatically:false,requiresExplicitExecution:true};
}
/** Reproducible retrieval suite, ranking safety and explanation checks. */
export function evaluateBrainEvolutionSuite(){
 const history:DecisionRecord[]=[
  {id:"a",goal:"audit archive",chosen:"inspect",reason:"fixture",predictedSuccess:true,
   at:"2026-01-01",observed:"success",observedAt:"2026-01-02",taskType:"archive"},
  {id:"b",goal:"audit archive",chosen:"delete",reason:"fixture",predictedSuccess:true,
   at:"2026-01-01",observed:"failure",observedAt:"2026-01-02",taskType:"archive"},
  {id:"pending",goal:"audit archive",chosen:"inspect",reason:"fixture",predictedSuccess:true,at:"2026-01-01"}
 ];
 const retrievalFixtures=[
  {query:"audit archive",relevantIds:["a","b"],
   retrievedIds:hybridExperienceSearch(history,"audit archive",{limit:5}).items.map(x=>x.id)},
  {query:"inspect",relevantIds:["a"],
   retrievedIds:hybridExperienceSearch(history,"inspect",{limit:5}).items.map(x=>x.id)}
 ];
 const retrieval=evaluateRetrievalQuality(retrievalFixtures,2);
 const graph=inspectExperienceGraph(history,"a");
 const plan:BrainPlan={id:"fixture",goal:"audit archive",status:"planned",createdAt:"2026-01-01",
   steps:[{id:"one",title:"inspect",status:"pending"}]};
 const explanation=explainStrategyDecision(plan,history,[
  {name:"delete",risk:"high",reversible:false},{name:"inspect",risk:"low",reversible:true}
 ]);
 const checks={
  excludesUnconfirmed:hybridExperienceSearch(history,"audit").excludedUnconfirmed===1,
  crossTaskRelations:graph.sourceFound&&graph.edges.length===1,
  retrievalHitRate:retrieval.hitRate===1,
  safeRanking:explanation.recommended==="inspect",
  noAutoExecution:explanation.executesAutomatically===false&&explanation.requiresExplicitExecution,
  explainsEvidence:explanation.alternatives.some(x=>x.evidenceIds.includes("a"))
 };
 return {checks,passed:Object.values(checks).filter(Boolean).length,
   total:Object.keys(checks).length,retrieval,method:"deterministic-fixture-regression",
   note:"Фиксированные примеры не измеряют реальное качество LLM или embeddings."};
}
