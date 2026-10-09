/** Actual UTF-8 payload bytes observed at server boundaries; no content is retained. */
export type FlowLink="chat-to-assistant"|"assistant-to-chat"|"assistant-stream-to-chat";
interface FlowSample {at:number;bytes:number}
export class LiveByteMeter {
 private edges=new Map<FlowLink,{total:number;messages:number;samples:FlowSample[]}>();
 record(link:FlowLink,payload:string,at=Date.now()):number {
  const bytes=Buffer.byteLength(payload,"utf8");
  const edge=this.edges.get(link)??{total:0,messages:0,samples:[]};
  edge.total+=bytes;edge.messages++;edge.samples.push({at,bytes});
  edge.samples=edge.samples.filter(s=>s.at>at-1000);
  this.edges.set(link,edge);return bytes;
 }
 snapshot(at=Date.now()){
  const links=[...this.edges.entries()].map(([fromTo,v])=>({
   link:fromTo,totalBytes:v.total,messages:v.messages,
   bytesPerSecond:v.samples.filter(s=>s.at>at-1000&&s.at<=at).reduce((n,s)=>n+s.bytes,0),
  }));
  return {unit:"bytes",since:"server-start",windowMs:1000,links,totalBytes:links.reduce((n,e)=>n+e.totalBytes,0),
   note:"Измеряются UTF-8 байты сообщений на границах чат/API, не внутренние нейроны модели или обращения к файлам."};
 }
}
