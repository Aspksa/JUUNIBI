/** Лисье древо — одна страница: дерево в центре, слева панель. Здесь описано, что лежит в панели. */
export type TreeMode="mindmap"|"updates"|"architect"|"history"|"versions"|"comparison"|"brain-chat"|"discovery"|"growth"|"fox";
export type Layer="structure"|"links"|"stages"|"impact";
export type FoxView="metrics"|"awards"|"branches";
export interface RailItem{id:string;label:string;hint:string;mode:TreeMode;foxView?:FoxView}
export interface RailGroup{id:string;label:string;items:RailItem[]}

export const RAIL:RailGroup[]=[
 {id:"tree",label:"Карта",items:[
  {id:"mindmap",label:"Карта-схема",hint:"Ветви раскрываются кликом: модули, связи, этапы, показатели, награды, код",mode:"mindmap"},
 ]},
 {id:"forest",label:"Лес",items:[
  {id:"metrics",label:"Показатели",hint:"100 показателей в 10 мирах",mode:"fox",foxView:"metrics"},
  {id:"awards",label:"Награды",hint:"Полка медалей",mode:"fox",foxView:"awards"},
  {id:"branches",label:"Ветки проекта",hint:"Обновления, правки, ошибки, продолжение",mode:"fox",foxView:"branches"},
 ]},
 {id:"history",label:"Ход развития",items:[
  {id:"updates",label:"Обновления",hint:"Установленные и доступные версии",mode:"updates"},
  {id:"history",label:"Хронология",hint:"Установки и откаты",mode:"history"},
  {id:"versions",label:"Происхождение",hint:"Откуда взялась каждая возможность",mode:"versions"},
  {id:"comparison",label:"Сравнение версий",hint:"Что изменилось между снимками",mode:"comparison"},
  {id:"growth",label:"Рост",hint:"Новые ветви между версиями",mode:"growth"},
 ]},
 {id:"analysis",label:"Анализ",items:[
  {id:"discovery",label:"Обнаружение",hint:"Файлы, ещё не описанные в карте",mode:"discovery"},
  {id:"architect",label:"Архитектор",hint:"Что можно развивать дальше",mode:"architect"},
  {id:"brain-chat",label:"Диалог с Мозгом",hint:"Вопрос по выбранной ветви",mode:"brain-chat"},
 ]},
];
export const RAIL_ITEMS:RailItem[]=RAIL.flatMap(g=>g.items);

/** Какой пункт панели сейчас открыт. */
export function activeItem(mode:TreeMode,foxView:FoxView):RailItem|undefined{
 return RAIL_ITEMS.find(i=>i.mode===mode&&(i.foxView?i.foxView===foxView:true));
}
/** Режимы, где нужен поиск по ветвям. */
export const SEARCHABLE:ReadonlySet<TreeMode>=new Set(["updates","history","versions","discovery"]);

export const LAYER_TEXT:Record<Layer,{title:string;lead:string}>={
 structure:{title:"Структура",lead:"Корень — ядро проекта, ветви — модули, показатели, награды и код. Нажмите на ветвь, чтобы раскрыть её."},
 links:{title:"Связи",lead:"Пунктир — зависимости между модулями; под модулем: сколько ветвей ему нужны (↑) и сколько зависят от него (↓)."},
 stages:{title:"Этапы",lead:"Число у модуля — этап развития: чем больше число, тем позже появилась ветвь."},
 impact:{title:"Что сломается, если…",lead:"Нажмите на модуль: всё, что от него зависит, подсветится, а цифра покажет, через сколько шагов."},
};
