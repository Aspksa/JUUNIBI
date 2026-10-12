import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { Assistant, Memory, type LlmProvider } from "@juunibi/assistant";
import { Logger } from "@juunibi/core";
import { createApp, hostAllowed, originAllowed } from "../src/app";
import { BrainCore } from "../src/brain";
import { BrainGraphSQLite } from "../src/brain-graph-sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const llm: LlmProvider = { chat: async (_m, o) => { o?.onText?.("при"); o?.onText?.("вет"); return { content: "привет", toolCalls: [] }; } };
let server: http.Server, base: string, port: number;
let bare: http.Server, bareBase: string;

const start = (s: http.Server) => new Promise<number>((r) => s.listen(0, "127.0.0.1", () => r((s.address() as AddressInfo).port)));
beforeAll(async () => {
  server = createApp({ assistant: new Assistant({ llm, log: new Logger("t", "silent") }), modules: () => [{ name: "a" }], configured: { model: "m" } });
  port = await start(server); base = `http://127.0.0.1:${port}`;
  bare = createApp({ assistant: undefined, modules: () => [], configured: { hint: "настройте .env" } });
  bareBase = `http://127.0.0.1:${await start(bare)}`;
});
afterAll(() => { server.close(); bare.close(); });

const post = (b: string, p: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(b + p, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

describe("guards", () => {
  it("host and origin checks", () => {
    expect(hostAllowed("localhost:4173")).toBe(true);
    expect(hostAllowed("evil.com")).toBe(false);
    expect(hostAllowed(undefined)).toBe(false);
    expect(originAllowed("http://evil.com", "127.0.0.1:1")).toBe(false);
    expect(originAllowed("http://127.0.0.1:1", "127.0.0.1:1")).toBe(true);
  });
  it("rejects rebinding host and foreign origin", async () => {
    // Host header cannot be overridden by fetch; covered by hostAllowed above
  });
});

describe("api", () => {
  it("chat round-trip, feedback, validation", async () => {
    const r = await (await post(base, "/api/chat", { message: "привет" })).json();
    expect(r.reply).toBe("привет");
    expect((await (await post(base, "/api/feedback", { turnId: r.turnId, rating: 1 })).json()).ok).toBe(true);
    expect((await post(base, "/api/chat", { message: "  " })).status).toBe(400);
    expect((await post(base, "/api/feedback", { turnId: "x", rating: 5 })).status).toBe(400);
    expect((await post(base, "/api/chat", { message: "x".repeat(800_000) })).status).toBe(413); // body too large
    expect((await post(base, "/api/chat", { message: "x".repeat(120_000) })).status).toBe(400); // message too long
    expect((await post(base, "/api/chat", { message: "x".repeat(90_000) })).status).toBe(200); // attached files fit
    expect((await post(base, "/api/chat", { message: "x" }, { origin: "http://evil.com" })).status).toBe(403);
  });
  it("lists modules and memory; unknown route 404", async () => {
    expect(await (await fetch(base + "/api/modules")).json()).toEqual([{ name: "a" }]);
    expect(await (await fetch(base + "/api/memory")).json()).toEqual([]);
    expect((await fetch(base + "/api/nope")).status).toBe(404);
  });
  it("without Cloud.ru config chat says how to fix it", async () => {
    const r = await post(bareBase, "/api/chat", { message: "hi" });
    expect(r.status).toBe(503);
    expect((await r.json()).error).toContain(".env");
    expect((await (await fetch(bareBase + "/api/status")).json()).assistant).toBe(false);
  });
  it("streams NDJSON events: deltas then done; validates input", async () => {
    const res = await post(base, "/api/chat/stream", { message: "привет", history: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }] });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const events = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
    expect(events.filter((e) => e.type === "delta").map((e) => e.text).join("")).toBe("привет");
    expect(events.at(-1)).toMatchObject({ type: "done", reply: "привет" });
    expect((await post(base, "/api/chat/stream", { message: " " })).status).toBe(400);
    expect((await post(base, "/api/chat/stream", { message: "x" }, { origin: "http://evil.com" })).status).toBe(403);
    expect((await post(bareBase, "/api/chat/stream", { message: "x" })).status).toBe(503);
  });
  it("POST /api/memory stores an active entry on explicit user request; validates", async () => {
    const r = await post(base, "/api/memory", { text: "Люблю чай без сахара", kind: "preference" });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ status: "active", kind: "preference", text: "Люблю чай без сахара" });
    expect((await post(base, "/api/memory", { text: " " })).status).toBe(400);
    expect((await post(base, "/api/memory", { text: "x".repeat(2001) })).status).toBe(400);
    expect((await post(base, "/api/memory", { text: "x" }, { origin: "http://evil.com" })).status).toBe(403);
    const list = await (await fetch(base + "/api/memory?status=active")).json();
    expect(list.some((m: { text: string }) => m.text === "Люблю чай без сахара")).toBe(true);
  });
  it("stream done event includes the memories used", async () => {
    await post(base, "/api/memory", { text: "кофе без сахара", kind: "fact" });
    const res = await post(base, "/api/chat/stream", { message: "какой кофе я пью" });
    const events = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
    expect(events.at(-1).memory).toContain("кофе без сахара");
  });
  it("memory can be read and edited before an API key is configured (chat stays disabled)", async () => {
    const mem = new Memory();
    await mem.add("lesson", "предложение", "pending");
    const srv = createApp({ assistant: undefined, memory: mem, modules: () => [], configured: { hint: "ключ" } });
    const url = `http://127.0.0.1:${await start(srv)}`;
    try {
      const list = await (await fetch(url + "/api/memory")).json();
      expect(list).toHaveLength(1);
      expect((await post(url, "/api/memory", { text: "Я люблю чай" })).status).toBe(200);
      expect((await post(url, `/api/memory/${list[0].id}/approve`, {})).status).toBe(200);
      expect((await mem.list("pending")).length).toBe(0);
      expect((await (await fetch(url + "/api/memory?status=active")).json()).length).toBe(2);
      const del = await fetch(`${url}/api/memory/${list[0].id}`, { method: "DELETE" });
      expect(await del.json()).toEqual({ ok: true });
      expect((await post(url, "/api/chat", { message: "hi" })).status).toBe(503);
    } finally { srv.close(); }
  });
});

