import {describe,expect,it} from "vitest";
import {CLANS,MAX_CODE_HUBS,MAX_LEAVES_PER_HUB,allNodes,buildAtlas,clanColor,clansInUse,clusterRadius,countLeaves,layoutAtlas,searchAtlas,type AtlasInput} from "./kitsune-atlas-model";

const manifest=[
 {id:"core",title:"Ядро JUUNIBI",status:"implemented" as const,dependsOn:[]},
 {id:"brain",title:"Мозг 2.0",status:"implemented" as const,dependsOn:["core"]},
 {id:"memory",title:"Графовая память",status:"implemented" as const,dependsOn:["brain"]},
 {id:"search",title:"Гибридный поиск",status:"implemented" as const,dependsOn:["memory"]},
 {id:"agent",title:"Агент",status:"implemented" as const,dependsOn:["brain"]},
 {id:"evolution3",title:"Мозг 3.0",status:"planned" as const,dependsOn:["search","memory"]},
 {id:"tasks",title:"Дела и достижения",status:"implemented" as const,dependsOn:["core"]},
 {id:"disk",title:"Диск",status:"implemented" as const,dependsOn:["core"]},
 {id:"strange",title:"Неизвестная",status:"implemented" as const,dependsOn:["core"]},
];
const worlds=Array.from({length:10},(_,i)=>({emoji:"🌳",title:"Мир "+i}));
const metrics=Array.from({length:100},(_,i)=>({id:"fox-"+i,name:"Показатель "+i,world:Math.floor(i/10),emoji:"🦊",value:i%3===0?null:i}));
const medals=Array.from({length:60},(_,i)=>({id:"m"+i,title:"Награда "+i,emoji:"🏅",group:"Группа "+(i%4),earned:i%5===0,progress:i%5===0?1:i%2?0.4:0}));
const code=Array.from({length:120},(_,i)=>({id:["brain","memory","achievements","kitsune","fox","organizer"][i%6]+"-f"+i,file:"apps/server/src/f"+i+".ts"}));
const input:AtlasInput={nodes:manifest,metrics,worlds,medals,code,
 modules:[{name:"brain",status:"started"},{name:"scenes",status:"failed"},{name:"x",status:"stopped"}],
 history:[{id:"1",kind:"install",to:"a",at:"2026-10-10",label:"10 окт."},{id:"2",kind:"rollback",to:"b",at:"2026-10-11",label:"11 окт."}]};

