import {describe,it,expect} from "vitest";
import {chooseGoal,updateGoal,restoreGoal} from "./self-development";
describe("internal self development",()=>{
 const metrics={
  arithmetic:{attempts:5,recentAccuracy:90},
  logic:{attempts:6,recentAccuracy:40},
  transfer:{attempts:2,recentAccuracy:20},
 };
 it("chooses measured weakness instead of low-sample noise",()=>{
  expect(chooseGoal(metrics,null)).toMatchObject({skill:"logic",baseline:40,target:55,checks:0});
 });
 it("retains a goal and tracks verified attempts until success",()=>{
  const goal=chooseGoal(metrics,null)!;
  const one=updateGoal(goal,"arithmetic",true,100);
  expect(one.checks).toBe(0);
  const two=updateGoal(updateGoal(one,"logic",true,60),"logic",true,60);
  expect(two.achieved).toBe(false);
  const three=updateGoal(two,"logic",true,60);
  expect(three.achieved).toBe(true);
  expect(chooseGoal(metrics,three)?.skill).toBe("logic");
 });
 it("rejects damaged persisted goals",()=>{
  expect(restoreGoal({skill:"logic",baseline:110,target:120,checks:0,achieved:false})).toBeNull();
  expect(restoreGoal({skill:"logic",baseline:30,target:45,checks:2,achieved:false})).toMatchObject({skill:"logic",checks:2});
 });
});