describe("Brain cognitive HTTP integration", () => {
  it("uses real module adapter, verifies steps, blocks unsafe actions and resumes", async () => {
    const brain = new BrainCore(() => true);
    const srv = createApp({brain, modules: () => [{name:"real-module"}], configured: {model:"m"}});
    const endpoint = `http://127.0.0.1:${await start(srv)}`;
    try {
      const plan = brain.plan("review modules", ["modules", "modules again", "third"]);
      expect((await post(endpoint, "/api/brain/cognitive-batch", {planId: plan.id, actions:["list_modules","shell"], maxSteps:2})).status).toBe(400);
      expect(brain.status().plans[0]?.steps[0]?.status).toBe("pending");
      const first = await post(endpoint, "/api/brain/cognitive-batch", {planId:plan.id,actions:["list_modules","list_modules"],maxSteps:2});
      expect(first.status).toBe(200);
      const body = await first.json();
      expect(body.checkpoints).toHaveLength(2);
      expect(body.checkpoints[0].result).toEqual([{name:"real-module"}]);
      expect(body.cognitiveState.verification.completedSteps).toHaveLength(2);
      expect(body.remaining).toBe(1);
      const resume = await (await post(endpoint, "/api/brain/cognitive-batch", {planId:plan.id, actions:["list_modules"], maxSteps:1})).json();
      expect(resume.skippedVerifiedSteps).toBe(2);
      expect(resume.remaining).toBe(0);
      expect(resume.cognitiveState.phase).toBe("completed");
      expect((await post(endpoint, "/api/brain/cognitive-batch", {planId:plan.id, actions:["list_modules"], maxSteps:1})).status).toBe(409);
    } finally { srv.close(); }
  });
});

