import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { applyPreparedUpdate, safeUpdatePath, rollbackInstall, rollbackFailedStart, confirmUpdate, applyRollbackRequest, pruneUpdateFolder } from "./apply-update.mjs";
import { readdir } from "node:fs/promises";
const hash = b => createHash("sha1").update("blob " + b.length + "\0").update(b).digest("hex");
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "juunibi-installer-"));
  await mkdir(path.join(root, ".updates", "staging"), {recursive:true});
  return root;
}
async function ready(root, files, sha = "a".repeat(40), removals) {
  await writeFile(path.join(root, ".updates", "ready.json"), JSON.stringify({sha, files:files.map(([name, bytes])=>({path:name, sha:hash(Buffer.from(bytes))})), ...(removals ? {removals} : {})}));
  for (const [name, bytes] of files) {
    const p=path.join(root, ".updates", "staging",name);
    await mkdir(path.dirname(p),{recursive:true});
    await writeFile(p, bytes);
  }
}
test("rejects traversal, sensitive files and Windows aliases", () => {
  for (const p of ["../secret",".env","data/key.json",".updates/ready.json","C:/secret","folder/CON.txt","folder/..","folder/trailing."]) assert.equal(safeUpdatePath(p), false, p);
  assert.equal(safeUpdatePath("apps/web/src/main.ts"),true);
});
test("installs verified files and records actual completion", async () => {
  const root=await fixture();
  try {
    await mkdir(path.join(root,"apps"),{recursive:true});
    await writeFile(path.join(root,"apps","existing.txt"),"old");
    await writeFile(path.join(root,".juunibi-version"),"oldmarker");
    await ready(root,[["apps/existing.txt","new"],["apps/added.txt","created"]]);
    assert.equal(await applyPreparedUpdate(root),true);
    assert.equal(await readFile(path.join(root,"apps","existing.txt"),"utf8"),"new");
    assert.equal(await readFile(path.join(root,"apps","added.txt"),"utf8"),"created");
    assert.equal((await readFile(path.join(root,".juunibi-version"),"utf8")).trim(),"a".repeat(40));
    const events=(await readFile(path.join(root,".updates","events.jsonl"),"utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(events.filter(e=>e.type==="file_install_done").length,2);
    assert.equal(events.at(-1).type,"update_completed");
  } finally { await rm(root,{recursive:true,force:true}); }
});
test("fails a corrupt later file without changing the earlier destination", async () => {
  const root=await fixture();
  try {
    await mkdir(path.join(root,"apps"),{recursive:true});
    await writeFile(path.join(root,"apps","one.txt"),"old");
    await ready(root,[["apps/one.txt","new"],["apps/two.txt","good"]]);
    await writeFile(path.join(root,".updates","staging","apps","two.txt"),"tampered");
    await assert.rejects(applyPreparedUpdate(root),/целостности/);
    assert.equal(await readFile(path.join(root,"apps","one.txt"),"utf8"),"old");
  } finally { await rm(root,{recursive:true,force:true}); }
});
test("rejects symlinked destination directories", { skip: process.platform === "win32" ? "Creating directory symlinks requires Windows privileges or Developer Mode" : false }, async () => {
  const root=await fixture(),outside=await mkdtemp(path.join(os.tmpdir(),"juunibi-outside-"));
  try {
    await symlink(outside,path.join(root,"linked"),"dir");
    await ready(root,[["linked/payload.txt","payload"]]);
    await assert.rejects(applyPreparedUpdate(root),/Небезопасный путь/);
    await assert.rejects(readFile(path.join(outside,"payload.txt")));
  } finally {await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});
test("refuses protected files without replacing user secrets", async () => {
  const root=await fixture();
  try {
    await writeFile(path.join(root,".env"),"my-key");
    await ready(root,[[".env","attacker"]]);
    await assert.rejects(applyPreparedUpdate(root),/манифест/);
    assert.equal(await readFile(path.join(root,".env"),"utf8"),"my-key");
  } finally {await rm(root,{recursive:true,force:true});}
});

const events = async root => (await readFile(path.join(root,".updates","events.jsonl"),"utf8")).trim().split("\n").map(JSON.parse);
test("health check runs after install and is recorded", async () => {
  const root=await fixture();
  try {
    await ready(root,[["apps/a.txt","x"]]);
    await applyPreparedUpdate(root);
    const types=(await events(root)).map(e=>e.type);
    assert.ok(types.indexOf("file_install_done")<types.indexOf("health_check_started"));
    assert.ok(types.indexOf("health_check_started")<types.indexOf("health_check_done"));
    assert.equal((await events(root)).find(e=>e.type==="health_check_done").status,"healthy");
  } finally {await rm(root,{recursive:true,force:true});}
});
test("failed health check rolls back files and version marker", async () => {
  const root=await fixture();
  try {
    await mkdir(path.join(root,"apps"),{recursive:true});
    await writeFile(path.join(root,"apps","a.txt"),"old");
    await writeFile(path.join(root,".juunibi-version"),"oldmarker");
    await ready(root,[["apps/a.txt","new"],["apps/b.txt","added"]]);
    await assert.rejects(applyPreparedUpdate(root,{healthCheck:async()=>{throw new Error("не запускается");}}),/не запускается/);
    assert.equal(await readFile(path.join(root,"apps","a.txt"),"utf8"),"old");
    await assert.rejects(readFile(path.join(root,"apps","b.txt")));
    assert.equal(await readFile(path.join(root,".juunibi-version"),"utf8"),"oldmarker");
    const types=(await events(root)).map(e=>e.type);
    for (const t of ["health_check_done","update_failed","rollback_started","rollback_done"]) assert.ok(types.includes(t),t);
    assert.ok(!types.includes("update_completed"));
  } finally {await rm(root,{recursive:true,force:true});}
});
test("default health check catches a broken script", async () => {
  const root=await fixture();
  try {
    await mkdir(path.join(root,"scripts"),{recursive:true});
    await writeFile(path.join(root,"scripts","x.mjs"),"export const ok = 1;");
    await ready(root,[["scripts/x.mjs","export const = ;"]]);
    await assert.rejects(applyPreparedUpdate(root),/Синтаксическая ошибка/);
    assert.equal(await readFile(path.join(root,"scripts","x.mjs"),"utf8"),"export const ok = 1;");
  } finally {await rm(root,{recursive:true,force:true});}
});
test("removals happen only for files the user confirmed for this exact update", async () => {
  const root=await fixture();
  try {
    await mkdir(path.join(root,"apps"),{recursive:true});
    await writeFile(path.join(root,"apps","old1.txt"),"1");
    await writeFile(path.join(root,"apps","old2.txt"),"2");
    await writeFile(path.join(root,"apps","mine.txt"),"user file, not in removals");
    // no confirmation -> nothing is deleted
    await ready(root,[["apps/new.txt","n"]],"a".repeat(40),["apps/old1.txt","apps/old2.txt"]);
    await applyPreparedUpdate(root);
    assert.equal(await readFile(path.join(root,"apps","old1.txt"),"utf8"),"1");
    assert.ok(!(await events(root)).some(e=>e.type==="file_remove_done"));
    // confirmation for a different sha is ignored; for this sha only old1
    await ready(root,[["apps/new2.txt","n"]],"b".repeat(40),["apps/old1.txt","apps/old2.txt"]);
    await writeFile(path.join(root,".updates","removals-confirmed.json"),JSON.stringify({sha:"c".repeat(40),paths:["apps/old1.txt"]}));
    await applyPreparedUpdate(root);
    assert.equal(await readFile(path.join(root,"apps","old1.txt"),"utf8"),"1");
    await ready(root,[["apps/new3.txt","n"]],"d".repeat(40),["apps/old1.txt","apps/old2.txt"]);
    await writeFile(path.join(root,".updates","removals-confirmed.json"),JSON.stringify({sha:"d".repeat(40),paths:["apps/old1.txt"]}));
    await applyPreparedUpdate(root);
    await assert.rejects(readFile(path.join(root,"apps","old1.txt")));
    assert.equal(await readFile(path.join(root,"apps","old2.txt"),"utf8"),"2");
    assert.equal(await readFile(path.join(root,"apps","mine.txt"),"utf8"),"user file, not in removals");
    const removed=(await events(root)).filter(e=>e.type==="file_remove_done");
    assert.deepEqual(removed.map(e=>e.relative_path),["apps/old1.txt"]);
    const installed=JSON.parse(await readFile(path.join(root,".updates","installed.json"),"utf8"));
    assert.equal(installed.sha,"d".repeat(40));
  } finally {await rm(root,{recursive:true,force:true});}
});
test("a confirmed removal is restored when the update rolls back", async () => {
  const root=await fixture();
  try {
    await mkdir(path.join(root,"apps"),{recursive:true});
    await writeFile(path.join(root,"apps","old.txt"),"keep me");
    await ready(root,[["apps/new.txt","n"]],"e".repeat(40),["apps/old.txt"]);
    await writeFile(path.join(root,".updates","removals-confirmed.json"),JSON.stringify({sha:"e".repeat(40),paths:["apps/old.txt"]}));
    await assert.rejects(applyPreparedUpdate(root,{healthCheck:async()=>{throw new Error("bad");}}));
    assert.equal(await readFile(path.join(root,"apps","old.txt"),"utf8"),"keep me");
    await assert.rejects(readFile(path.join(root,"apps","new.txt")));
  } finally {await rm(root,{recursive:true,force:true});}
});
test("rejects unsafe or conflicting removals in the manifest", async () => {
  for (const bad of [["../x"],[".env"],["apps/new.txt"]]) {
    const root=await fixture();
    try {
      await ready(root,[["apps/new.txt","n"]],"a".repeat(40),bad);
      await assert.rejects(applyPreparedUpdate(root),/манифест/);
    } finally {await rm(root,{recursive:true,force:true});}
  }
});
test("unsafe destination aborts without any success event", async () => {
  const root=await fixture();
  try {
    await mkdir(path.join(root,"apps","blocker"),{recursive:true}); // a directory where a file must be written
    await ready(root,[["apps/blocker","file"]]);
    await assert.rejects(applyPreparedUpdate(root));
    const ev=await events(root);
    assert.ok(!ev.some(e=>e.type==="file_install_done"));
    assert.ok(!ev.some(e=>e.type==="update_completed"));
  } finally {await rm(root,{recursive:true,force:true});}
});

const history = async root => (await readFile(path.join(root,".updates","history.jsonl"),"utf8")).trim().split("\n").map(JSON.parse);
test("a file already identical on disk is neither backed up nor rewritten", async () => {
  const root=await fixture();
  try {
    await mkdir(path.join(root,"apps"),{recursive:true});
    await writeFile(path.join(root,"apps","same.txt"),"same");
    await writeFile(path.join(root,"apps","changed.txt"),"old");
    await ready(root,[["apps/same.txt","same"],["apps/changed.txt","new"]]);
    await applyPreparedUpdate(root);
    const ev=await events(root);
    assert.deepEqual(ev.filter(e=>e.type==="file_install_done").map(e=>e.relative_path),["apps/changed.txt"]);
    const backups=await readdir(path.join(root,".updates","backups"));
    const saved=await readdir(path.join(root,".updates","backups",backups[0],"apps"));
    assert.deepEqual(saved,["changed.txt"]);
  } finally {await rm(root,{recursive:true,force:true});}
});
test("a successful install records history, awaits confirmation and frees the staging folder", async () => {
  const root=await fixture();
  try {
    await writeFile(path.join(root,".juunibi-version"),"b".repeat(40)+"\n");
    await ready(root,[["apps/a.txt","x"]]);
    await applyPreparedUpdate(root);
    const [h]=await history(root);
    assert.equal(h.kind,"install"); assert.equal(h.from,"b".repeat(40)); assert.equal(h.to,"a".repeat(40)); assert.ok(h.backup);
    assert.ok(JSON.parse(await readFile(path.join(root,".updates","pending-confirm.json"),"utf8")).backup);
    await assert.rejects(readdir(path.join(root,".updates","staging")));
    await confirmUpdate(root);
    await assert.rejects(readFile(path.join(root,".updates","pending-confirm.json")));
  } finally {await rm(root,{recursive:true,force:true});}
});
test("a failed install is written to history as failed", async () => {
  const root=await fixture();
  try {
    await ready(root,[["apps/a.txt","x"]]);
    await assert.rejects(applyPreparedUpdate(root,{healthCheck:async()=>{throw new Error("нет");}}));
    const [h]=await history(root);
    assert.equal(h.kind,"failed"); assert.match(h.message,/нет/);
    await assert.rejects(readFile(path.join(root,".updates","pending-confirm.json")));
  } finally {await rm(root,{recursive:true,force:true});}
});
test("a new version that does not start is rolled back automatically", async () => {
  const root=await fixture();
  try {
    await mkdir(path.join(root,"apps"),{recursive:true});
    await writeFile(path.join(root,"apps","a.txt"),"old");
    await writeFile(path.join(root,".juunibi-version"),"oldmarker");
    await writeFile(path.join(root,".updates","installed.json"),'{"sha":"old","paths":["apps/a.txt"]}');
    await ready(root,[["apps/a.txt","new"],["apps/b.txt","added"]]);
    await applyPreparedUpdate(root);
    assert.equal(await readFile(path.join(root,"apps","a.txt"),"utf8"),"new");
    assert.equal(await rollbackFailedStart(root,"Сервер не ответил"),true);
    assert.equal(await readFile(path.join(root,"apps","a.txt"),"utf8"),"old");
    await assert.rejects(readFile(path.join(root,"apps","b.txt")));
    assert.equal(await readFile(path.join(root,".juunibi-version"),"utf8"),"oldmarker");
    assert.equal(JSON.parse(await readFile(path.join(root,".updates","installed.json"),"utf8")).sha,"old");
    const h=await history(root);
    assert.deepEqual(h.map(x=>x.kind),["install","startup_failed"]);
    assert.equal(h[1].rollbackOf,h[0].backup);
    assert.equal(await rollbackFailedStart(root,"again"),false); // nothing pending any more
  } finally {await rm(root,{recursive:true,force:true});}
});
test("a confirmed install can still be rolled back by hand, once", async () => {
  const root=await fixture();
  try {
    await mkdir(path.join(root,"apps"),{recursive:true});
    await writeFile(path.join(root,"apps","a.txt"),"old");
    await ready(root,[["apps/a.txt","new"]]);
    await applyPreparedUpdate(root);
    await confirmUpdate(root);
    const [h]=await history(root);
    await writeFile(path.join(root,".updates","rollback-request.json"),JSON.stringify({backup:h.backup}));
    assert.equal(await applyRollbackRequest(root),true);
    assert.equal(await readFile(path.join(root,"apps","a.txt"),"utf8"),"old");
    await assert.rejects(readFile(path.join(root,".updates","rollback-request.json")));
    assert.equal((await history(root))[1].kind,"rollback");
    assert.equal(await applyRollbackRequest(root),false);
    assert.ok((await events(root)).some(e=>e.type==="rollback_done"&&e.reason==="rollback"));
  } finally {await rm(root,{recursive:true,force:true});}
});
test("rollback refuses unsafe backup names and damaged metadata", async () => {
  const root=await fixture();
  try {
    for (const bad of ["../x","a/b","","x y"]) await assert.rejects(rollbackInstall(root,bad),/Некорректное имя/);
    await assert.rejects(rollbackInstall(root,"missing"),/не найдена/);
    await mkdir(path.join(root,".updates","backups","evil"),{recursive:true});
    await writeFile(path.join(root,".updates","backups","evil",".meta.json"),JSON.stringify({changes:[{name:".env",existed:false}]}));
    await assert.rejects(rollbackInstall(root,"evil"),/Повреждён/);
  } finally {await rm(root,{recursive:true,force:true});}
});
test("only the newest backups and failed manifests are kept", async () => {
  const root=await fixture();
  try {
    const folder=path.join(root,".updates");
    for (const n of ["2026-01-a","2026-02-b","2026-03-c","2026-04-d","2026-05-e"]) await mkdir(path.join(folder,"backups",n),{recursive:true});
    for (const t of [1,2,3,4,5]) await writeFile(path.join(folder,`ready.failed-${t}.json`),"{}");
    await pruneUpdateFolder(folder);
    assert.deepEqual((await readdir(path.join(folder,"backups"))).sort(),["2026-03-c","2026-04-d","2026-05-e"]);
    assert.deepEqual((await readdir(folder)).filter(n=>n.startsWith("ready.failed")).sort(),["ready.failed-3.json","ready.failed-4.json","ready.failed-5.json"]);
  } finally {await rm(root,{recursive:true,force:true});}
});
