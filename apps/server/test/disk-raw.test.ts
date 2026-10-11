import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/app";
import { LocalDisk, pdfText } from "../src/local-disk";

let server: http.Server, base: string, dir: string, disk: LocalDisk;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "juunibi-disk-raw-"));
  disk = new LocalDisk(dir);
  server = createApp({ assistant: undefined, modules: () => [], configured: {}, disk });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { server.close(); await rm(dir, { recursive: true, force: true }); });

const upload = (name: string, body: string, folder = "") =>
  fetch(`${base}/api/disk/files/binary?name=${encodeURIComponent(name)}&folder=${encodeURIComponent(folder)}`, { method: "POST", headers: { origin: base, "content-type": "application/octet-stream" }, body });

describe("Disk raw files", () => {
  it("streams a file with cache headers, ranges and a download name", async () => {
    const made = await (await upload("фото.png", "0123456789")).json();
    const r = await fetch(`${base}/api/disk/files/${made.id}/raw`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("etag")).toBe(`"${made.sha256}"`);
    expect(r.headers.get("cache-control")).toContain("max-age");
    expect(await r.text()).toBe("0123456789");
    expect((await fetch(`${base}/api/disk/files/${made.id}/raw`, { headers: { "if-none-match": `"${made.sha256}"` } })).status).toBe(304);
    const part = await fetch(`${base}/api/disk/files/${made.id}/raw`, { headers: { range: "bytes=2-4" } });
    expect(part.status).toBe(206);
    expect(await part.text()).toBe("234");
    const dl = await fetch(`${base}/api/disk/files/${made.id}/raw?download=1`);
    expect(dl.headers.get("content-type")).toBe("application/octet-stream");
    expect(dl.headers.get("content-disposition")).toContain("attachment");
    expect(dl.headers.get("content-disposition")).toContain(encodeURIComponent("фото.png"));
  });
  it("never serves html or svg inline", async () => {
    const made = await (await upload("page.html", "<script>alert(1)</script>")).json();
    const r = await fetch(`${base}/api/disk/files/${made.id}/raw`);
    expect(r.headers.get("content-type")).toBe("application/octet-stream");
    expect(r.headers.get("content-disposition")).toContain("attachment");
  });
  it("warns about an identical file already on the disk", async () => {
    await disk.createFolder("Архив");
    const first = await (await upload("отчёт.txt", "одинаковое содержимое", "Архив")).json();
    expect(first.duplicates).toEqual([]);
    const second = await (await upload("копия.txt", "одинаковое содержимое")).json();
    expect(second.duplicates).toEqual([{ id: first.id, name: "отчёт.txt", folder: "Архив" }]);
  });
  it("empties the trash and cleans it on a schedule", async () => {
    const a = await (await upload("старый.txt", "a")).json();
    const b = await (await upload("новый.txt", "bb")).json();
    await disk.remove(a.id); await disk.remove(b.id);
    expect((await (await fetch(`${base}/api/disk/trash`)).json()).days).toBe(30);
    // only the file trashed more than 30 days ago goes
    const later = Date.now() + 31 * 86400000;
    expect(await disk.purgeExpired(Date.now())).toEqual({ purged: 0, bytes: 0 });
    expect((await disk.purgeExpired(later)).purged).toBe(2);
    const c = await (await upload("ещё.txt", "ccc")).json();
    await disk.remove(c.id);
    const r = await (await fetch(`${base}/api/disk/trash/empty`, { method: "POST", headers: { origin: base } })).json();
    expect(r).toEqual({ purged: 1, bytes: 3 });
    expect(disk.list().trash).toEqual([]);
    expect((await fetch(`${base}/api/disk/trash`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ days: 400 }) })).status).toBe(400);
    expect(await (await fetch(`${base}/api/disk/trash`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ days: 0 }) })).json()).toEqual({ days: 0 });
    const fresh = new LocalDisk(dir); await fresh.load();
    expect(fresh.trashSettings().days).toBe(0);
  });
  it("reads text for questions to JUUNIBI", async () => {
    const t = await (await upload("заметка.md", "# Заголовок\r\nТекст")).json();
    expect(await (await fetch(`${base}/api/disk/files/${t.id}/text`)).json()).toEqual({ name: "заметка.md", text: "# Заголовок\nТекст", truncated: false });
    const bin = await (await upload("архив.zip", "PK")).json();
    expect((await fetch(`${base}/api/disk/files/${bin.id}/text`)).status).toBe(415);
  });
});

describe("pdfText", () => {
  it("reads strings from plain and compressed content streams", () => {
    const content = "BT /F1 12 Tf 72 712 Td (Hello PDF world) Tj T* [(Second) -300 (line)] TJ ET";
    const plain = Buffer.from(`%PDF-1.4\n1 0 obj << /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n%%EOF`, "latin1");
    expect(pdfText(plain)).toContain("Hello PDF world");
    expect(pdfText(plain)).toContain("Second line");
    const packed = deflateSync(Buffer.from(content, "latin1"));
    const zipped = Buffer.concat([Buffer.from(`%PDF-1.4\n1 0 obj << /Length ${packed.length} /Filter /FlateDecode >>\nstream\n`, "latin1"), packed, Buffer.from("\nendstream\nendobj\n%%EOF", "latin1")]);
    expect(pdfText(zipped)).toContain("Hello PDF world");
  });
  it("returns nothing for a scan", () => {
    expect(pdfText(Buffer.from("%PDF-1.4\n1 0 obj << /Length 3 >>\nstream\nq Q\nendstream\n%%EOF", "latin1"))).toBe("");
  });
});
