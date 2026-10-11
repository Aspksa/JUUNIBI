import {describe,it,expect} from "vitest";
import {DISK_GROUPS,diskChronicles} from "./disk-chronicles";
import type {DiskEntry} from "./local-disk";
const entry=(id:string,name:string,size:number,extra:Partial<DiskEntry>={}):DiskEntry=>({id,name,size,folder:"",uploadedAt:"2026-10-09T12:00:00.000Z",sha256:id,...extra});
describe("Disk Chronicles",()=>{
 it("has exactly ninety unique metrics in ten nonoverlapping categories",()=>{
  expect(DISK_GROUPS).toHaveLength(10);
  expect(DISK_GROUPS.every(x=>x.metrics.length===9)).toBe(true);
  const all:{id:string;title:string}[]=[];
  for(const group of DISK_GROUPS)for(const metric of group.metrics)all.push(metric);
  expect(all).toHaveLength(90);
  expect(new Set(all.map(x=>x.id)).size).toBe(90);
  expect(new Set(all.map(x=>x.title)).size).toBe(90);
 });
 it("counts live files separately from trash, and never invents unavailable audits",()=>{
  const e=[entry("a","photo.jpg",2048,{favorite:true,folder:"Фото"}),entry("b","file.pdf",4096),entry("c","old.txt",400,{deletedAt:"2026-10-10T00:00:00Z"})];
  const result=diskChronicles(e,["Фото","Пустая"],Date.parse("2026-10-11T12:00:00Z"));
  const value=(n:number)=>result.metrics[n-1]!;
  expect(result.summary).toMatchObject({files:2,folders:2,total:90});
  expect(value(1).value).toBe("2");
  expect(value(13).value).toBe("1");
  expect(value(37).value).toBe("1");
  expect(value(29).value).toBe("1");
  expect(value(55).ready).toBe(false);
  expect(value(61).ready).toBe(false);
  expect(value(90).ready).toBe(false);
  expect(result.summary.ready).toBeGreaterThan(15);
 });
});
