import {foxSQLite} from "./fox-commotion-store";
import {pythonInfo,runPythonJson,type PythonInfo} from "./python";
import {discoverProject} from "./kitsune-discovery";
import path from "node:path";
import { readFile } from "node:fs/promises";
import type { ProjectUpdater } from "./updater";

type Timeline={history:unknown[];activeVersion:string;durable:boolean;snapshots?:unknown[]};
export class KitsuneEvolution {
 constructor(private readonly root:string,private readonly updater:ProjectUpdater){}
 foxHistory(payload:unknown){return foxSQLite(this.root,payload);}
 /** Whether the SQLite helper can run on this computer; shown on the page when it cannot. */
 python(){return pythonInfo();}
 async snapshot(){
  const manifest=JSON.parse(await readFile(path.join(this.root,"apps","web","public","evolution.json"),"utf8")) as unknown;
  if(!manifest||typeof manifest!=="object"||!Array.isArray((manifest as {nodes?:unknown}).nodes))
    throw new Error("Invalid evolution manifest");
  const history=await this.updater.history();
  const activeVersion=this.updater.status().localVersion;
  const python=await pythonInfo();
  let timeline:Timeline;
  let warning:string|undefined;
  if(python.ok){
   try{timeline=await this.sqlite({history:history.items,activeVersion,...(/^[0-9a-f]{40}$/.test(activeVersion) ? {manifest} : {})},python);}
   catch(error){warning="История версий недоступна: "+(error instanceof Error?error.message:String(error)).slice(0,200);timeline=this.fallback(history.items,activeVersion);}
  }else timeline=this.fallback(history.items,activeVersion);
  const ids=(manifest as {nodes:{id:string}[]}).nodes.map(n=>n.id);
  const discovery=await discoverProject(this.root,ids);
  return {manifest,timeline,discovery,latest:this.updater.status().latest,phase:this.updater.status().phase,
   python:python.ok?{ok:true,version:python.version}:{ok:false,reason:python.reason},...(warning?{warning}:{})};
 }
 /** Without the SQLite helper the install log from the update centre is still shown; there are just no stored architecture snapshots. */
 private fallback(items:{id:string;at:string;kind:string;from:string;to:string;message?:string}[],activeVersion:string):Timeline{
  return {history:items.map(x=>({id:x.id,at:x.at,kind:x.kind,from:x.from,to:x.to,message:x.message??""})),activeVersion,durable:false,snapshots:[]};
 }
 private sqlite(payload:unknown,python:PythonInfo){
  return runPythonJson<Timeline>(path.join(this.root,"scripts","kitsune-evolution.py"),path.join(this.root,"data","kitsune-evolution.sqlite3"),payload,python);
 }
}
