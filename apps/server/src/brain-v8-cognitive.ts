import type { UnifiedCycleInput } from "./brain-v4-cycle";
import type { Goal } from "./self-development";
export interface CognitiveInput extends UnifiedCycleInput { developmentGoal?: Goal | null }
export function inspectCognition(input:CognitiveInput) {
 const findings: {kind:string;evidence:string;nextCheck:string}[]=[];
 const goal=input.developmentGoal;
 if(goal&&!goal.achieved&&goal.checks<12)
  findings.push({kind:"skill",evidence:goal.skill+" baseline "+goal.baseline+"%",nextCheck:"independently graded practice"});
 for(const group of input.decisionGroups??[])
  if(group.confirmed>=5&&group.successRate!==null&&group.successRate<65)
   findings.push({kind:"decisions",evidence:group.name.slice(0,64)+" "+group.successRate+"% over "+group.confirmed,nextCheck:"paired plan evaluation"});
 for(const tool of input.recentToolWarnings??[])
  if(tool.caution&&!tool.denied)
   findings.push({kind:"tools",evidence:tool.tool.slice(0,64),nextCheck:"review tool preconditions"});
 if(!findings.length)findings.push({kind:"unknown",evidence:"not enough measured deficiencies",nextCheck:"collect independent outcomes"});
 return {version:"8.0",focus:findings[0]!,findings:findings.slice(0,10),advisoryOnly:true as const,requiresApprovalForActions:true as const};
}
export function compareCognitiveExperiment(pairs:readonly {id:string;controlCorrect:boolean;candidateCorrect:boolean}[]) {
 if(!Array.isArray(pairs)||pairs.length>100||new Set(pairs.map(x=>x.id)).size!==pairs.length||
 pairs.some(x=>!x||typeof x.id!=="string"||!x.id||typeof x.controlCorrect!=="boolean"||typeof x.candidateCorrect!=="boolean"))
  throw new Error("Invalid paired observations");
 const n=pairs.length,before=pairs.filter(x=>x.controlCorrect).length,after=pairs.filter(x=>x.candidateCorrect).length;
 const regressions=pairs.filter(x=>x.controlCorrect&&!x.candidateCorrect).length;
 return {samples:n,controlCorrect:before,candidateCorrect:after,regressions,
  deltaPercentagePoints:n?Math.round(100*(after-before)/n):null,
  improvementSupported:n>=10&&after>before&&regressions===0};
}
