import {describe,expect,it} from "vitest";
import {sanitizeHistory,recordMetrics,metricDelta,forestMood} from "./kitsune-fox-history";
import {foxMetrics} from "./kitsune-fox-metrics";
describe("Fox history and mood",()=>{
 const metrics=foxMetrics({nodes:[],snapshot:null,growth:[]});
 it("rejects missing readings and creates no imaginary trend",()=>{
  const history=recordMetrics({},metrics,"2026-10-12");
  expect(Object.keys(history)).toHaveLength(0);
  expect(metricDelta([],7)).toBeNull();
  expect(forestMood(metrics).label).toBe("Лес ждёт новостей");
 });
 it("keeps one reading per day and calculates bounded deltas",()=>{
  const live=[{...metrics[0]!,value:3}];
  const first=recordMetrics({},live,"2026-10-10");
  const next=recordMetrics(first,[{...live[0]!,value:5}],"2026-10-12");
  expect(metricDelta(next["fox-0"]!,7)).toBe(2);
  expect(metricDelta(next["fox-0"]!,30)).toBe(2);
  expect(metricDelta(next["fox-0"]!,7)).toBe(2);
  expect(recordMetrics(next,[{...live[0]!,value:6}],"2026-10-12")["fox-0"]).toHaveLength(2);
 });
 it("sanitizes malformed storage and retains only bounded entries",()=>{
  expect(sanitizeHistory({bad:[{day:"2026-10-12",value:1}],"fox-0":[{day:"2026-10-12",value:4},{day:"2026-10-11",value:-2}]})).toEqual({"fox-0":[{day:"2026-10-12",value:4}]});
 });
});
