import type { ToolObservation } from "./tool-failure-patterns";

/** Advisory assessment based on local metadata, not authorization or proof of root cause. */
export function toolReliabilityGuidance(history: ToolObservation[]) {
  const recent=history.slice(0,100);
  const grouped=new Map<string,ToolObservation[]>();
  for(const item of recent) {
    if(!item || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.tool) || !["ok","error","denied"].includes(item.status)) continue;
    grouped.set(item.tool,[...(grouped.get(item.tool)??[]),item]);
  }
  return [...grouped.entries()].map(([tool,records])=>{
    const sample=records.length;
    const errors=records.filter(x=>x.status==="error").length;
    const denied=records.filter(x=>x.status==="denied").length;
    const reliable=sample>=5 && errors===0 && denied===0;
    const caution=errors>=2 || (sample>=5 && errors/sample>=0.4);
    return {tool,sample,errors,denied,reliable,caution,
      guidance:caution?"В прошлых вызовах были повторные технические ошибки. Проверь предусловия перед следующим запуском.":
      denied>=2?"Ранее получены отказы. Не обходи разрешения, уточни допустимый способ выполнения.":
      "Недостаточно оснований для ограничения инструмента."};
  }).filter(x=>x.caution||x.denied>=2).sort((a,b)=>Number(b.caution)-Number(a.caution)||b.errors-a.errors||a.tool.localeCompare(b.tool)).slice(0,8);
}
