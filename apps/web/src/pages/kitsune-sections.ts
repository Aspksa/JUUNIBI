/** 13 tabs in one row were hard to scan: the modes are grouped into four sections with a few sub-views each. */
export type TreeMode="map"|"architecture"|"development"|"connections"|"updates"|"architect"|"history"|"versions"|"impact"|"comparison"|"brain-chat"|"discovery"|"growth"|"fox";
export type SectionId="map"|"history"|"analysis"|"fox";
export interface Section{id:SectionId;label:string;hint:string;modes:[TreeMode,string][]}
export const SECTIONS:Section[]=[
 {id:"map",label:"Карта",hint:"Как устроен JUUNIBI",modes:[["map","Дерево"],["architecture","Граф"],["connections","Связи"],["development","Этапы"]]},
 {id:"history",label:"История",hint:"Что и когда менялось",modes:[["updates","Обновления"],["history","Хронология"],["versions","Происхождение"],["comparison","Сравнение"],["growth","Рост"]]},
 {id:"analysis",label:"Анализ",hint:"Что от чего зависит",modes:[["impact","Влияние"],["discovery","Обнаружение"],["architect","Архитектор"],["brain-chat","Диалог с Brain"]]},
 {id:"fox",label:"Лисичка",hint:"Показатели и награды",modes:[["fox","Лисий переполох"]]},
];
export function sectionOf(mode:TreeMode):Section{
 return SECTIONS.find(s=>s.modes.some(([m])=>m===mode))??SECTIONS[0]!;
}
/** Modes that use the branch search box and the zoom buttons. */
export const SEARCHABLE:ReadonlySet<TreeMode>=new Set(["architecture","connections","development","updates","history","versions","discovery"]);
export const ZOOMABLE:ReadonlySet<TreeMode>=new Set(["architecture","connections","development"]);

export type FoxView="today"|"metrics"|"awards"|"branches";
export const FOX_VIEWS:[FoxView,string][]=[["today","Сегодня"],["metrics","Показатели"],["awards","Награды"],["branches","Ветки"]];

/** Short Russian sentence about the tree for the summary strip. */
export function treeSummary(nodes:{status:string;dependsOn:string[]}[],events:number):{label:string;value:number}[]{
 return [
  {label:"подтверждено",value:nodes.filter(n=>n.status==="implemented").length},
  {label:"запланировано",value:nodes.filter(n=>n.status==="planned").length},
  {label:"связей",value:nodes.reduce((n,x)=>n+x.dependsOn.length,0)},
  {label:"новых событий",value:events},
 ];
}
