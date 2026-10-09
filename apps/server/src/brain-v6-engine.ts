import type { UnifiedCycleInput } from "./brain-v4-cycle";
import { verifyIntegerEquation } from "./brain-v6-arithmetic";
type State = "ok" | "attention" | "unknown";
type Check = { id:string; state:State; value:number|boolean|null };
export function evaluateBrainV6(input:UnifiedCycleInput) {
 if(!input || typeof input.message!=="string" || input.message.length>100000) throw new Error("Invalid brain request");
 const msg=input.message.slice(0,4000);
 const tokens=(s:string)=>new Set((s.normalize("NFKC").toLocaleLowerCase("ru").replace(/ё/g,"е").match(/[\p{L}\p{N}]{3,}/gu)??[]));
 const words=tokens(msg);
 const facts=(input.verifiedKnowledge??[]).filter(x=>x.status==="verified").slice(0,500);
 const matches=facts.map(x=>[x,[...words].filter(t=>tokens(x.topic+" "+x.claim).has(t)).length] as const).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]).slice(0,8);
 const warnings=(input.recentToolWarnings??[]).slice(0,50);
 const decisions=(input.decisionGroups??[]).filter(x=>x.confirmed>=5 && x.successRate!==null && Number.isFinite(x.successRate)).slice(0,50);
 const arithmetic=verifyIntegerEquation(msg);
 const risk=/удал|публику|оплат|запуст|отправ|слива|delete|deploy|pay|merge/i.test(msg);
 const mk=(id:string,value:boolean|number|null):Check=>({id,value,state:value===null?"unknown":typeof value==="number"?"ok":value?"ok":"attention"});
 const groups=[
 {name:"reasoning",checks:[
 mk("goal",msg.trim().length>0),mk("terms",words.size),mk("question",/[?？]/.test(msg)),mk("conditions",/если|иначе/i.test(msg)),
 mk("alternatives",/или|вариант/i.test(msg)),mk("causal_cues",/потому|поэтому/i.test(msg)),
 mk("equation_valid",arithmetic.verifiable?arithmetic.correct:null),mk("logical_proof",null)]},
 {name:"repair",checks:[
 mk("checkable",arithmetic.verifiable),mk("mismatch",arithmetic.verifiable?!arithmetic.correct:null),
 mk("correction",arithmetic.verifiable?arithmetic.proposedCorrection!==null:null),
 mk("recheck",arithmetic.verifiable?arithmetic.correct||arithmetic.proposedCorrection!==null:null),
 mk("tool_cautions",warnings.filter(x=>x.caution).length),
 mk("prior_denials",warnings.reduce((n,x)=>n+x.denied,0)),
 mk("write_disabled",true),mk("root_cause",null)]},
 {name:"memory",checks:[
 mk("approved_only",true),mk("matched",matches.length),mk("ranking",matches.every((x,i)=>i===0||matches[i-1]![1]>=x[1])),
 mk("bounded",matches.length<=8),mk("duplicates",facts.length-new Set(facts.map(x=>x.claim.trim().toLowerCase())).size),
 mk("unverified_excluded",true),mk("semantic_conflicts",null),mk("freshness_verified",null)]},
 {name:"learning",checks:[
 mk("enabled",input.learningEnabled===true),mk("confirmed_groups",decisions.length),
 mk("weak_groups",decisions.filter(x=>x.successRate!<60).length),
 mk("confirmed_samples",decisions.reduce((n,x)=>n+x.confirmed,0)),
 mk("retention",null),mk("skill_transfer",null),mk("weight_training",false),
 mk("human_review_required",true)]},
 {name:"quality",checks:[
 mk("tracked_groups",5),mk("verified_evidence",matches.length>0),mk("risk_flag",risk),
 mk("warning_count",warnings.length),mk("sample_sufficiency",decisions.length>0),
 mk("answer_correctness",null),mk("before_after_gain",null),mk("no_actions_executed",true)]},
 ];
 return {version:"6.0",groups,stageCount:groups.reduce((n,g)=>n+g.checks.length,0), arithmetic,
  requiresApproval:risk,actionsExecuted:false as const,weightsChanged:false as const,
  advisoryOnly:true as const,
  note:"Проверки и счётчики не доказывают качество ответа; unknown требует независимых свидетельств."};
}
