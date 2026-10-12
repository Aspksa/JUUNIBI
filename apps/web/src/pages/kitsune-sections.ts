/** Лисье древо — одна страница: дерево в центре, слева панель. Здесь описано, что лежит в панели. */
export type TreeMode="map"|"atlas"|"architecture"|"development"|"connections"|"updates"|"architect"|"history"|"versions"|"impact"|"comparison"|"brain-chat"|"discovery"|"growth"|"fox";
export type Layer="structure"|"links"|"stages"|"impact";
export type FoxView="metrics"|"awards"|"branches";
export interface RailItem{id:string;label:string;hint:string;mode:TreeMode;layer?:Layer;foxView?:FoxView}
export interface RailGroup{id:string;label:string;items:RailItem[]}

export const RAIL:RailGroup[]=[
 {id:"tree",label:"Дерево",items:[
  {id:"atlas",label:"Атлас",hint:"Большая карта: модули, показатели, награды, код",mode:"atlas"},
  {id:"structure",label:"Структура",hint:"Модули проекта: ствол и ветви",mode:"map",layer:"structure"},
  {id:"links",label:"Связи",hint:"Что от чего зависит",mode:"map",layer:"links"},
  {id:"stages",label:"Этапы",hint:"Как проект рос по уровням",mode:"map",layer:"stages"},
  {id:"impact",label:"Что сломается, если…",hint:"Выберите ветвь: покажу всё зависимое",mode:"map",layer:"impact"},
  {id:"free",label:"Свободная карта",hint:"Узлы можно перетаскивать",mode:"architecture"},
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
export function activeItem(mode:TreeMode,layer:Layer,foxView:FoxView):RailItem|undefined{
 return RAIL_ITEMS.find(i=>i.mode===mode&&(i.layer?i.layer===layer:true)&&(i.foxView?i.foxView===foxView:true));
}
/** Режимы, где нужен поиск по ветвям, и режимы, где нужен масштаб. */
export const SEARCHABLE:ReadonlySet<TreeMode>=new Set(["architecture","updates","history","versions","discovery"]);
export const ZOOMABLE:ReadonlySet<TreeMode>=new Set(["architecture"]);
/** Режимы, показывающие картину дерева: поиск и список под ней не нужны. */
export const PICTURE_MODES:ReadonlySet<TreeMode>=new Set(["map"]);

export const LAYER_TEXT:Record<Layer,{title:string;lead:string}>={
 structure:{title:"Структура",lead:"Ствол — ядро проекта, ветви — модули. Заполненный лист подтверждён, пунктирный запланирован."},
 links:{title:"Связи",lead:"Рядом с каждой ветвью: сколько ветвей ей нужны (↑) и сколько зависят от неё (↓)."},
 stages:{title:"Этапы",lead:"Горизонтальные полосы — этапы развития: чем выше, тем позже появилась ветвь."},
 impact:{title:"Что сломается, если…",lead:"Нажмите на ветвь: всё, что от неё зависит, подсветится, а цифра покажет, через сколько шагов."},
};
