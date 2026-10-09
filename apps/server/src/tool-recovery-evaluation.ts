import type { ToolObservation } from "./tool-failure-patterns";

/** Read-only before/after heuristic. Order is newest-first, with no inferred causality. */
export function assessToolRecovery(history: ToolObservation[], windowSize = 3) {
 if (!Array.isArray(history) || history.length > 100 || !Number.isInteger(windowSize) || windowSize < 2 || windowSize > 20)
   throw Object.assign(new Error("Некорректная история восстановления"),{status:400});
 const names=[...new Set(history.filter(x=>x && /^[a-zA-Z0-9_-]{1,64}$/.test(x.tool)).map(x=>x.tool))];
 const plans=names.map(tool=>{
  const rows=history.filter(x=>x.tool===tool && ["ok","error","denied"].includes(x.status));
  const recent=rows.slice(0,windowSize);
  const previous=rows.slice(windowSize,windowSize*2);
  const failures=(arr:ToolObservation[])=>arr.filter(x=>x.status==="error").length;
  const denials=(arr:ToolObservation[])=>arr.filter(x=>x.status==="denied").length;
  const enough=recent.length===windowSize && previous.length===windowSize;
  const before=failures(previous),after=failures(recent);
  const trend=!enough?"insufficient":after<before?"improved":after>before?"worsened":"unchanged";
  const lastDenials=denials(recent);
  return {tool,windowSize,previousErrors:enough?before:null,recentErrors:enough?after:null,
   previousDenials:enough?denials(previous):null,recentDenials:enough?lastDenials:null,
   trend,plan:lastDenials>0?
    ["Проверить решение владельца и допустимые полномочия","Не повторять отклонённые действия без нового разрешения"]:
    trend==="worsened"?
    ["Проверить входные условия и доступность инструмента","Предложить владельцу диагностику перед повторной попыткой"]:
    trend==="improved"?
    ["Проверить воспроизводимость результата на новой безопасной задаче","Не считать снижение ошибок доказательством причинного исправления"]:
    ["Собрать дополнительные наблюдения без изменения разрешений","Уточнить причину ошибки до выполнения действий"]};
 }).filter(x=>x.trend!=="unchanged" || (x.recentDenials??0)>0);
 return {windowSize,tools:plans,requiresOwnerConfirmation:true as const,readOnly:true as const,
   note:"Сравнение двух последовательных окон наблюдений. Уменьшение числа ошибок не доказывает, что исправление помогло; никаких инструментов отчёт не вызывает."};
}
