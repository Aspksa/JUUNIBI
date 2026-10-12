import {readdir,readFile} from "node:fs/promises";
import path from "node:path";

export interface DiscoveredModule {id:string;file:string;imports:string[];candidate:boolean}
export interface DiscoveryReport {scanned:number;modules:DiscoveredModule[];candidates:DiscoveredModule[];cycles:string[][];unresolved:string[];manifestGaps:string[];truncated:boolean}
const DIRECTORIES=["apps/server/src","apps/web/src/pages"];
const MAX_FILES=900;
function parseImports(source:string):string[] {
 const results=new Set<string>();
 const rx=/(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\()\s*["'](\.[^"'\r\n]+)["']/g;
 for(const m of source.matchAll(rx))if(m[1])results.add(m[1]);
 return [...results].sort();
}
export function analyzeModuleGraph(files:Record<string,string>, manifestIds:string[]):DiscoveryReport {
 const keys=Object.keys(files).sort();
 const resolved=new Map<string,string[]>();
 const unresolved:string[]=[];
 const fileSet=new Set(keys);
 for(const file of keys){
  const deps:string[]=[];
  for(const spec of parseImports(files[file]!)){
   const target=path.posix.normalize(path.posix.join(path.posix.dirname(file),spec));
   const hit=[target,target+".ts",target+".tsx",target+".js",target+"/index.ts"].find(x=>fileSet.has(x));
   if(hit)deps.push(hit);
   else if(target.startsWith("apps/server/src/")||target.startsWith("apps/web/src/pages/"))unresolved.push(file+" → "+spec);
  }
  resolved.set(file,[...new Set(deps)].sort());
 }
 const color=new Map<string,number>(),cycles:string[][]=[];
 function visit(file:string,stack:string[]){
  color.set(file,1);stack.push(file);
  for(const dep of resolved.get(file)??[]){
   if(color.get(dep)===1){cycles.push([...stack.slice(stack.indexOf(dep)),dep]);continue;}
   if(!color.has(dep))visit(dep,stack);
  }
  stack.pop();color.set(file,2);
 }
 for(const file of keys)if(!color.has(file))visit(file,[]);
 const modules=keys.map(file=>{
  const base=path.posix.basename(file).replace(/\.(tsx?|jsx?)$/,"");
  const id=base.toLowerCase().replace(/[^a-z0-9-]/g,"-");
  const candidate=!manifestIds.includes(id);
  return {id,file,imports:resolved.get(file)??[],candidate};
 });
 return {scanned:keys.length,modules,candidates:modules.filter(m=>m.candidate).slice(0,150),cycles:cycles.slice(0,40),
  unresolved:unresolved.slice(0,100),manifestGaps:manifestIds.filter(id=>!modules.some(m=>m.id===id||m.id.includes(id))),
  truncated:false};
}
/** Read-only, bounded repository scan. Never follows symlinks or reads user files. */
export async function discoverProject(root:string,manifestIds:string[]):Promise<DiscoveryReport>{
 const files:Record<string,string>={};let truncated=false;
 for(const dir of DIRECTORIES){
  const absolute=path.join(root,dir);let names;
  try{names=await readdir(absolute,{withFileTypes:true});}catch{continue;}
  for(const entry of names.sort((a,b)=>a.name.localeCompare(b.name))){
   if(Object.keys(files).length>=MAX_FILES){truncated=true;break;}
   if(!entry.isFile()||!/^[a-z0-9][a-z0-9._-]*\.(ts|tsx)$/i.test(entry.name))continue;
   const file=path.posix.join(dir,entry.name);
   try{
    const bytes=await readFile(path.join(absolute,entry.name));
    if(bytes.byteLength>180_000)continue;
    files[file]=bytes.toString("utf8");
   }catch{/* individual files can disappear during scan */}
  }
 }
 return {...analyzeModuleGraph(files,manifestIds),truncated};
}
