import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { applyPreparedUpdate, safeUpdatePath } from "./apply-update.mjs";
const hash = b => createHash("sha1").update("blob " + b.length + "\0").update(b).digest("hex");
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "juunibi-installer-"));
  await mkdir(path.join(root, ".updates", "staging"), {recursive:true});
  return root;
}
async function ready(root, files, sha = "a".repeat(40)) {
  await writeFile(path.join(root, ".updates", "ready.json"), JSON.stringify({sha, files:files.map(([name, bytes])=>({path:name, sha:hash(Buffer.from(bytes))}))}));
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
test("rejects symlinked destination directories", async () => {
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
