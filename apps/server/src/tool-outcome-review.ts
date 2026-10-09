/** Read-only comparison. Only owner attestation may add an observed outcome to decision memory. */
export interface ToolOutcomeEvidence { tool:string; expected:string; actual:string; status:"ok"|"error"|"denied" }
const valid=(x:unknown,n:number):x is string=>typeof x==="string"&&x.trim().length>0&&x.length<=n;
export function reviewToolOutcome(v:ToolOutcomeEvidence){
 if(!v||!valid(v.tool,64)||!valid(v.expected,1000)||!valid(v.actual,8000)||
 !["ok","error","denied"].includes(v.status))
 throw Object.assign(new Error("Некорректный результат инструмента"),{status:400});
 const matches=v.status==="ok"&&v.actual.trim()===v.expected.trim();
 return {tool:v.tool,status:v.status,matchesExpectation:matches,
  discrepancy:matches?null:v.status==="denied"?"Выполнение отклонено":v.status==="error"?"Ошибка инструмента":"Фактический ответ отличается от ожидаемого",
  requiresOwnerConfirmation:true as const,
  note:"Строковое сопоставление не является независимой проверкой фактов. Результат не записывается в память без подтверждения."};
}
