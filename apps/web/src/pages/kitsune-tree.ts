import { el } from "../dom";
import { pageHead } from "./kit";
import { api } from "../api";
import { evolutionFromUpdater, evolutionStateLabel, type EvolutionRelease } from "./kitsune-updates";

export type TreeMode = "architecture" | "development" | "connections" | "updates";
export interface TreeNode {
 id:string; title:string; description:string; how:string; status:"implemented"|"planned";
 dependsOn:string[]; evidence?:string; stage:number;
}
export const TREE_NODES:TreeNode[]=[
 {id:"core",title:"JUUNIBI Core",description:"Основа приложения и координация модулей.",
 how:"Запускает приложение и соединяет интерфейс с системными службами.",status:"implemented",dependsOn:[],stage:0},
 {id:"brain",title:"Brain Evolution 2.0",description:"Интеллект, работа с опытом и проверочные сценарии.",
 how:"Анализирует план, сопоставляет подтверждённые решения, проверяет риск и готовит рекомендацию.",status:"implemented",dependsOn:["core"],stage:1,evidence:"https://github.com/Aspksa/JUUNIBI/pull/269"},
 {id:"memory",title:"Graph Memory",description:"Долговременная память SQLite и связи решений.",
 how:"Сохраняет подтверждённые исходы, индексирует смысловые векторы и предоставляет графовые связи.",status:"implemented",dependsOn:["brain"],stage:2,evidence:"https://github.com/Aspksa/JUUNIBI/pull/265"},
 {id:"search",title:"Hybrid Search",description:"Совместный лексический и векторный поиск.",
 how:"Объединяет совпадения слов и embeddings; при недоступности провайдера использует лексический поиск.",status:"implemented",dependsOn:["memory"],stage:3,evidence:"https://github.com/Aspksa/JUUNIBI/pull/269"},
 {id:"strategy",title:"Strategy Lab",description:"Безопасное сравнение и калибровка стратегий.",
 how:"Проверяет успехи, неудачи, зависимости и риск; не выполняет действия без разрешения.",status:"implemented",dependsOn:["brain","memory"],stage:3,evidence:"https://github.com/Aspksa/JUUNIBI/pull/268"},
 {id:"benchmark",title:"Brain Benchmark",description:"Детерминированные сценарии контроля качества.",
 how:"Проверяет ранжирование стратегий и показатели поиска на фиксированных примерах.",status:"implemented",dependsOn:["search","strategy"],stage:4,evidence:"https://github.com/Aspksa/JUUNIBI/pull/269"},
 {id:"tasks",title:"Дела и достижения",description:"Планирование задач и отслеживание прогресса.",
 how:"Показывает дела, цели, события и достижения пользователя.",status:"implemented",dependsOn:["core"],stage:1},
 {id:"disk",title:"Диск",description:"Файловое пространство JUUNIBI.",
 how:"Позволяет работать с файлами в интерфейсе приложения.",status:"implemented",dependsOn:["core"],stage:1},
 {id:"agent",title:"Agent",description:"Контролируемые действия помощницы.",
 how:"Перед выполнением чувствительных операций требуется явное подтверждение.",status:"implemented",dependsOn:["brain"],stage:2},
 {id:"evolution3",title:"Brain Evolution 3.0",description:"Полная индексация памяти и независимые проверки обучения.",
 how:"Запланированное расширение; нельзя считать уже реализованной возможностью.",status:"planned",dependsOn:["benchmark","memory"],stage:5}
];
export const treeConnections=()=>TREE_NODES.flatMap(node=>node.dependsOn.map(from=>({from,to:node.id})));
export function kitsuneTreePage():HTMLElement {
 let mode:TreeMode="architecture",selected="brain",filter="";
 let releases:EvolutionRelease[]=[];
 let updatesLoading=true;
 const body=el("div",{cls:"kt-layout"});
 const status=el("p",{cls:"muted",attrs:{"aria-live":"polite"}});
 const root=el("div",{cls:"page kitsune-tree"},pageHead("link","Лисье древо","KITSUNE TREE · Живая карта архитектуры и развития JUUNIBI"),
   el("p",{cls:"muted",textContent:"Карта основана на известных компонентах проекта и подтверждённых PR. Будущие возможности отмечены отдельно. Установленные версии берутся из Центра обновлений; связи новых релизов с ветвями определяются предположительно по описанию."}),status,body);
 const query=el("input",{cls:"kt-search",attrs:{type:"search",placeholder:"Найти ветвь…","aria-label":"Поиск ветви"}});
 query.addEventListener("input",()=>{filter=query.value.toLocaleLowerCase("ru");render();});
 const controls=el("div",{cls:"kt-controls"},query);
 root.insertBefore(controls,body);
 const tabs=el("div",{cls:"kt-tabs"});
 controls.prepend(tabs);
 function render(){
   tabs.replaceChildren(...([["architecture","Архитектура"],["development","Развитие"],["connections","Связи"],["updates","Обновления"]] as [TreeMode,string][]).map(([value,label])=>{
     const b=el("button",{cls:mode===value?"kt-active":"",textContent:label,attrs:{"aria-pressed":String(mode===value)}});
     b.addEventListener("click",()=>{mode=value;render();});return b;
   }));
   if(mode==="updates"){
     status.textContent=updatesLoading?"Загружаю историю Центра обновлений…":
       "История установок и текущая версия из Центра обновлений";
     const timeline=el("div",{cls:"kt-graph"});
     if(!releases.length)timeline.append(el("p",{cls:"muted",textContent:updatesLoading?"Загрузка…":"Установок в истории пока нет. Откройте Центр обновлений для проверки версии."}));
     for(const release of releases.filter(x=>(x.title+" "+x.description+" "+x.version).toLocaleLowerCase("ru").includes(filter))){
       const card=el("article",{cls:"kt-node"},
         el("strong",{textContent:release.title}),
         el("small",{textContent:evolutionStateLabel[release.state]+" · "+release.version}),
         el("p",{textContent:release.description}),
         el("small",{textContent:release.relatedBranches.length?
           "Предполагаемые ветви: "+release.relatedBranches.join(", "):"Ветви не определены"}));
       if(release.evidence)card.append(el("a",{textContent:"Изменение в GitHub ↗",attrs:{href:release.evidence,target:"_blank",rel:"noopener noreferrer"}}));
       timeline.append(card);
     }
     const side=el("aside",{cls:"kt-detail"},el("h2",{textContent:"Центр обновлений"}),
       el("p",{textContent:"Скачивание само по себе не активирует ветку. Статус «Установлено» появляется только после записи об установке; откат сохраняется в истории."}));
     const link=el("a",{textContent:"Открыть Центр обновлений →",attrs:{href:"#update"}});
     side.append(link);body.replaceChildren(timeline,side);return;
   }
   const matched=TREE_NODES.filter(n=>(n.title+" "+n.description).toLocaleLowerCase("ru").includes(filter));
   status.textContent=`${TREE_NODES.filter(n=>n.status==="implemented").length} реализовано · ${TREE_NODES.filter(n=>n.status==="planned").length} запланировано · ${treeConnections().length} связей`;
   const graph=el("div",{cls:"kt-graph",attrs:{"aria-label":"Ветви эволюции"}});
   const nodes=mode==="development"?[...matched].sort((a,b)=>a.stage-b.stage):matched;
   for(const node of nodes){
     const card=el("button",{cls:"kt-node "+(node.id===selected?"kt-selected ":"")+(node.status==="planned"?"kt-future":""),
       attrs:{"aria-pressed":String(node.id===selected)},
       title:node.description},el("span",{cls:"kt-node-title",textContent:node.title}),
       el("small",{textContent:node.status==="planned"?"Запланировано":`Уровень ${node.stage} · реализовано`}));
     card.addEventListener("click",()=>{selected=node.id;render();});
     graph.append(card);
   }
   const current=TREE_NODES.find(n=>n.id===selected)??TREE_NODES[0]!;
   const parents=current.dependsOn.map(id=>TREE_NODES.find(n=>n.id===id)?.title??id);
   const children=TREE_NODES.filter(n=>n.dependsOn.includes(current.id)).map(n=>n.title);
   const details=el("aside",{cls:"kt-detail"},
      el("h2",{textContent:current.title}),
      el("p",{textContent:current.description}),
      el("h3",{textContent:"Как работает"}),el("p",{textContent:current.how}),
      el("h3",{textContent:"Зависит от"}),el("p",{textContent:parents.join(" · ")||"Корневой компонент"}),
      el("h3",{textContent:"Связанные ветви"}),el("p",{textContent:children.join(" · ")||"Пока нет"}),
      el("p",{cls:"kt-state",textContent:current.status==="implemented"?"Подтверждено в проекте":"План развития, не реализовано"}));
   if(current.evidence){const link=el("a",{textContent:"Открыть подтверждающий PR ↗",attrs:{href:current.evidence,target:"_blank",rel:"noopener noreferrer"}});details.append(link);}
   if(mode==="connections"){
     const list=el("div",{cls:"kt-edges"});
     for(const edge of treeConnections().filter(e=>e.from===selected||e.to===selected)){
       const n=TREE_NODES.find(x=>x.id===(edge.from===selected?edge.to:edge.from));
       if(!n)continue;
       const button=el("button",{textContent:`${edge.from===selected?"Зависит от этой ветви":"Зависимость"} → ${n.title}`});
       button.addEventListener("click",()=>{selected=n.id;render();});list.append(button);
     }
     details.append(el("h3",{textContent:"Переходы по связям"}),list);
   }
   body.replaceChildren(graph,details);
 }
 void Promise.all([api.updateStatus(),api.updateHistory()]).then(([st,h])=>{
   releases=evolutionFromUpdater(st.ok?st.value:null,h.ok?h.value:null);
   updatesLoading=false;
   render();
 }).catch(()=>{updatesLoading=false;render();});
 render();return root;
}
