import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LocalDisk } from "./local-disk";

let root: string, disk: LocalDisk;
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), "juunibi-audit-")); disk = new LocalDisk(path.join(root, "source")); });
afterEach(() => rm(root, { recursive: true, force: true }));
const bytes = async function* (text: string) { yield Buffer.from(text); };
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
const reload = async () => { const fresh = new LocalDisk(path.join(root, "source")); await fresh.load(); return fresh; };
const archive = async () => { const lines: string[] = []; for await (const line of disk.exportBackup()) lines.push(line.trimEnd()); return lines; };
const linesOf = async function* (lines: string[]) { yield* lines; };

describe("Disk audit regressions", () => {
  it("rechecks keep-forever retention after queued setting changes", async () => {
    const file=await disk.uploadBytes("keep.txt","",Buffer.from("keep"));
    await disk.remove(file.id);
    const started=deferred(), release=deferred();
    const pending=disk.uploadStream("block.txt","",(async function*(){started.resolve();await release.promise;yield Buffer.from("block");})());
    await started.promise;
    const setting=disk.setTrashDays(0);
    const cleanup=disk.purgeExpired(Date.now()+40*86400000);
    release.resolve();
    await Promise.all([pending,setting,cleanup]);
    expect(disk.list().trash.map(e=>e.id)).toContain(file.id);
    expect((await reload()).trashSettings().days).toBe(0);
  });
  it("preserves indexed bytes if a destructive index save is rejected", async () => {
    const file=await disk.uploadBytes("keep.txt","",Buffer.from("keep"));
    await disk.remove(file.id);
    const saved=(disk as any).save;
    (disk as any).save=async()=>{throw new Error("index unavailable");};
    try { await expect(disk.purge(file.id)).rejects.toThrow("index unavailable"); }
    finally { (disk as any).save=saved; }
    expect(disk.list().trash).toHaveLength(1);
    await disk.restore(file.id);
    expect(Buffer.from((await disk.download(file.id)).base64,"base64").toString()).toBe("keep");
  });

  it("round-trips deleted branches, revisions, covers and trash retention", async () => {
    await disk.createFolder("Работа"); await disk.createFolder("Работа/Фото");
    const file = await disk.uploadBytes("cover.png", "Работа/Фото", Buffer.from("old"));
    await disk.setFolderStyle("Работа/Фото", "#abcdef", true, file.id);
    await disk.replaceStream(file.id, bytes("new"), file.sha256);
    await disk.setTrashDays(0); await disk.trashFolder("Работа");
    const target = new LocalDisk(path.join(root, "target"));
    await target.importBackup(linesOf(await archive()));
    expect(target.list().trash).toHaveLength(1); expect(target.trashSettings().days).toBe(0);
    expect(target.listDeletedFolders()[0]?.count).toBe(2);
    await target.restoreFolder("Работа");
    expect(Buffer.from((await target.download(file.id)).base64, "base64").toString()).toBe("new");
    expect(target.fileVersions(file.id)).toHaveLength(2);
    expect(target.folderDecorations()["Работа/Фото"]?.cover).toBe(file.id);
    expect((await target.audit()).revisionIssues).toEqual([]);
  });

  it("does not let an active archive entry refer to a deleted branch", async () => {
    await disk.createFolder("A"); await disk.uploadBytes("x.txt", "A", Buffer.from("x")); await disk.trashFolder("A");
    const lines = await archive(); const manifest = JSON.parse(lines[0]!);
    delete manifest.state.entries[0].deletedAt; lines[0] = JSON.stringify(manifest);
    const target = new LocalDisk(path.join(root, "target"));
    await expect(target.importBackup(linesOf(lines))).rejects.toMatchObject({ status: 409 });
    expect(target.list().files).toEqual([]);
  });

  it("bounds copied folder names and keeps the whole copy after reload", async () => {
    const name = "a".repeat(80); await disk.createFolder(name); await disk.createFolder(name + "/child");
    await disk.uploadBytes("x.txt", name + "/child", Buffer.from("x"));
    const first = await disk.copyFolder(name, ""), second = await disk.copyFolder(name, "");
    expect(first.name.length).toBeLessThanOrEqual(80); expect(second.name.length).toBeLessThanOrEqual(80);
    expect(first.name).not.toBe(second.name);
    const fresh = await reload(); expect(fresh.list().folders).toEqual(disk.list().folders);
    expect(fresh.list(first.name + "/child").files).toHaveLength(1);
  });

  it("rejects a rename or move that makes a descendant path too long, without partial edits", async () => {
    const child = "b".repeat(80), leaf = "c".repeat(80);
    await disk.createFolder("a"); await disk.createFolder("a/" + child); await disk.createFolder("a/" + child + "/" + leaf);
    await disk.uploadBytes("x.txt", "a/" + child + "/" + leaf, Buffer.from("x"));
    const before = disk.snapshot();
    await expect(disk.renameFolder("a", "d".repeat(80))).rejects.toMatchObject({ status: 400 });
    expect(disk.list().folders).toEqual(before.folders.slice().sort());
    expect((await reload()).list().files[0]?.folder).toBe(before.files[0]?.folder);
    await disk.createFolder("d".repeat(80));
    await expect(disk.moveFolder("a", "d".repeat(80))).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a copy whose descendant path exceeds 240 characters before creating any folder", async () => {
    const name = "a".repeat(78), branch = name + "/" + "b".repeat(80), leaf = branch + "/" + "c".repeat(80);
    await disk.createFolder(name); await disk.createFolder(branch); await disk.createFolder(leaf);
    const before = disk.list().folders;
    await expect(disk.copyFolder(name, "")).rejects.toMatchObject({ status: 400 });
    expect(disk.list().folders).toEqual(before);
    expect((await reload()).list().folders).toEqual(before);
  });

  it("remaps every copied cover to its copied image, independent of the original", async () => {
    await disk.createFolder("Фото"); await disk.createFolder("Фото/Внутри");
    for (const folder of ["Фото", "Фото/Внутри"]) {
      const image = await disk.uploadBytes("cover.png", folder, Buffer.from(folder));
      await disk.setFolderStyle(folder, "#abcdef", true, image.id);
    }
    const copied = await disk.copyFolder("Фото", "");
    await disk.trashFolder("Фото"); await disk.emptyTrash();
    for (const folder of [copied.name, copied.name + "/Внутри"]) {
      const cover = disk.folderDecorations()[folder]!.cover;
      expect(disk.list(folder).files.some(file => file.id === cover)).toBe(true);
      expect((await disk.download(cover)).entry.folder).toBe(folder);
    }
  });

  it("accepts only one of two replacements with the same expected checksum", async () => {
    const file = await disk.uploadBytes("x.txt", "", Buffer.from("old"));
    const started = deferred(), release = deferred();
    const first = disk.replaceStream(file.id, (async function* () { started.resolve(); await release.promise; yield Buffer.from("first"); })(), file.sha256);
    await started.promise;
    const second = disk.replaceStream(file.id, bytes("second"), file.sha256);
    const settled = Promise.allSettled([first, second]); release.resolve();
    const result = await settled;
    expect(result[0]?.status).toBe("fulfilled"); expect(result[1]).toMatchObject({ status: "rejected", reason: { status: 409 } });
    expect(Buffer.from((await disk.download(file.id)).base64, "base64").toString()).toBe("first");
    expect((await reload()).fileVersions(file.id)).toHaveLength(2);
  });

  it("keeps a folder deletion consistent with a streamed upload already in flight", async () => {
    await disk.createFolder("A"); const started = deferred(), release = deferred();
    const uploading = disk.uploadStream("x.txt", "A", (async function* () { started.resolve(); await release.promise; yield Buffer.from("x"); })());
    await started.promise; const deleting = disk.trashFolder("A"); release.resolve();
    await Promise.all([uploading, deleting]);
    expect(disk.list().folders).toEqual([]); expect(disk.list().files).toEqual([]); expect(disk.list().trash).toHaveLength(1);
    const fresh = await reload(); await fresh.restoreFolder("A"); expect(fresh.list("A").files).toHaveLength(1);
  });

  it("does not erase an upload queued behind a failed restore", async () => {
    const started = deferred(), release = deferred();
    const restoring = disk.importBackup((async function* () {
      yield JSON.stringify({ type: "manifest", format: 1, state: { entries: [], folders: [], versions: {} } });
      started.resolve(); await release.promise; yield '{"type":"invalid"}';
    })());
    const rejected = expect(restoring).rejects.toMatchObject({ status: 400 }); await started.promise;
    const uploading = disk.uploadBytes("new.txt", "", Buffer.from("new")); release.resolve();
    await rejected; await uploading;
    expect(disk.list().files.map(f => f.name)).toEqual(["new.txt"]);
    expect((await reload()).list().files.map(f => f.name)).toEqual(["new.txt"]);
  });

  it("does not replace an existing catalog when restore queues behind an upload", async () => {
    const started = deferred(), release = deferred();
    const uploading = disk.uploadStream("new.txt", "", (async function* () { started.resolve(); await release.promise; yield Buffer.from("new"); })());
    await started.promise;
    const restoring = disk.importBackup(linesOf(['{"type":"manifest","format":1,"state":{"entries":[],"folders":[],"versions":{}}}', '{"type":"complete","objects":0}']));
    const rejected = expect(restoring).rejects.toMatchObject({ status: 409 }); release.resolve();
    await uploading; await rejected; expect((await reload()).list().files).toHaveLength(1);
  });

  it("rolls back all metadata in a rejected request, including subsequent persistence", async () => {
    const file = await disk.uploadBytes("x.txt", "", Buffer.from("x"));
    await expect(disk.setMetadata(file.id, { tags: ["changed"], color: "invalid" })).rejects.toMatchObject({ status: 400 });
    expect(disk.list().files[0]?.tags).toBeUndefined();
    await expect(disk.setMetadata(file.id, { tags: ["changed"], color: "#abcdef", note: "x".repeat(2001) })).rejects.toMatchObject({ status: 400 });
    await disk.toggleFavorite(file.id, true);
    const fresh = await reload(); expect(fresh.list().files[0]?.tags).toBeUndefined(); expect(fresh.list().files[0]?.color).toBeUndefined();
  });

  it("releases the mutation queue after stream failure and an abandoned backup", async () => {
    await expect(disk.uploadStream("bad.txt", "", (async function* () { yield Buffer.from("x"); throw new Error("broken stream"); })())).rejects.toThrow("broken stream");
    await disk.uploadBytes("good.txt", "", Buffer.from("good"));
    const iterator = disk.exportBackup(); await iterator.next();
    const creating = disk.createFolder("After"); await iterator.return(undefined); await creating;
    expect((await reload()).list().folders).toEqual(["After"]);
  });

  it("pins exported objects until backup completes even if a purge is requested", async () => {
    const file = await disk.uploadBytes("x.txt", "", Buffer.from("old")); await disk.remove(file.id);
    const iterator = disk.exportBackup(), lines: string[] = [(await iterator.next()).value!];
    const purging = disk.purge(file.id);
    for await (const line of iterator) lines.push(line);
    await purging;
    const target = new LocalDisk(path.join(root, "target")); await target.importBackup(linesOf(lines));
    await target.restore(file.id); expect(Buffer.from((await target.download(file.id)).base64, "base64").toString()).toBe("old");
  });
});
