import type { Risk } from "./tools";
export interface ActionReview { tool:string; risk:Risk; purpose:string; expectedEffect:string; rollback:string; validated:boolean }
/** Explicit, server-rechecked, single-invocation plan. Never counts as permission. */
export function checkActionReview(review:unknown,tool:string,args:Record<string,unknown>,risk:Risk) {
 if(risk!=="danger")return {required:false,valid:true,reason:"",requiresApproval:risk!=="read"};
 const r=review as Partial<ActionReview>|undefined;
 const valid=!!r&&r.tool===tool&&r.risk===risk&&r.validated===true&&
 [r.purpose,r.expectedEffect,r.rollback].every(x=>typeof x==="string"&&x.trim().length>=8&&x.length<=500);
 return {required:true,valid,reason:valid?"":"Для опасного действия требуется структурированный план с целью, эффектом и восстановлением",requiresApproval:true};
}
