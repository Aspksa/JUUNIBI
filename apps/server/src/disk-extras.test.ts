import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { rm } from "../test/temp-files";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { LocalDisk, MAX_FILES, LIMIT } from "./local-disk";
import { crc32, uniqueNames, zipLength, zipStream } from "./zip-write";
import { listZip, readZipEntry } from "./zip-read";
import { colIndex, docxPreview, headingLevel, officePreview, pptxPreview, previewText, previewTruncated, xlsxPreview } from "./office-preview";
import { buildExtraTools } from "./assistant-tools";
import type { Organizer } from "./organizer";

/** A stored (uncompressed) ZIP built in memory, like Office writes it but without deflate. */
function makeZip(files: Record<string, string>): Buffer {
  const parts: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const n = Buffer.from(name), data = Buffer.from(text), crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    parts.push(local, n, data); central.push(c, n);
    offset += 30 + n.length + data.length;
  }
  const dir = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10); end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}
const DOCX = makeZip({ "word/document.xml": `<w:document><w:body>
  <w:p><w:pPr><w:pStyle w:val="1"/></w:pPr><w:r><w:t>Договор аренды</w:t></w:r></w:p>
  <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Сумма:</w:t></w:r><w:r><w:t xml:space="preserve"> 45 000 &amp; залог</w:t></w:r></w:p>
  <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>Пункт первый</w:t></w:r></w:p>
  <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Месяц</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Сумма</w:t></w:r></w:p></w:tc></w:tr>
  <w:tr><w:tc><w:p><w:r><w:t>Май</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>45000</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
</w:body></w:document>` });
const XLSX = makeZip({
  "xl/workbook.xml": `<workbook><sheets><sheet name="Бюджет" sheetId="1" r:id="rId1"/><sheet name="Пусто" sheetId="2" r:id="rId2"/></sheets></workbook>`,
  "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>`,
  "xl/sharedStrings.xml": `<sst><si><t>Статья</t></si><si><r><t>Сум</t></r><r><t>ма</t></r></si><si><t>Аренда</t></si></sst>`,
  "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="3"><c r="A3" t="s"><v>2</v></c><c r="C3"><v>1234.5</v></c><c r="D3" t="inlineStr"><is><t>да</t></is></c></row></sheetData></worksheet>`,
  "xl/worksheets/sheet2.xml": `<worksheet><sheetData/></worksheet>`,
});
const PPTX = makeZip({
  "ppt/slides/slide2.xml": `<p:sld><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><a:p><a:r><a:t>Итоги</a:t></a:r></a:p></p:sp><p:sp><a:p><a:r><a:t>Рост 20%</a:t></a:r></a:p></p:sp></p:sld>`,
  "ppt/slides/slide1.xml": `<p:sld><p:sp><p:nvSpPr><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><a:p><a:r><a:t>План</a:t></a:r></a:p></p:sp></p:sld>`,
});
const tmp = () => mkdtemp(path.join(os.tmpdir(), "juunibi-disk-x-"));

