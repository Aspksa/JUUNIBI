import {describe,expect,it} from "vitest";
import {parseFoxPulls,foxPullTrack,parseFoxCI} from "./kitsune-fox-github";
describe("Fox PR timeline integrity",()=>{
 const sha="a".repeat(40);
 it("filters untrusted links, validates SHA and open work",()=>{
  const data=parseFoxPulls([
   {number:288,title:"fix: shell crash",html_url:"https://github.com/Aspksa/JUUNIBI/pull/288",head:{sha},state:"closed",merged_at:"2026-10-12T00:00:00Z"},
   {number:289,title:"Upcoming work",html_url:"https://github.com/Aspksa/JUUNIBI/pull/289",head:{sha},state:"open",merged_at:null},
   {number:290,title:"malicious",html_url:"https://example.com/phishing",state:"open"}
  ]);
  expect(data).toHaveLength(2);
  expect(data[0]?.sha).toBe(sha);
  expect(data[0]?.state).toBe("merged");
  expect(foxPullTrack(data[0]!)).toBe("bug");
  expect(foxPullTrack(data[1]!)).toBe("paused");
 });
 it("does not invent CI success from missing or failed jobs",()=>{
  expect(parseFoxCI({workflow_runs:[]})).toBe("unknown");
  expect(parseFoxCI({workflow_runs:[{status:"completed",conclusion:"failure",created_at:"2026-10-12"}]})).toBe("failed");
  expect(parseFoxCI({workflow_runs:[{status:"in_progress",created_at:"2026-10-12"}]})).toBe("pending");
  expect(parseFoxCI({workflow_runs:[{status:"completed",conclusion:"success",created_at:"2026-10-12"}]})).toBe("passed");
 });
});
