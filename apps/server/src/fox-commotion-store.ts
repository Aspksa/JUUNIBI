import {spawn} from "node:child_process";
import path from "node:path";

/** SQLite worker for bounded client-observed Fox history. */
export function foxSQLite(root:string,payload:unknown):Promise<unknown>{
 return new Promise((resolve,reject)=>{
  const script=path.join(root,"scripts","fox-commotion-sqlite.py");
  const database=path.join(root,"data","fox-commotion.sqlite3");
  const child=spawn(process.platform==="win32"?"python":"python3",[script,database],{stdio:["pipe","pipe","pipe"],windowsHide:true});
  let output="",error="";
  child.stdout.setEncoding("utf8").on("data",(s:string)=>{output+=s;if(output.length>2_000_000)child.kill();});
  child.stderr.setEncoding("utf8").on("data",(s:string)=>{error+=s;if(error.length>4000)child.kill();});
  child.once("error",reject);
  child.once("close",code=>{
   if(code!==0){reject(new Error("Fox SQLite: "+error.slice(0,200)));return;}
   try{resolve(JSON.parse(output) as unknown);}catch{reject(new Error("Invalid Fox SQLite reply"));}
  });
  child.stdin.on("error",()=>{});
  child.stdin.end(JSON.stringify(payload));
 });
}
