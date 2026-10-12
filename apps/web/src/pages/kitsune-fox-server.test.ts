import {describe,expect,it} from "vitest";
import {validateServerRecord} from "./kitsune-fox-server";
describe("Fox SQLite client record validation",()=>{
 it("rejects wrong version and untrusted provenance",()=>{
  expect(validateServerRecord(null)).toBeNull();
  expect(validateServerRecord({schemaVersion:2,durable:true,provenance:"client-observed"})).toBeNull();
  expect(validateServerRecord({schemaVersion:1,durable:true,provenance:"server-verified"})).toBeNull();
 });
 it("sanitizes daily/hourly samples and event journal",()=>{
  const data=validateServerRecord({schemaVersion:1,durable:true,provenance:"client-observed",
   daily:{"fox-1":[{day:"2026-10-12",value:12}],"fox-other":[{day:"2026-10-12",value:90}]},
   hourly:{"fox-1":[{hour:"2026-10-12T15",value:12},{hour:"bad",value:2}],"foo":[{hour:"2026-10-12T12",value:1}]},
   events:[{id:"x",day:"2026-10-12",kind:"update",title:"Релиз",detail:"Пройден"}]});
  expect(data?.daily["fox-1"]?.[0]?.value).toBe(12);
  expect(data?.hourly["fox-1"]).toHaveLength(1);
  expect(data?.hourly.foo).toBeUndefined();
  expect(data?.events).toHaveLength(1);
 });
});
