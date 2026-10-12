import {describe,it,expect} from "vitest";
import {probeLocalRouter,routerAddresses} from "./fox-router-probe";
describe("safe Tenda candidate probe",()=>{
 it("probes only bounded fixed local addresses on HTTP port",async()=>{
  const calls:string[]=[];
  const r=await probeLocalRouter(async(host,port,timeout)=>{calls.push(host+":"+port+":"+timeout);return host==="192.168.0.1";});
  expect(calls).toEqual(routerAddresses.map(x=>x+":80:1300"));
  expect(r.detected).toBe("192.168.0.1");
  expect(r.brandVerified).toBe(false);
 });
 it("does not assume unreachable addresses are Tenda",async()=>{
  const r=await probeLocalRouter(async()=>false);
  expect(r.detected).toBeNull();expect(r.candidates.every(c=>c.latencyMs===null)).toBe(true);
 });
 it("handles transport failures without leaking errors",async()=>{
  const r=await probeLocalRouter(async()=>{throw new Error("private secret");});
  expect(r.detected).toBeNull();
  expect(JSON.stringify(r)).not.toContain("private secret");
 });
});
