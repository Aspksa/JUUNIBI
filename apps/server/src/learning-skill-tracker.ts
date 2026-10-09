/** Bounded, deterministic learning analytics. Never promotes unverified model output to knowledge. */
export type Skill = "arithmetic" | "logic" | "transfer";
export type Phase = "practice" | "retry" | "retention" | "generalization";
export interface Assessment { skill: Skill; phase: Phase; correct: boolean; turn: number }
const skills: Skill[] = ["arithmetic","logic","transfer"];
export class LearningSkillTracker {
  private history: Assessment[] = [];
  load(raw: unknown) {
    if (!Array.isArray(raw)) return;
    this.history = raw.filter((v): v is Assessment => !!v && typeof v==="object" &&
      skills.includes(v.skill) && ["practice","retry","retention","generalization"].includes(v.phase) &&
      typeof v.correct==="boolean" && Number.isInteger(v.turn) && v.turn>=0 && v.turn<=1000000).slice(-180);
  }
  record(value: Assessment) {
    this.history.push({...value});
    this.history=this.history.slice(-180);
  }
  snapshot() {return this.history.map(x=>({...x}));}
  metrics(skill: Skill) {
    const rows=this.history.filter(x=>x.skill===skill);
    const recent=rows.slice(-12);
    const score=(list:Assessment[])=>list.length?Math.round(100*list.filter(x=>x.correct).length/list.length):null;
    const general=rows.filter(x=>x.phase==="generalization");
    const retained=rows.filter(x=>x.phase==="retention");
    return {attempts:rows.length,accuracy:score(rows),recentAccuracy:score(recent),
      generalizationAccuracy:score(general),retentionAccuracy:score(retained),
      confidence:recent.length>=6?"measured":recent.length>=3?"preliminary":"insufficient",
      needsPractice:recent.length>=3 && recent.filter(x=>x.correct).length*100<recent.length*70};
  }
  summary() {return Object.fromEntries(skills.map(s=>[s,this.metrics(s)])) as Record<Skill,ReturnType<LearningSkillTracker["metrics"]>>;}
  weakest() {
    const eligible=skills.map(skill=>({skill,...this.metrics(skill)})).filter(x=>x.attempts>=3);
    eligible.sort((a,b)=>(a.recentAccuracy??100)-(b.recentAccuracy??100)||a.skill.localeCompare(b.skill));
    return eligible.length && (eligible[0]!.recentAccuracy??100)<70 ? eligible[0]!.skill : null;
  }
}
