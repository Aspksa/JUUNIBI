import { inspectCognitiveEngine, type StrategyProposal } from "./brain-cognitive-engine";
import type { BrainPlan } from "./brain";
import type { DecisionRecord } from "./decision-memory";

/** Held-out fixtures assess ranking changes; never grants execution permission. */
interface CalibrationCase {
  id:string; goal:string; strategies:StrategyProposal[];
  history:DecisionRecord[]; expected:string;
}
const record=(id:string,goal:string,chosen:string,observed:"success"|"failure"):DecisionRecord=>({
  id,goal,chosen,at:"2026-01-01T00:00:00Z",observedAt:"2026-01-02T00:00:00Z",
  observed,reason:"labelled calibration fixture",predictedSuccess:true
});
const fixtures:CalibrationCase[]=[
  {id:"safe-archive",goal:"audit archive",strategies:[
    {name:"inspect",risk:"low",reversible:true},{name:"erase",risk:"high",reversible:false}],
    history:[record("a","audit archive","inspect","success")],expected:"inspect"},
  {id:"confirmed-failure",goal:"verify package",strategies:[
    {name:"skip",risk:"low",reversible:true},{name:"verify",risk:"low",reversible:true}],
    history:[record("b","verify package","skip","failure"),record("c","verify package","verify","success")],expected:"verify"},
  {id:"dependency",goal:"deploy build",strategies:[
    {name:"deploy",risk:"low",reversible:true,dependsOn:["tests"]},
    {name:"review",risk:"low",reversible:true}],history:[],expected:"review"},
  {id:"no-evidence",goal:"review document",strategies:[
    {name:"review",risk:"low",reversible:true},{name:"delete",risk:"high",reversible:false}],
    history:[],expected:"review"}
];

export interface StrategyCalibrationPolicy {
  successWeight:number; failureWeight:number; riskWeight:number;
}
const baseline:StrategyCalibrationPolicy={successWeight:1,failureWeight:1,riskWeight:1};
function valid(p:StrategyCalibrationPolicy){
  return [p.successWeight,p.failureWeight,p.riskWeight].every(x=>Number.isFinite(x)&&x>=0&&x<=5);
}
function evaluate(p:StrategyCalibrationPolicy){
  const cases=fixtures.map(c=>{
    const plan:BrainPlan={id:"calibration:"+c.id,goal:c.goal,createdAt:"2026-01-01",
      status:"planned",steps:[{id:"step",title:"review",status:"pending"}]};
    const result=inspectCognitiveEngine(plan,c.history,{strategies:c.strategies});
    const scored=result.strategies.map(s=>{
      const baseRisk={low:0,medium:2,high:5}[s.risk]+(s.reversible?0:3);
      return {...s,calibratedScore:s.successes*p.successWeight-s.failures*p.failureWeight-
        baseRisk*p.riskWeight-(s.blocked?5:0)};
    }).sort((a,b)=>Number(a.blocked)-Number(b.blocked)||
      b.calibratedScore-a.calibratedScore||a.originalIndex-b.originalIndex);
    return {id:c.id,expected:c.expected,selected:scored[0]?.name??null,
      passed:scored[0]?.name===c.expected,
      safe:!scored[0]?.blocked && !(scored[0]?.risk==="high"&&!scored[0]?.reversible)};
  });
  return {passed:cases.filter(c=>c.passed).length,safetyFailures:cases.filter(c=>!c.safe).length,cases};
}
export function evaluateStrategyCalibration(candidate:StrategyCalibrationPolicy){
  if(!valid(candidate)) throw Object.assign(new Error("Некорректные веса стратегии"),{status:400});
  const original=evaluate(baseline),proposed=evaluate(candidate);
  const accepted=proposed.passed>original.passed && proposed.safetyFailures===0 &&
    proposed.cases.every(c=>c.safe);
  return {baseline:original,proposed,accepted,activation:"manual-review-only" as const,
    appliesAutomatically:false as const,fixtureCount:fixtures.length,
    reason:accepted?"Улучшение на фиксированном наборе; необходим независимый контроль":
      "Нет доказанного безопасного улучшения на проверочных сценариях",
    note:"Подбор весов на этих же сценариях не доказывает обобщающую способность. Исполнение действий запрещено."};
}