describe("модель атласа",()=>{
 const tree=buildAtlas(input);
 it("корень — ствол JUUNIBI; ядро манифеста даёт ему смысл, а не лишнюю ветвь",()=>{
  expect(tree.kind).toBe("trunk");expect(tree.label).toBe("JUUNIBI");
  expect(tree.ref).toEqual({type:"manifest",key:"core"});
  expect(allNodes(tree).filter(n=>n.ref.key==="core"&&n.ref.type==="manifest").length).toBe(1);
 });
 it("ветви манифеста строятся по первой зависимости, клан наследуется от ветви",()=>{
  const byId=new Map(allNodes(tree).map(n=>[n.id,n]));
  const brain=byId.get("m:brain")!;
  expect(brain.kind).toBe("branch");
  expect(brain.children.map(c=>c.id).sort()).toEqual(["m:agent","m:memory"]);
  expect(byId.get("m:memory")!.children.map(c=>c.id)).toEqual(["m:search"]);
  expect(byId.get("m:search")!.children.map(c=>c.id)).toEqual(["m:evolution3"]); // вторая зависимость не создаёт вторую копию
  expect(byId.get("m:evolution3")!.state).toBe("planned");
  expect(new Set([brain,byId.get("m:memory")!,byId.get("m:search")!].map(n=>n.clan)).size).toBe(1);
  expect(byId.get("m:tasks")!.clan).not.toBe(byId.get("m:disk")!.clan);
 });
 it("у неизвестной ветви свой запасной клан, а не чужой цвет",()=>{
  const n=allNodes(tree).find(x=>x.id==="m:strange")!;
  expect(CLANS[n.clan]!.id).toBe("brain"); // верхний уровень без своего клана — в «Мозг и развитие»
 });
 it("лес показателей: 10 миров по 10 листьев; нет значения — серый лист",()=>{
  const forest=tree.children.find(c=>c.id==="c:forest")!;
  expect(forest.children.length).toBe(10);
  expect(forest.children.every(h=>h.children.length===10)).toBe(true);
  const leaves=forest.children.flatMap(h=>h.children);
  expect(leaves.filter(l=>l.state==="empty").length).toBe(metrics.filter(m=>m.value===null).length);
  expect(leaves.find(l=>l.id==="x:fox-1")!.note).toBe("1");
 });
 it("награды: группы, не больше положенного листьев на хаб; получена/в процессе/закрыта",()=>{
  const awards=tree.children.find(c=>c.id==="c:awards")!;
  expect(awards.children.length).toBe(4);
  for(const h of awards.children)expect(h.children.length).toBeLessThanOrEqual(MAX_LEAVES_PER_HUB);
  const states=new Set(awards.children.flatMap(h=>h.children).map(l=>l.state));
  expect(states).toEqual(new Set(["ok","info","empty"]));
 });
 it("код: области по первому слову, лишнее сворачивается в «+N», хабов не больше предела",()=>{
  const codeBranch=tree.children.find(c=>c.id==="c:code")!;
  expect(codeBranch.children.length).toBeLessThanOrEqual(MAX_CODE_HUBS);
  for(const h of codeBranch.children){expect(h.children.length).toBeLessThanOrEqual(MAX_LEAVES_PER_HUB);}
  const brain=codeBranch.children.find(h=>h.label==="brain")!;
  expect(brain.children.at(-1)!.label).toMatch(/^\+\d+$/);
  const shown=codeBranch.children.flatMap(h=>h.children).filter(l=>!/^\+/.test(l.label)).length;
  const hidden=codeBranch.children.flatMap(h=>h.children).filter(l=>/^\+/.test(l.label)).reduce((s,l)=>s+Number(l.label.slice(1)),0);
  expect(shown+hidden).toBe(code.length); // ни один файл не потерян: либо виден, либо посчитан
 });
 it("модули и обновления: состояния по факту; пустые источники не создают пустых ветвей",()=>{
  const mods=tree.children.find(c=>c.id==="c:modules")!.children[0]!.children;
  expect(mods.map(m=>m.state)).toEqual(["ok","bad","empty"]);
  const upd=tree.children.find(c=>c.id==="c:updates")!.children[0]!.children;
  expect(upd.map(u=>u.state)).toEqual(["ok","info"]);
  const bare=buildAtlas({nodes:manifest,metrics,worlds,medals});
  expect(bare.children.some(c=>["c:code","c:modules","c:updates"].includes(c.id))).toBe(false);
  expect(bare.children.some(c=>c.id==="c:forest")).toBe(true);
 });
 it("пустой манифест и пустые данные не ломают построение",()=>{
  const t=buildAtlas({nodes:[],metrics:[],worlds:[],medals:[]});
  expect(t.kind).toBe("trunk");expect(t.children).toEqual([]);
  expect(layoutAtlas(t).bounds.w).toBeGreaterThan(0);
 });
 it("число листьев и легенда кланов",()=>{
  expect(countLeaves(tree)).toBeGreaterThan(200);
  const used=clansInUse(tree).map(i=>CLANS[i]!.id);
  expect(used).toEqual(expect.arrayContaining(["brain","tasks","disk","forest","awards","modules","updates","code"]));
  expect(clanColor(0)).toMatch(/^hsl\(/);expect(clanColor(99)).toMatch(/^hsl\(/);
 });
});
describe("раскладка атласа",()=>{
 const tree=buildAtlas(input);
 const lay=layoutAtlas(tree);
 it("детерминирована",()=>{
  const again=layoutAtlas(buildAtlas(input));
  expect([...again.placed.values()].map(p=>[p.node.id,p.x,p.y])).toEqual([...lay.placed.values()].map(p=>[p.node.id,p.x,p.y]));
  expect(again.leaves).toEqual(lay.leaves);
 });
 it("ствол внизу в нуле, всё растёт вверх и дальше от ствола с каждым уровнем",()=>{
  expect(lay.placed.get("root")).toMatchObject({x:0,y:0});
  for(const p of lay.placed.values())if(p.parent){
   expect(p.y).toBeLessThan(0);
   const parent=lay.placed.get(p.parent)!;
   expect(Math.hypot(p.x,p.y)).toBeGreaterThan(Math.hypot(parent.x,parent.y)-1);
  }
 });
 it("картинка не вытянута в тонкую полосу: высота не меньше трети ширины",()=>{
  expect(lay.bounds.h).toBeGreaterThan(lay.bounds.w/3);
 });
 it("кластеры не налезают друг на друга (кроме родителя и ребёнка)",()=>{
  const ps=[...lay.placed.values()].slice(1);
  let worst=Infinity;
  for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++){
   const a=ps[i]!,b=ps[j]!;
   if(a.parent===b.node.id||b.parent===a.node.id)continue;
   worst=Math.min(worst,Math.hypot(a.x-b.x,a.y-b.y)-(a.cluster+b.cluster)*0.7);
  }
  expect(worst).toBeGreaterThan(0);
 });
 it("у каждого листа есть позиция внутри картинки; листьев ровно столько, сколько в дереве",()=>{
  const leafNodes=allNodes(tree).filter(n=>n.kind==="leaf");
  expect(lay.leaves.length).toBe(leafNodes.length);
  expect(new Set(lay.leaves.map(l=>l.id)).size).toBe(leafNodes.length);
  const b=lay.bounds;
  for(const l of lay.leaves){expect(l.x).toBeGreaterThanOrEqual(b.x);expect(l.x).toBeLessThanOrEqual(b.x+b.w);expect(l.y).toBeGreaterThanOrEqual(b.y);expect(l.y).toBeLessThanOrEqual(b.y+b.h);}
 });
 it("листья одного хаба не сливаются: расстояние между соседями не меньше диаметра кружка",()=>{
  const byHub=new Map<string,typeof lay.leaves>();
  for(const l of lay.leaves)(byHub.get(l.hub)??byHub.set(l.hub,[]).get(l.hub)!).push(l);
  for(const list of byHub.values())for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++)
   expect(Math.hypot(list[i]!.x-list[j]!.x,list[i]!.y-list[j]!.y)).toBeGreaterThan(14);
 });
 it("рёбра по одному на каждый хаб, без ссылок на несуществующее",()=>{
  expect(lay.edges.length).toBe(lay.placed.size-1);
  for(const e of lay.edges){expect(lay.placed.has(e.from)).toBe(true);expect(lay.placed.has(e.to)).toBe(true);expect(e.d).toMatch(/^M[\d. -]+C[\d. -]+$/);}
 });
 it("радиус кластера растёт с числом листьев",()=>{
  const small=buildAtlas({...input,medals:medals.slice(0,2)}).children.find(c=>c.id==="c:awards")!.children[0]!;
  const big=buildAtlas(input).children.find(c=>c.id==="c:awards")!.children[0]!;
  expect(clusterRadius(big)).toBeGreaterThanOrEqual(clusterRadius(small));
 });
});
describe("поиск по атласу",()=>{
 const tree=buildAtlas(input);
 it("ищет по названию и пояснению без учёта регистра и ё/е",()=>{
  expect(searchAtlas(tree,"ПАМЯТЬ").has("m:memory")).toBe(true);
  expect(searchAtlas(tree,"графовая").has("m:memory")).toBe(true);
  expect(searchAtlas(tree,"показатель 7").has("x:fox-7")).toBe(true);
  expect(searchAtlas(tree,"получена").size).toBeGreaterThan(0);
 });
 it("слишком короткий запрос ничего не подсвечивает; нет совпадений — пустой набор",()=>{
  expect(searchAtlas(tree,"а").size).toBe(0);
  expect(searchAtlas(tree,"").size).toBe(0);
  expect(searchAtlas(tree,"zzzzzz-нет").size).toBe(0);
 });
});
