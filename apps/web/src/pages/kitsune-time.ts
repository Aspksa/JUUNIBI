import type {EvolutionNode,EvolutionSnapshot} from "./kitsune-evolution-model";
import {dateRu,shortVersion} from "./kitsune-ru";

/** Кадр ползунка времени: набор ветвей так, как он был сохранён при установке версии. */
export interface TimeFrame{key:string;label:string;detail:string;nodes:EvolutionNode[];kind:"snapshot"|"current"}
type Timeline=EvolutionSnapshot["timeline"];

/**
 * Кадры от старого к новому; последний — «Сейчас». Берутся только реально сохранённые снимки:
 * ничего не достраивается. Нет двух кадров — ползунок честно сообщает, что данных нет.
 */
export function timeFrames(timeline:Timeline|null|undefined,currentNodes:EvolutionNode[]):TimeFrame[]{
 const snaps=timeline?.snapshots??[];
 const when=(version:string,recorded?:string)=>{
  const install=(timeline?.history??[]).find(h=>h.to===version&&(h.kind==="install"||h.kind==="rollback"));
  return install?.at||recorded||"";
 };
 const frames:(TimeFrame&{at:string})[]=snaps.map(s=>{
  const at=when(s.version,s.recordedAt);
  return {key:"v:"+s.version,label:dateRu(at)||shortVersion(s.version),detail:"Версия "+shortVersion(s.version),nodes:s.manifest.nodes,kind:"snapshot" as const,at};
 });
 frames.sort((a,b)=>a.at.localeCompare(b.at)||a.key.localeCompare(b.key));
 const active=timeline?.activeVersion??"";
 const last=frames[frames.length-1];
 if(last&&last.key==="v:"+active){last.label="Сейчас";last.detail="Версия "+shortVersion(active)+" · установлена";last.kind="current";last.nodes=currentNodes;}
 else frames.push({key:"current",label:"Сейчас",detail:active?"Версия "+shortVersion(active):"Текущая карта",nodes:currentNodes,kind:"current",at:"9999"});
 return frames.map(({at:_at,...frame})=>frame);
}
/** Ползунок имеет смысл только при двух и более кадрах. */
export const canTravel=(frames:TimeFrame[]):boolean=>frames.length>=2;
/** Что изменилось между двумя кадрами (по идентификаторам ветвей). */
export function frameDiff(before:TimeFrame,after:TimeFrame):{added:string[];removed:string[]}{
 const a=new Set(before.nodes.map(n=>n.id)),b=new Set(after.nodes.map(n=>n.id));
 return {added:after.nodes.filter(n=>!a.has(n.id)).map(n=>n.id),removed:before.nodes.filter(n=>!b.has(n.id)).map(n=>n.id)};
}
