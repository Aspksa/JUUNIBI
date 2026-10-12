import type {EvolutionNode,EvolutionSnapshot} from "./kitsune-evolution-model";
import type {GrowthEvent} from "./kitsune-growth";
export const FOX_WORLDS=[
 {emoji:"🌳",title:"Волшебный лес",names:["Деревья-великаны","Веточки-непоседы","Шуршащие листочки","Малыши-росточки","Цветущие сакуры","Сонные пеньки","Листопад перемен","Крепкие корешки","Зелёные поляны","Лесные новосёлы"]},
 {emoji:"🦊",title:"Проделки лисичек",names:["Лисички-трудяги","Хитрые хвостики","Ушки на макушке","Лисьи следы","Пушистые победы","Хвостики трубой","Лисьи секретики","Прыг-скок","Любопытные носики","Лисий совет"]},
 {emoji:"🧠",title:"Магия мозга",names:["Искорки гениальности","Светлячки идей","Нейронные паутинки","Кристаллики памяти","Мыслительные вихри","Мудрые совушки","Волшебные пазлы","Звёздные гипотезы","Умные грибочки","Фонарики разума"]},
 {emoji:"🎉",title:"Праздники и радости",names:["Золотые шишки","Конфетти побед","Тортики успеха","Воздушные шарики","Радужные дорожки","Салюты леса","Медальки лисичек","Подарочные коробочки","Блестящие короны","Праздничные колокольчики"]},
 {emoji:"🚀",title:"Обновления и приключения",names:["Ракеты в будущее","Посылки с чудесами","Волшебные молнии","Машина времени","Часы путешественника","Шлемы исследователей","Лисьи мастерские","Порталы версий","Запасные парашюты","Медали обновлений"]},
 {emoji:"🤭",title:"Смешные происшествия",names:["Ой, лапки!","Хвост запутался","Куда делась ветка?","Лисичка задумалась","Гриб убежал","Потерянный носочек","Чихнул сервер","Упс, промах!","Застряли в кустах","Опять хвост!"]},
 {emoji:"🛡️",title:"Защитники леса",names:["Щиты-хранители","Лесные дозорные","Запертые сундуки","Лечебные листики","Волшебные пластыри","Осторожные ёжики","Сигнальные костры","Крепости корней","Чистые тропинки","Зонтики от багов"]},
 {emoji:"🐾",title:"Лесные жители",names:["Пчёлки-мастера","Бабочки-новаторы","Белочки-запасливые","Совушки-аналитики","Ёжики-проверяльщики","Зайчики-спринтеры","Светлячки-наблюдатели","Муравьи-строители","Енотики-уборщики","Птички-почтальоны"]},
 {emoji:"🌌",title:"Космос эволюции",names:["Созвездия систем","Млечные дорожки","Планеты-модули","Звёздные мосты","Кометы изменений","Галактики проектов","Космические ростки","Орбиты задач","Метеоры открытий","Сверхновые версии"]},
 {emoji:"🏡",title:"Домик JUUNIBI",names:["Тёплые объятия","Радостные ушки","Танцующие хвостики","Чашечки чая","Подушки отдыха","Домашние искорки","Плюшевые сердечки","Уютные вечера","Сундучки воспоминаний","Добрые пожелания"]},
] as const;
export interface FoxMetric {id:string;name:string;world:number;emoji:string;value:number|null;source:string;description:string;target:"architecture"|"discovery"|"growth"|"history"|"updates"}
export interface FoxData {nodes:EvolutionNode[];snapshot:EvolutionSnapshot|null;growth:GrowthEvent[]}
export function foxMetrics(data:FoxData):FoxMetric[]{
 const {nodes,snapshot,growth}=data,discovery=snapshot?.discovery,timeline=snapshot?.timeline;
 const values=new Map<number,[number|null,string,string,FoxMetric["target"]]>();
 const put=(id:number,value:number|null,source:string,description:string,target:FoxMetric["target"])=>values.set(id,[value,source,description,target]);
 const manifestReady=Boolean(snapshot);
 const implemented=nodes.filter(n=>n.status==="implemented");
 const planned=nodes.filter(n=>n.status==="planned");
 const edges=nodes.reduce((v,n)=>v+n.dependsOn.length,0);
 const roots=nodes.filter(n=>n.dependsOn.length===0);
 const updates=timeline?.history.filter(h=>h.kind==="install")??[];
 const rollbacks=timeline?.history.filter(h=>h.kind==="rollback")??[];
 const snapshots=timeline?.snapshots??[];
 // Only calculate metrics backed by evidence. Missing feeds are explicitly unknown.
 put(0,manifestReady?roots.length:null,"Манифест архитектуры","Корневые системы без зависимостей","architecture");
 put(1,manifestReady?nodes.length:null,"Манифест архитектуры","Все ветви, зарегистрированные в дереве","architecture");
 put(2,manifestReady?implemented.length:null,"Манифест архитектуры","Реализованные ветви, а не количество функций","architecture");
 put(3,discovery?.candidates.length??null,"Сканер исходников","Неподтверждённые кандидаты на новые ветви","discovery");
 put(4,timeline?growth.filter(x=>x.kind==="new").length:null,"История изменений","Ветви, появившиеся между двумя снимками","growth");
 put(5,manifestReady?planned.length:null,"Манифест архитектуры","Ветви, которые пока только запланированы","architecture");
 put(6,timeline?growth.filter(x=>x.kind==="removed").length:null,"История изменений","Ветви, исчезнувшие из нового снимка","growth");
 put(7,manifestReady?edges:null,"Манифест архитектуры","Количество направленных зависимостей","architecture");
 put(9,timeline?growth.filter(x=>x.kind==="new").length:null,"История изменений","Подтверждённые новые компоненты","growth");
 put(18,discovery?.candidates.length??null,"Сканер исходников","Обнаруженные новые файлы-кандидаты","discovery");
 put(22,manifestReady?edges:null,"Манифест архитектуры","Связи между модулями по манифесту","architecture");
 put(31,timeline?growth.filter(x=>x.kind==="new").length:null,"История изменений","Подтверждённые новые ветви","growth");
 put(34,timeline?rollbacks.length:null,"Журнал обновлений","Записанные восстановления предыдущей версии","history");
 put(35,timeline?updates.length:null,"Журнал обновлений","Зарегистрированные установленные версии","history");
 put(40,timeline?updates.length:null,"Журнал обновлений","Подтверждённые установки обновлений","updates");
 put(43,timeline?snapshots.length:null,"История SQLite","Сохранённые снимки архитектуры","history");
 put(47,timeline?snapshots.length:null,"История SQLite","Снимки версий для сравнения","history");
 put(51,discovery?.cycles.length??null,"Сканер исходников","Циклические зависимости найденных файлов","discovery");
 put(52,discovery?.unresolved.length??null,"Сканер исходников","Не найденные при сканировании импорты","discovery");
 put(83,manifestReady?edges:null,"Манифест архитектуры","Межмодульные связи по дереву","architecture");
 put(86,discovery?.candidates.length??null,"Сканер исходников","Кандидаты на будущие возможности","discovery");
 put(88,discovery?.candidates.length??null,"Сканер исходников","Обнаруженные архитектурные кандидаты","discovery");
 return FOX_WORLDS.flatMap((w,i)=>w.names.map((name,j)=>{
  const index=i*10+j;
  const known=values.get(index);
  return {id:"fox-"+index,name,world:i,emoji:w.emoji,
   value:known?known[0]:null,
   source:known?known[1]:"Источник ещё не подключён",
   description:known?known[2]:"Показатель появится, когда JUUNIBI предоставит подтверждённые данные.",
   target:known?known[3]:"architecture"} as FoxMetric;
 }));
}