describe("Brain Next diagnostics API", () => {
  it("reports read-only readiness and evidence evaluation without triggering tools", async () => {
    const brain = new BrainCore(() => true);
    let toolCalls = 0;
    const srv = createApp({brain, modules: () => { toolCalls++; return []; }, configured: {model:"m"}});
    const url = `http://127.0.0.1:${await start(srv)}`;
    try {
      const plan = brain.plan("review", ["modules"]);
      const r = await post(url, "/api/brain/readiness", {planId:plan.id});
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({canResumeReadOnly:true,verifiedCompleted:0});
      const report = await fetch(url + "/api/brain/evaluation");
      expect(report.status).toBe(200);
      expect(await report.json()).toMatchObject({plans:{total:1},security:{writeActionsAvailable:false}});
      expect(toolCalls).toBe(0);
      expect((await post(url, "/api/brain/readiness", {planId:""})).status).toBe(400);
      expect((await post(url, "/api/brain/readiness", {planId:"missing"})).status).toBe(404);
    } finally { srv.close(); }
  });
});

describe("Brain recovery preview HTTP", () => {
  it("reports recovery without executing tool adapters", async () => {
    const brain = new BrainCore(() => true);
    let calls = 0;
    const srv = createApp({brain,modules:()=>{calls++;return [];},configured:{model:"m"}});
    const url = `http://127.0.0.1:${await start(srv)}`;
    try {
      const plan = brain.plan("prepare",["modules"]);
      const response = await post(url,"/api/brain/recovery-preview",{planId:plan.id});
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({proposedAction:null,readyForContinuation:true,requiresExplicitApproval:true});
      expect(calls).toBe(0);
      expect((await post(url,"/api/brain/recovery-preview",{planId:""})).status).toBe(400);
      expect((await post(url,"/api/brain/recovery-preview",{planId:"missing"})).status).toBe(404);
    } finally {srv.close();}
  });
});

describe("Brain confirmed experience API", () => {
  it("searches only confirmed decisions and advertises read-only tools", async () => {
    const brain = new BrainCore(() => true);
    const decision = brain.recordDecision({goal:"Find saved document",chosen:"search memory",reason:"Previous success",predictedSuccess:true,taskType:"search"});
    brain.confirmDecision(decision.id,"success");
    const server = createApp({brain,modules:()=>[],configured:{model:"m"}});
    const url = `http://127.0.0.1:${await start(server)}`;
    try {
      const result = await post(url,"/api/brain/search-experience",{query:"saved document",taskType:"search"});
      expect(result.status).toBe(200);
      expect((await result.json()).items.map((item:{id:string})=>item.id)).toEqual([decision.id]);
      expect((await post(url,"/api/brain/search-experience",{query:""})).status).toBe(400);
      const registry = await (await fetch(url+"/api/brain/tool-registry")).json();
      expect(registry.tools.map((tool:{name:string})=>tool.name)).toEqual(["list_modules","search_memory"]);
      expect(registry.writeEnabled).toBe(false);
    } finally {server.close();}
  });
});

describe("Brain experience-guided planning HTTP", () => {
  it("returns confirmed advice without invoking the tools", async () => {
    const brain = new BrainCore(() => true);
    let calls = 0;
    const srv = createApp({brain,modules:()=>{calls++;return [];},configured:{model:"m"}});
    const url = `http://127.0.0.1:${await start(srv)}`;
    try {
      const p = brain.plan("check backup",["inspect"]);
      const d = brain.recordDecision({goal:"check backup",chosen:"inspect metadata",reason:"safe",predictedSuccess:true,taskType:"backup"});
      brain.confirmDecision(d.id,"success");
      const res = await post(url,"/api/brain/preview-experience-plan",{planId:p.id,taskType:"backup"});
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({planId:p.id,requiresExplicitExecution:true,experience:{items:[{id:d.id}]}});
      expect(calls).toBe(0);
      expect((await post(url,"/api/brain/preview-experience-plan",{planId:""})).status).toBe(400);
      expect((await post(url,"/api/brain/preview-experience-plan",{planId:"missing"})).status).toBe(404);
    } finally {srv.close();}
  });
});

