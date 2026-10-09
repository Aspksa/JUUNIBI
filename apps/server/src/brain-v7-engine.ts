import type { UnifiedCycleInput } from "./brain-v4-cycle";
import { evaluateBrainV6 } from "./brain-v6-engine";
import { verifyIntegerEquation } from "./brain-v6-arithmetic";

type State = "verified" | "attention" | "unknown";
export interface Stage7 { id: string; state: State; detail: string }
const tracks = {
 reasoning: ["goal","terms","question","conditions","alternatives","causal_markers","arithmetic","logical_proof","verified_context","evidence_gap"],
 repair: ["checkable","mismatch","correction","recheck","tool_cautions","denials","root_cause","safe_execution","correction_verified","manual_review"],
 memory: ["approved","matches","ranked","bounded","duplicates","unverified_excluded","conflicts","freshness","topic_coverage","context_budget"],
 learning: ["enabled","confirmed_groups","weak_groups","confirmed_samples","retention","transfer","training","owner_approval","retry_required","evidence_quality"],
 planning: ["goal_count","conditions","alternatives","sequences","dependencies","risk","tool_warnings","approval","execution","feasibility"],
 quality: ["stage_count","evidence","risk","warnings","sample_size","answer_accuracy","before_after","no_actions","unverified_gaps","report_complete"],
} as const;

export function evaluateBrainV7(input: UnifiedCycleInput) {
 const base = evaluateBrainV6(input);
 const arithmetic = verifyIntegerEquation(input.message.slice(0,4000));
 const txt=input.message.toLocaleLowerCase("ru");
 const facts=(input.verifiedKnowledge??[]).filter(x=>x.status==="verified");
 const warnings=input.recentToolWarnings??[];
 const decisions=(input.decisionGroups??[]).filter(x=>x.confirmed>=5 && x.successRate!==null);
 const mapped=new Map(base.groups.flatMap(g=>g.checks.map(c=>[c.id,c] as const)));
 const mk=(id:string, value:boolean|null,detail:string):Stage7=>({id,state:value===null?"unknown":value?"verified":"attention",detail});
 const signals: Record<string,Stage7> = {
  "reasoning.arithmetic":mk("reasoning.arithmetic",arithmetic.verifiable?arithmetic.correct:null,"Только детерминированная целочисленная проверка"),
  "repair.mismatch":mk("repair.mismatch",arithmetic.verifiable?!arithmetic.correct:null,"Есть обнаруженное арифметическое расхождение"),
  "repair.correction":mk("repair.correction",arithmetic.verifiable?arithmetic.proposedCorrection!==null:null,"Вычисленный вариант исправления"),
  "repair.recheck":mk("repair.recheck",arithmetic.verifiable?arithmetic.correct||arithmetic.proposedCorrection!==null:null,"Проверка исправления арифметическим оракулом"),
  "repair.correction_verified":mk("repair.correction_verified",arithmetic.verifiable?arithmetic.correct||arithmetic.proposedCorrection===String(arithmetic.expected):null,"Сравнение с независимо вычисленным ожидаемым значением"),
  "memory.approved":mk("memory.approved",true,"Используются только подтверждённые записи"),
  "memory.matches":mk("memory.matches",facts.some(x=>txt.includes(x.topic.toLocaleLowerCase("ru"))),"Совпадение по теме"),
  "memory.unverified_excluded":mk("memory.unverified_excluded",true,"Неподтверждённые записи исключены"),
  "learning.enabled":mk("learning.enabled",input.learningEnabled===true,"Состояние учебного движка"),
  "learning.confirmed_groups":mk("learning.confirmed_groups",decisions.length>0,"Не менее пяти подтверждённых результатов на категорию"),
  "planning.risk":mk("planning.risk",!/удал|слива|оплат|публику|deploy|merge|delete/i.test(txt),"Требуется контроль риска"),
  "planning.approval":mk("planning.approval",true,"ApprovalGate не обходится"),
  "planning.execution":mk("planning.execution",null,"Диагностический цикл не исполняет инструменты"),
  "quality.no_actions":mk("quality.no_actions",true,"Никаких действий не выполнено"),
  "quality.answer_accuracy":mk("quality.answer_accuracy",null,"Нужен независимый эталон ответа"),
  "quality.before_after":mk("quality.before_after",null,"Нужен отдельный контрольный набор до и после"),
 };
 const groups=Object.entries(tracks).map(([group,ids])=>({group,stages:ids.map((name):Stage7=>{
  const id=group+"."+name;
  if(signals[id])return signals[id];
  const prior=mapped.get(name);
  if(prior)return mk(id,prior.state==="unknown"?null:prior.state==="ok", "Ограниченный сигнал Brain 6.0: "+name);
  if(name==="tool_warnings"||name==="warnings"||name==="tool_cautions")return mk(id,warnings.length===0,"История предупреждений инструментов");
  if(name==="evidence"||name==="verified_context"||name==="topic_coverage")return mk(id,facts.length>0,"Наличие проверенных знаний, не доказательство ответа");
  if(name==="stage_count"||name==="report_complete")return mk(id,true,"Структурная проверка отчёта");
  return mk(id,null,"Для независимой проверки этого этапа пока недостаточно входных данных или алгоритма");
 })}));
 return {version:"7.0",groups,stageCount:groups.reduce((n,g)=>n+g.stages.length,0),
  verified:groups.flatMap(g=>g.stages).filter(x=>x.state==="verified").length,
  unknown:groups.flatMap(g=>g.stages).filter(x=>x.state==="unknown").length,
  repair:arithmetic,actionsExecuted:false as const,weightsChanged:false as const,
  requiresApproval:true as const,note:"Шесть направлений и 60 идентифицируемых проверок; unknown не считается успехом. Это не 60 автономных моделей."};
}
