import { spawn } from "node:child_process";
import path from "node:path";
import { readFile } from "node:fs/promises";
import type { ProjectUpdater } from "./updater";

export class KitsuneEvolution {
 constructor(private readonly root:string,private readonly updater:ProjectUpdater){}
 async snapshot(){
  const manifest=JSON.parse(await readFile(path.join(this.root,"apps","web","public","evolution.json"),"utf8")) as unknown;
  if(!manifest||typeof manifest!=="object"||!Array.isArray((manifest as {nodes?:unknown}).nodes))
    throw new Error("Invalid evolution manifest");
  const history=await this.updater.history();
  const activeVersion=this.updater.status().localVersion;
  const timeline=await this.sqlite({history:history.items,activeVersion,...(/^[0-9a-f]{40}$/.test(activeVersion) ? {manifest} : {})});
  return {manifest,timeline,latest:this.updater.status().latest,phase:this.updater.status().phase};
 }
 private sqlite(payload:unknown):Promise<{history:unknown[];activeVersion:string;durable:boolean}>{
  return new Promise((resolve,reject)=>{
   const command=process.platform==="win32"?"python":"python3";
   const script=path.join(this.root,"scripts","kitsune-evolution.py");
   const database=path.join(this.root,"data","kitsune-evolution.sqlite3");
   const child=spawn(command,[script,database],{stdio:["pipe","pipe","pipe"],windowsHide:true});
   let output="",error="";
   child.stdout.setEncoding("utf8").on("data",(s:string)=>{output+=s;if(output.length>2_000_000)child.kill();});
   child.stderr.setEncoding("utf8").on("data",(s:string)=>{error+=s;if(error.length>4000)child.kill();});
   child.once("error",reject);
   child.once("close",(code)=>{if(code!==0){reject(new Error(error.slice(0,200)||"Kitsune SQLite failed"));return;}
    try{resolve(JSON.parse(output) as {history:unknown[];activeVersion:string;durable:boolean});}
    catch{reject(new Error("Invalid Kitsune SQLite response"));}});
   child.stdin.on("error",()=>{});
   child.stdin.end(JSON.stringify(payload));
  });
 }
}
