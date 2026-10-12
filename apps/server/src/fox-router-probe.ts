import { createConnection } from "node:net";

/** Read-only TCP reachability checks of two documented common private router addresses.
 * An open HTTP port does NOT establish device brand, ownership, authentication, or admin access.
 */
export interface RouterCandidate { address:string; port:80; reachable:boolean; latencyMs:number|null }
export type TcpProbe = (host:string,port:number,timeoutMs:number)=>Promise<boolean>;
export const routerAddresses = ["192.168.0.1", "192.168.1.1"] as const;
export const defaultTcpProbe:TcpProbe = (host,port,timeoutMs)=>new Promise(resolve=>{
 const socket=createConnection({host,port});
 let finished=false;
 const finish=(ok:boolean)=>{if(finished)return;finished=true;socket.destroy();resolve(ok);};
 socket.setTimeout(timeoutMs);
 socket.once("connect",()=>finish(true));
 socket.once("timeout",()=>finish(false));
 socket.once("error",()=>finish(false));
});
export async function probeLocalRouter(probe:TcpProbe=defaultTcpProbe):Promise<{
 candidates:RouterCandidate[]; detected:string|null; brandVerified:false; mode:"read-only";
}> {
 const candidates=await Promise.all(routerAddresses.map(async address=>{
   const started=Date.now();
   let reachable=false;
   try{reachable=await probe(address,80,1300);}catch{/* inaccessible candidate */}
   return {address,port:80 as const,reachable,latencyMs:reachable?Math.max(0,Date.now()-started):null};
 }));
 return {candidates,detected:candidates.find(c=>c.reachable)?.address??null,brandVerified:false,mode:"read-only"};
}