describe("Office preview", () => {
  it("reads Word headings, bold, lists and tables", () => {
    const p = docxPreview(DOCX);
    if (p.kind !== "doc") throw new Error("kind");
    expect(p.blocks[0]).toEqual({ k: "h", level: 1, runs: [{ t: "Договор аренды" }] });
    expect(p.blocks[1]).toEqual({ k: "p", runs: [{ t: "Сумма:", b: true }, { t: " 45 000 & залог" }] });
    expect(p.blocks[2]?.k).toBe("li");
    expect(p.blocks[3]).toEqual({ k: "table", rows: [["Месяц", "Сумма"], ["Май", "45000"]] });
    expect(previewText(p)).toContain("# Договор аренды");
    expect(headingLevel("Heading 2")).toBe(2);
    expect(headingLevel("Заголовок 3")).toBe(3);
    expect(headingLevel("a3")).toBe(0);
  });
  it("reads Excel sheets with shared strings, numbers and gaps", () => {
    const p = xlsxPreview(XLSX);
    if (p.kind !== "sheet") throw new Error("kind");
    expect(p.sheets.map((s) => s.name)).toEqual(["Бюджет", "Пусто"]);
    expect(p.sheets[0]!.rows[0]).toEqual(["Статья", "Сумма", "", ""]);
    expect(p.sheets[0]!.rows[1]).toEqual(["", "", "", ""]);
    expect(p.sheets[0]!.rows[2]![0]).toBe("Аренда");
    expect(p.sheets[0]!.rows[2]![2]).toMatch(/^1\s?234,5$/);
    expect(p.sheets[0]!.rows[2]![3]).toBe("да");
    expect(p.sheets[1]!.rows).toEqual([]);
    expect(colIndex("AB12")).toBe(27);
  });
  it("orders PowerPoint slides by number and finds titles", () => {
    const p = pptxPreview(PPTX);
    if (p.kind !== "slides") throw new Error("kind");
    expect(p.slides).toEqual([{ title: "План", lines: [] }, { title: "Итоги", lines: ["Рост 20%"] }]);
  });
  it("tells the chat when a table or a deck was cut short", async () => {
    expect(previewTruncated(xlsxPreview(XLSX))).toBe(false);
    expect(previewTruncated(pptxPreview(PPTX))).toBe(false);
    const rows = Array.from({ length: 301 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i}</v></c></row>`).join("");
    const big = makeZip({
      "xl/workbook.xml": `<workbook><sheets><sheet name="Много" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
      "xl/worksheets/sheet1.xml": `<worksheet><sheetData>${rows}</sheetData></worksheet>`,
    });
    expect(previewTruncated(xlsxPreview(big))).toBe(true);
    const dir = await tmp();
    try {
      const disk = new LocalDisk(dir);
      const f = await disk.uploadBytes("много.xlsx", "", big);
      expect((await disk.readText(f.id, 1024 * 1024)).truncated).toBe(true);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("lists a ZIP from its directory and refuses big Office files", async () => {
    const dir = await tmp();
    try {
      const zip = makeZip({ "Фото/": "", "Фото/a.jpg": "xxxx", "readme.txt": "hello" });
      await writeFile(path.join(dir, "a.zip"), zip);
      const p = await officePreview(path.join(dir, "a.zip"), "zip", zip.length);
      if (p.kind !== "zip") throw new Error("kind");
      expect(p.total).toBe(2);
      expect(p.bytes).toBe(9);
      expect(p.entries.find((e) => e.name === "Фото/")?.dir).toBe(true);
      await expect(officePreview(path.join(dir, "a.zip"), "docx", 65 * 1048576)).rejects.toMatchObject({ status: 413 });
      await writeFile(path.join(dir, "bad.zip"), "not a zip at all, honestly");
      await expect(officePreview(path.join(dir, "bad.zip"), "zip", 26)).rejects.toMatchObject({ status: 422 });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe("ZIP download", () => {
  it("streams a valid archive that reads back byte for byte", async () => {
    const dir = await tmp();
    try {
      const a = Buffer.from("первый файл"), b = Buffer.alloc(70000, 7);
      await writeFile(path.join(dir, "a"), a); await writeFile(path.join(dir, "b"), b);
      const sha = (x: Buffer) => createHash("sha256").update(x).digest("hex");
      const files = [
        { name: "Папка/первый.txt", path: path.join(dir, "a"), size: a.length, sha256: sha(a), modified: "2026-10-11T10:00:00Z" },
        { name: "Папка/sub/b.bin", path: path.join(dir, "b"), size: b.length, sha256: sha(b), modified: "2026-10-11T10:00:00Z" },
      ];
      const chunks: Buffer[] = [];
      for await (const c of zipStream(files)) chunks.push(c);
      const zip = Buffer.concat(chunks);
      expect(zip.length).toBe(zipLength(files));
      const entries = listZip(zip);
      expect(entries.map((e) => e.name)).toEqual(["Папка/первый.txt", "Папка/sub/b.bin"]);
      expect(readZipEntry(zip, entries[0]!).toString()).toBe("первый файл");
      expect(readZipEntry(zip, entries[1]!).equals(b)).toBe(true);
      // a file changed on disk stops the archive instead of shipping wrong bytes
      const broken = [{ ...files[0]!, sha256: "0".repeat(64) }];
      await expect((async () => { for await (const _ of zipStream(broken)) void _; })()).rejects.toThrow(/повреждён/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("keeps names unique inside the archive", () => {
    expect(uniqueNames(["a/отчёт.pdf", "a/Отчёт.pdf", "b/отчёт.pdf", "a/README"])).toEqual(["a/отчёт.pdf", "a/Отчёт (2).pdf", "b/отчёт.pdf", "a/README"]);
  });
  it("plans a folder with subfolders and a mixed selection", async () => {
    const dir = await tmp();
    try {
      const disk = new LocalDisk(dir);
      await disk.createFolder("Работа"); await disk.createFolder("Работа/Отчёты"); await disk.createFolder("Дом");
      const a = await disk.uploadBytes("план.txt", "Работа", Buffer.from("a"));
      await disk.uploadBytes("q3.txt", "Работа/Отчёты", Buffer.from("b"));
      const c = await disk.uploadBytes("счёт:май.txt", "Дом", Buffer.from("c"));
      expect(disk.zipPlan({ folder: "Работа" }).files.map((f) => f.name).sort()).toEqual(["Работа/Отчёты/q3.txt", "Работа/план.txt"].sort());
      const mixed = disk.zipPlan({ ids: [a.id, c.id] });
      expect(mixed.name).toBe("Файлы с Диска");
      expect(mixed.files.map((f) => f.name)).toEqual(["Работа/план.txt", "Дом/счёт_май.txt"]);
      expect(disk.zipPlan({ ids: [a.id] }).name).toBe("Работа");
      await disk.createFolder("Пусто");
      expect(() => disk.zipPlan({ folder: "Пусто" })).toThrow(/нет файлов/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe("Disk for the chat, thumbnails and limits", () => {
  it("refuses a chat save that would not fit without leaving empty folders", async () => {
    const dir = await tmp();
    try {
      const disk = new LocalDisk(dir);
      for (let i = 0; i < 499; i++) await disk.createFolder("п" + i);
      await expect(disk.saveText("план", "Новая/Вложенная", "текст")).rejects.toMatchObject({ status: 409 });
      expect(disk.list().folders).toHaveLength(499);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }, 20000);
  it("saves text from the chat as a file, then as a new version, making folders on the way", async () => {
    const dir = await tmp();
    try {
      const disk = new LocalDisk(dir);
      const first = await disk.saveText("План недели", "Работа/Планы", "# План\nпонедельник");
      expect(first).toMatchObject({ name: "План недели.md", folder: "Работа/Планы", savedAs: "new" });
      expect(disk.list().folders).toEqual(["Работа", "Работа/Планы"]);
      const again = await disk.saveText("план недели.md", "Работа/Планы", "# План\nвторник");
      expect(again).toMatchObject({ id: first.id, savedAs: "version", revision: 2 });
      expect((await disk.readText(first.id)).text).toContain("вторник");
      await expect(disk.saveText("пусто.md", "", "   ")).rejects.toMatchObject({ status: 400 });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("searches inside Word files and offers chat tools for the Disk", async () => {
    const dir = await tmp();
    try {
      const disk = new LocalDisk(dir);
      await disk.createFolder("Договоры");
      const doc = await disk.uploadBytes("аренда.docx", "Договоры", DOCX);
      await disk.uploadBytes("заметка.txt", "", Buffer.from("купить молоко"));
      expect(await disk.searchContent("залог")).toEqual([doc.id]);
      const tools = buildExtraTools({ settings: () => ({}) as never, organizer: {} as Organizer, backupDir: dir, brief: async () => ({}) as never, disk });
      const find = tools.find((t) => t.name === "disk_find")!;
      const r = await find.run({ query: "залог" }) as { files: { id: string; matchInText?: boolean }[] };
      expect(r.files).toEqual([expect.objectContaining({ id: doc.id, matchInText: true })]);
      const byName = await find.run({ query: "аренда" }) as { files: { name: string }[] };
      expect(byName.files.map((f) => f.name)).toEqual(["аренда.docx"]);
      const read = await tools.find((t) => t.name === "disk_read")!.run({ id: doc.id }) as { text: string };
      expect(read.text).toContain("Договор аренды");
      expect(tools.find((t) => t.name === "disk_save")!.risk).toBe("write");
      const xl = await disk.uploadBytes("бюджет.xlsx", "", XLSX);
      expect((await disk.readText(xl.id)).text).toContain("Аренда");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("keeps picture previews by content and marks them in the catalogue", async () => {
    const dir = await tmp();
    try {
      const disk = new LocalDisk(dir);
      const f = await disk.uploadBytes("скан.pdf", "", Buffer.from("%PDF-1.4 fake"));
      expect(disk.list().files[0]?.thumb).toBeUndefined();
      await expect(disk.saveThumb(f.id, Buffer.from("<svg/>"))).rejects.toMatchObject({ status: 415 });
      const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 "), Buffer.alloc(20)]);
      await disk.saveThumb(f.id, webp);
      expect(disk.list().files[0]?.thumb).toBe(true);
      expect(disk.thumbOf(f.id).type).toBe("image/webp");
      const fresh = new LocalDisk(dir); await fresh.load();
      expect(fresh.list().files[0]?.thumb).toBe(true);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("raises the limits to 500 МБ a file and 10 000 files", () => {
    expect(LIMIT).toBe(500 * 1024 * 1024);
    expect(MAX_FILES).toBe(10000);
  });
});
