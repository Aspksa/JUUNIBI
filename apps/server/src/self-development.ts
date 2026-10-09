import type { Skill } from "./learning-skill-tracker";
export type Goal = { skill: Skill; baseline: number; target: number; checks: number; achieved: boolean };
export type Metrics = Record<Skill,{attempts:number;recentAccuracy:number|null}>;
const skills: Skill[]=["arithmetic","logic","transfer"];
export function chooseGoal(m: Metrics, current: Goal|null): Goal|null {
 if(current && !current.achieved && current.checks<12)return {...current};
 const candidates=skills.filter(s=>m[s].attempts>=3 && m[s].recentAccuracy!==null && m[s].recentAccuracy!<75)
   .sort((a,b)=>m[a].recentAccuracy!-m[b].recentAccuracy!||a.localeCompare(b));
 const skill=candidates[0];if(!skill)return null;
 const baseline=m[skill].recentAccuracy!;
 return {skill,baseline,target:Math.min(90,baseline+15),checks:0,achieved:false};
}
export function updateGoal(goal:Goal,skill:Skill,correct:boolean,accuracy:number|null):Goal {
 if(goal.skill!==skill || goal.achieved)return {...goal};
 const checks=goal.checks+1;
 return {...goal,checks,achieved:checks>=3&&correct&&accuracy!==null&&accuracy>=goal.target};
}
export function restoreGoal(v:unknown):Goal|null {
 if(!v||typeof v!=="object")return null;
 const x=v as Partial<Goal>;
 return skills.includes(x.skill as Skill)&&typeof x.baseline==="number"&&x.baseline>=0&&x.baseline<=100&&
 typeof x.target==="number"&&x.target>=0&&x.target<=100&&Number.isInteger(x.checks)&&x.checks!>=0&&x.checks!<=12&&
 typeof x.achieved==="boolean"?x as Goal:null;
}
