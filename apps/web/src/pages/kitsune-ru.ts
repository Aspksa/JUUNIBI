import type {EvolutionNode} from "./kitsune-evolution-model";

/** Русские названия ветвей. Манифест и старые снимки хранят английские названия, поэтому перевод — на показе. */
const TITLES:Record<string,string>={
 core:"Ядро JUUNIBI",brain:"Мозг 2.0",memory:"Графовая память",search:"Гибридный поиск",strategy:"Лаборатория стратегий",
 benchmark:"Проверка Мозга",tasks:"Дела и достижения",disk:"Диск",agent:"Агент",kitsune:"Лисье древо",evolution3:"Мозг 3.0",
};
export const ruTitle=(id:string,fallback:string):string=>TITLES[id]??fallback;
export const withRuTitle=<T extends Pick<EvolutionNode,"id"|"title">>(n:T):T=>({...n,title:ruTitle(n.id,n.title)});
export const STATUS_RU={implemented:"Подтверждено",planned:"Запланировано"} as const;
export const statusRu=(s:string):string=>(STATUS_RU as Record<string,string>)[s]??s;

/** Короткая русская дата: «12 окт.». */
export function dateRu(iso:string):string{
 const t=Date.parse(iso);
 if(!Number.isFinite(t))return "";
 return new Date(t).toLocaleDateString("ru-RU",{day:"numeric",month:"short"});
}
/** Код версии для людей: первые 7 знаков. */
export const shortVersion=(v:string):string=>/^[0-9a-f]{40}$/.test(v)?v.slice(0,7):v.slice(0,12);