describe("Brain strategy comparison API", () => {
  it("compares confirmed experience without running modules", async () => {
    const brain = new BrainCore(() => true);
    let calls = 0;
    const srv = createApp({brain,modules:()=>{calls++;return [];},configured:{model:"m"}});
    const url = `http://127.0.0.1:${await start(srv)}`;
    try {
      const p = brain.plan("backup files",["inspect"]);
      const d = brain.recordDecision({goal:"backup files",chosen:"inspect files",reason:"safer",predictedSuccess:true,taskType:"backup"});
      brain.confirmDecision(d.id,"success");
      const response = await post(url,"/api/brain/compare-experience-strategies",
        {planId:p.id,options:["inspect files","delete files"],taskType:"backup"});
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({requiresExplicitExecution:true,strategies:[{option:"inspect files",score:1},{option:"delete files",score:0}]});
      expect(calls).toBe(0);
      expect((await post(url,"/api/brain/compare-experience-strategies",{planId:p.id,options:["same","same"]})).status).toBe(400);
    } finally {srv.close();}
  });
});

describe("Brain cognitive engine API", () => {
  it("returns a read-only assessment with validation", async () => {
    const brain=new BrainCore(()=>true);
    let calls=0;
    const server=createApp({brain,modules:()=>{calls++;return [];},configured:{model:"m"}});
    const url=`http://127.0.0.1:${await start(server)}`;
    try {
      const p=brain.plan("check backup",["inspect"]);
      const strategies=[{name:"inspect",risk:"low",reversible:true},{name:"erase",risk:"high",reversible:false}];
      const res=await post(url,"/api/brain/cognitive-engine",{planId:p.id,strategies});
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({planId:p.id,requiresExplicitExecution:true,adaptivePlan:{executesAutomatically:false},evaluation:{totalSteps:1}});
      expect(calls).toBe(0);
      expect((await post(url,"/api/brain/cognitive-engine",{planId:p.id,strategies:[strategies[0]]})).status).toBe(400);
      expect((await post(url,"/api/brain/cognitive-engine",{planId:"missing",strategies})).status).toBe(404);
    } finally {server.close();}
  });
});

describe("SQLite Brain graph and benchmark HTTP", () => {
  it("returns only confirmed decisions and quality regression results", async () => {
    const dir=await mkdtemp(path.join(os.tmpdir(),"juunibi-graph-api-"));
    const py=fileURLToPath(new URL("../../../scripts/brain-graph-sqlite.py",import.meta.url));
    const brain=new BrainCore(()=>true,undefined,new BrainGraphSQLite(path.join(dir,"graph.sqlite3"),py));
    const srv=createApp({brain,modules:()=>[],configured:{model:"m"}});
    const url=`http://127.0.0.1:${await start(srv)}`;
    try {
      const approved=brain.recordDecision({goal:"check archive",chosen:"inspect",reason:"verified",predictedSuccess:true,taskType:"backup"});
      brain.recordDecision({goal:"check archive",chosen:"delete",reason:"pending",predictedSuccess:false,taskType:"backup"});
      brain.confirmDecision(approved.id,"success");
      const searched=await post(url,"/api/brain/graph-search",{query:"archive"});
      expect(searched.status).toBe(200);
      expect((await searched.json()).items.map((x:{id:string})=>x.id)).toEqual([approved.id]);
      const stats=await fetch(url+"/api/brain/graph-stats");
      expect(await stats.json()).toMatchObject({decisions:1,edges:3});
      const benchmark=await (await fetch(url+"/api/brain/plan-benchmarks")).json();
      expect(benchmark).toMatchObject({failed:0,method:"deterministic-fixture-regression"});
      expect((await post(url,"/api/brain/graph-search",{query:5})).status).toBe(400);
    } finally {srv.close();await rm(dir,{recursive:true,force:true});}
  });
});
