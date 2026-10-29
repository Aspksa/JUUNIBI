import { createHash } from "node:crypto";
import { runPythonJson } from "./python";
import { join } from "node:path";
import type { DecisionRecord } from "./decision-memory";
import type { EmbeddingProvider } from "@juunibi/assistant";

type GraphRow = {id:string;goal:string;chosen:string;observed:"success"|"failure";observedAt:string;taskType?:string|null};
const cosine=(a:number[],b:number[])=>{
  if(a.length!==b.length || !a.length) return 0;
  let dot=0,aa=0,bb=0;
  for(let i=0;i<a.length;i++){dot+=a[i]!*b[i]!;aa+=a[i]!*a[i]!;bb+=b[i]!*b[i]!;}
  return aa && bb ? dot/Math.sqrt(aa*bb):0;
};
/** Persistent local SQLite graph; optional configured embeddings rerank confirmed outcomes. */
export class BrainGraphSQLite {
  private embedding:EmbeddingProvider|undefined;
  private queue:Promise<unknown>=Promise.resolve();
  private readonly vectors=new Map<string,{model:string;vector:number[]}>();
  constructor(private readonly file:string, private readonly script=join(process.cwd(),"scripts","brain-graph-sqlite.py")) {}
  setEmbeddingProvider(provider?:EmbeddingProvider){this.embedding=provider;this.vectors.clear();}
  private call(request:unknown):Promise<any>{
    return runPythonJson(this.script,this.file,request);
  }
  sync(records:DecisionRecord[]){
    const items=records.filter(r=>r.observed!==undefined).map(r=>({...r,observedAt:r.observedAt??r.at}));
    this.queue=this.queue.catch(()=>{}).then(()=>this.call({action:"sync",items}));
    return this.queue;
  }
  flush(){return this.queue;}
  async stats(){await this.queue;return this.call({action:"stats"});}
  /** Explainable cross-task links; only recorded, owner-confirmed outcomes are considered. */
  async relatedDecisions(decisionId:string,limit=10){
    if(typeof decisionId!=="string"||!decisionId.trim()||decisionId.length>500||
      !Number.isSafeInteger(limit)||limit<1||limit>20)
      throw Object.assign(new Error("Некорректные параметры связей"),{status:400});
    await this.queue;
    return this.call({action:"related",decisionId,limit});
  }
  async search(query:string,limit=8){
    if(typeof query!=="string"||!query.trim()||query.length>500||!Number.isSafeInteger(limit)||limit<1||limit>20)
      throw Object.assign(new Error("Некорректный поиск"),{status:400});
    await this.queue;
    const lexical=await this.call({action:"search",query,limit});
    if(!this.embedding) return lexical;
    try {
      // Index a bounded recent window to cap embedding API cost. Persist vectors for future searches/restarts.
      const data=await this.call({action:"list",limit:100}) as {items:GraphRow[]};
      const provider=this.embedding;
      const model=provider.id??"unspecified";
      const saved=await this.call({action:"vectors",provider:model}) as {items:{id:string;hash:string;vector:number[]}[]};
      const byId=new Map(saved.items.map(item=>[item.id,item]));
      const queryVector=await provider.embed(query);
      if(!queryVector.length||queryVector.some(v=>!Number.isFinite(v)))throw new Error("invalid embedding");
      const newVectors:{id:string;hash:string;vector:number[]}[]=[];
      const scored=await Promise.all(data.items.map(async row=>{
        const text=row.goal+" "+row.chosen;
        const hash=createHash("sha256").update(text).digest("hex");
        const key=model+":"+row.id+":"+hash;
        const persisted=byId.get(row.id);
        let vec=this.vectors.get(key)?.vector ?? (persisted?.hash===hash?persisted.vector:undefined);
        if(!vec||vec.length!==queryVector.length||vec.some(v=>!Number.isFinite(v))){
          vec=await provider.embed(text);
          if(vec.length===queryVector.length && vec.every(Number.isFinite))
            newVectors.push({id:row.id,hash,vector:vec});
        }
        if(vec.length===queryVector.length && vec.every(Number.isFinite))
          this.vectors.set(key,{model,vector:vec});
        return {...row,score:cosine(queryVector,vec)};
      }));
      if(newVectors.length) await this.call({action:"save_vectors",provider:model,items:newVectors});
      const combined=new Map<string,GraphRow & {score:number;lexicalScore:number;semanticScore:number}>();
      for(const row of lexical.items as (GraphRow & {score:number})[])
        combined.set(row.id,{...row,lexicalScore:row.score,semanticScore:0,score:row.score*2});
      for(const row of scored){
        if(!Number.isFinite(row.score)||row.score<=0)continue;
        const previous=combined.get(row.id);
        const semanticScore=row.score;
        const lexicalScore=previous?.lexicalScore??0;
        combined.set(row.id,{...row,lexicalScore,semanticScore,score:lexicalScore*2+semanticScore});
      }
      return {items:[...combined.values()].sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,limit),
        searchMode:"hybrid",durable:true,candidateCount:data.items.length,candidateLimit:100};
    }catch{return {...lexical,searchMode:"lexical-fallback"};}
  }
}
