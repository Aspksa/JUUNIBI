import {describe,expect,it} from "vitest";
import {foxMotion,foxChangedMetrics,foxVerifiedReadings} from "./kitsune-fox-motion";
import {forestAwards} from "./kitsune-fox-life";
import {foxMetrics} from "./kitsune-fox-metrics";
describe("Fox Commotion 4 animations and awards",()=>{
 it("offers 50 distinct deterministic motion combinations",()=>{
  const presets=Array.from({length:50},(_,index)=>foxMotion(index).className);
  expect(new Set(presets).size).toBe(50);
  expect(foxMotion(99).className).toBe(foxMotion(49).className);
 });
 it("animates only actual changes to known values, not initial loads or missing feeds",()=>{
  const first=[{id:"fox-3",value:4},{id:"fox-4",value:null}];
  expect(foxChangedMetrics(new Map(),first).size).toBe(0);
  const old=foxVerifiedReadings(first);
  expect(foxChangedMetrics(old,[{id:"fox-3",value:4},{id:"fox-4",value:10}]).size).toBe(0);
  expect([...foxChangedMetrics(old,[{id:"fox-3",value:5},{id:"fox-4",value:null}])]).toEqual(["fox-3"]);
 });
 it("exposes 100 awards but leaves unavailable sources locked",()=>{
  const metrics=foxMetrics({nodes:[],snapshot:null,growth:[]});
  const awards=forestAwards(metrics,{});
  expect(awards).toHaveLength(100);
  expect(new Set(awards.map(a=>a.id)).size).toBe(100);
  expect(awards.every(a=>!a.earned)).toBe(true);
 });
});
