import type { RecoveryTrial } from "./recovery-trials";

/** Read-only comparison of owner-attested diagnostic trials, never an execution authorization. */
export function rankRecoveryStrategies(trials: RecoveryTrial[], tool: string) {
 if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tool)) throw Object.assign(new Error("Некорректный инструмент"),{status:400});
 const completed=trials.filter(t=>t.tool===tool&&t.status==="completed");
 const groups=new Map<string,RecoveryTrial[]>();
 for(const t of completed) groups.set(t.strategy,[...(groups.get(t.strategy)??[]),t]);
 const candidates=[...groups.entries()].map(([strategy,items])=>{
  const before=items.reduce((n,t)=>n+t.baseline.error,0),after=items.reduce((n,t)=>n+t.after.error,0);
  const denials=items.reduce((n,t)=>n+t.after.denied,0);
  const trialsCount=items.length;
  return {strategy,trials:trialsCount,errorsBefore:before,errorsAfter:after,denialsAfter:denials,
   reduction:before-after,confidence:trialsCount>=3?"preliminary":"insufficient",
   eligible:trialsCount>=3&&before>after&&denials===0};
 }).sort((a,b)=>Number(b.eligible)-Number(a.eligible)||b.reduction-a.reduction||b.trials-a.trials||a.strategy.localeCompare(b.strategy));
 const recommended=candidates.find(c=>c.eligible)?.strategy??null;
 return {tool,recommended,candidates,requiresOwnerConfirmation:true as const,advisoryOnly:true as const,
  note:"Рейтинг описывает корреляцию по трём наблюдениям в каждом опыте. Даже несколько успешных опытов не доказывают причину улучшения. Никаких действий не выполняется."};
}
