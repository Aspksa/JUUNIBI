import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import type { LocalDisk } from "./local-disk";

type RecordEntry = { id:string; sha256:string; name:string; folder:string; text:string; words:string[]; headings:string[]; dates:string[]; urls:string[]; updatedAt:string };
export type IntelligenceSnapshot = { generatedAt:string; total:number; indexed:number; pending:number; reused:number; failed:number; records:RecordEntry[]; links:{from:string;to:string;score:number;shared:string[]}[]; clusters:string[][]; findings:{id:string;kind:string;text:string;fileIds:string[]}[] };
const MAX_RECORDS=1000, MAX_TEXT=100*1024;
const tokenize=(s:string)=>[...s.toLocaleLowerCase("ru-RU").matchAll(/[\p{L}]{4,}/gu)].map(m=>m[0]);
const stop=new Set("этот этого которая которые после между также только через когда тогда чтобы были было является также может такой такой".split(" "));
export function metadata(text:string){
  const headings=text.split("\n").map(s=>s.trim()).filter(s=>s.length>=4&&s.length<=100&&(/^(?:#{1,6}\s+|Глава\s+\d+|Раздел\s+\d+)/iu.test(s))).slice(0,60);
  const dates=[...new Set(text.match(/\b\d{1,2}[./-]\d{1,2}[./-]\d{4}\b/g)??[])].slice(0,100);
  const urls=[...new Set(text.match(/https?:\/\/[^\s<>")]+/g)??[])].slice(0,80);
  return {headings,dates,urls};
}
export function buildGraph(records:RecordEntry[]){
  const links:IntelligenceSnapshot["links"]=[];
  const sets=records.map(r=>new Set(r.words));
  for(let i=0;i<records.length;i++)for(let j=i+1;j<records.length;j++){
    const a=sets[i]!,b=sets[j]!;
    if(!a.size||!b.size)continue;
    const common=[...a].filter(w=>b.has(w));
    const score=Math.round(100*common.length/Math.max(1,a.size+b.size-common.length));
    if(common.length>=5&&score>=20&&records[i]!.sha256!==records[j]!.sha256)links.push({from:records[i]!.id,to:records[j]!.id,score,shared:common.slice(0,8)});
  }
  const adj=new Map(records.map(r=>[r.id,new Set<string>()]));
  for(const edge of links){adj.get(edge.from)?.add(edge.to);adj.get(edge.to)?.add(edge.from);}
  const seen=new Set<string>(),clusters:string[][]=[];
  for(const r of records){if(seen.has(r.id))continue;const group:string[]=[],queue=[r.id];seen.add(r.id);while(queue.length){const id=queue.pop()!;group.push(id);for(const next of adj.get(id)??[]){if(!seen.has(next)){seen.add(next);queue.push(next);}}}if(group.length>1)clusters.push(group);}
  return {links:links.sort((a,b)=>b.score-a.score).slice(0,400),clusters};
}
export class DocumentIntelligence {
  private cache=new Map<string,RecordEntry>();
  private initialized=false;
  private busy:Promise<IntelligenceSnapshot>|null=null;
  private last:IntelligenceSnapshot|null=null;
  constructor(private disk:LocalDisk,private file:string){}
  private async load(){
    if(this.initialized)return;this.initialized=true;
    try{
      const raw=JSON.parse(await readFile(this.file,"utf8")) as {version:number;records:RecordEntry[]};
      if(raw.version!==1||!Array.isArray(raw.records))return;
      for(const rec of raw.records.slice(0,MAX_RECORDS)){
        if(typeof rec.id==="string"&&typeof rec.sha256==="string"&&typeof rec.text==="string"&&Array.isArray(rec.words)&&Array.isArray(rec.headings)&&Array.isArray(rec.dates)&&Array.isArray(rec.urls))this.cache.set(rec.id,rec);
      }
    }catch{/* missing or corrupt cache: rebuild from canonical disk files */}
  }
  private async save(){
    await mkdir(path.dirname(this.file),{recursive:true});
    const temp=this.file+".tmp";
    await writeFile(temp,JSON.stringify({version:1,records:[...this.cache.values()]}),{mode:0o600});
    await rename(temp,this.file);
  }
  async scan(){if(this.busy)return this.busy;this.busy=this.run().finally(()=>{this.busy=null;});return this.busy;}
  private async run():Promise<IntelligenceSnapshot>{
    await this.load();
    const eligible=this.disk.list().files.filter(f=>/\.(txt|md|pdf|docx)$/i.test(f.name)).slice(0,MAX_RECORDS);
    const valid=new Set(eligible.map(f=>f.id));
    for(const id of this.cache.keys())if(!valid.has(id))this.cache.delete(id);
    let reused=0,failed=0;
    for(const f of eligible){
      const old=this.cache.get(f.id);
      if(old?.sha256===f.sha256&&old.name===f.name&&old.folder===f.folder){reused++;continue;}
      try{
        const raw=await this.disk.readText(f.id,MAX_TEXT);
        const {headings,dates,urls}=metadata(raw.text);
        const words=[...new Set(tokenize(raw.text).filter(x=>!stop.has(x)))].slice(0,6000);
        this.cache.set(f.id,{id:f.id,sha256:f.sha256,name:f.name,folder:f.folder,text:raw.text,words,headings,dates,urls,updatedAt:new Date().toISOString()});
      }catch{failed++;this.cache.delete(f.id);}
    }
    await this.save();
    const records=[...this.cache.values()];
    const graph=buildGraph(records);
    const names=new Map(records.map(x=>[x.id,x.name]));
    const findings:IntelligenceSnapshot["findings"]=graph.links.slice(0,12).map((edge,i)=>({id:"connection-"+i,kind:"link",text:`🦊 Нашла связь: «${names.get(edge.from)}» ↔ «${names.get(edge.to)}». Общие термины: ${edge.shared.slice(0,3).join(", ")}.`,fileIds:[edge.from,edge.to]}));
    for(const rec of records.filter(x=>x.dates.length>0).slice(0,5))findings.push({id:"date-"+rec.id,kind:"date",text:`📅 В «${rec.name}» обнаружены даты (${rec.dates.length}).`,fileIds:[rec.id]});
    this.last={generatedAt:new Date().toISOString(),total:this.disk.list().files.length,indexed:records.length,pending:Math.max(0,eligible.length-records.length),reused,failed,records,links:graph.links,clusters:graph.clusters,findings};
    // Never return whole document bodies to the browser. Source text stays on the local server.
    return this.publicSnapshot();
  }
  private publicSnapshot():IntelligenceSnapshot{
    if(!this.last)throw new Error("Индекс ещё не построен");
    return {...this.last,records:this.last.records.map(r=>({...r,text:"",words:[]}))};
  }
  async get(){return this.scan();}
  async compare(fileId:string,oldText:string,newText:string){
    const a=oldText.split(/\n+/).map(s=>s.trim()).filter(Boolean),b=newText.split(/\n+/).map(s=>s.trim()).filter(Boolean);
    const old=new Set(a),now=new Set(b);
    return {id:fileId,added:b.filter(s=>!old.has(s)).slice(0,100),removed:a.filter(s=>!now.has(s)).slice(0,100)};
  }
  async cloudPayload(ids:string[]){
    await this.load();
    if(ids.length<1||ids.length>3)throw Object.assign(new Error("Выберите от одного до трёх документов"),{status:400});
    const records=ids.map(id=>this.cache.get(id));
    if(records.some(x=>!x))throw Object.assign(new Error("Сначала проиндексируйте выбранные документы"),{status:409});
    return records.map(x=>({id:x!.id,name:x!.name,excerpt:x!.text.slice(0,8000)}));
  }
}
