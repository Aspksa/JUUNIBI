import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { LIFE_GROUPS, buildLife, collectLife, imageSize, pdfPages, plural, textStats, type LifeSource } from "./disk-life";
import { LocalDisk, type DiskEntry } from "./local-disk";

const NOW = Date.parse("2026-10-11T12:00:00Z");
const entry = (id: string, name: string, size: number, extra: Partial<DiskEntry> = {}): DiskEntry =>
  ({ id, name, size, folder: "", uploadedAt: "2026-10-09T10:00:00.000Z", sha256: id, ...extra });
const source = (over: Partial<LifeSource> = {}): LifeSource => ({
  now: NOW, entries: [], versions: {}, folders: [], folderStyles: {}, folderActions: [], fileActions: [], deletedFolders: [], trashDays: 30, usedBytes: 0,
  docs: new Map(), images: new Map(), ...over,
});
const value = (life: ReturnType<typeof buildLife>, id: string) => life.metrics.find((m) => m.id === id)!;

describe("Жизнь документов", () => {
  it("150 разных показателей: 15 групп по 10, без повторов", () => {
    const life = buildLife(source());
    expect(LIFE_GROUPS).toHaveLength(15);
    expect(life.metrics).toHaveLength(150);
    expect(new Set(life.metrics.map((m) => m.id)).size).toBe(150);
    expect(new Set(life.metrics.map((m) => m.title)).size).toBe(150);
    for (const g of LIFE_GROUPS) expect(life.metrics.filter((m) => m.group === g.id)).toHaveLength(10);
    for (const id of life.highlights) expect(life.metrics.some((m) => m.id === id)).toBe(true);
  });

  it("на пустом Диске ничего не выдумывает: нули или «—» с объяснением", () => {
    const life = buildLife(source());
    expect(value(life, "files").value).toBe("0");
    expect(value(life, "median")).toMatchObject({ value: "—", empty: true });
    expect(value(life, "words")).toMatchObject({ empty: true, hint: "нет документов PDF, DOCX, TXT или MD" });
    expect(value(life, "orient").empty).toBe(true);
  });

  it("считает каталог, корзину, редакции и журнал", () => {
    const entries = [
      entry("a", "photo.jpg", 2048, { favorite: true, folder: "Фото", tags: ["отпуск"] }),
      entry("b", "doc.pdf", 4096, { folder: "Работа" }),
      entry("c", "copy.pdf", 4096, { folder: "Архив", sha256: "b" }),
      entry("d", "old.txt", 400, { deletedAt: "2026-10-10T00:00:00Z" }),
    ];
    const life = buildLife(source({
      entries, folders: ["Фото", "Работа", "Архив", "Пустая"], usedBytes: 12000,
      versions: { b: [{ revision: 1, size: 1000, at: "2026-09-01T10:00:00Z" }] },
      fileActions: [{ id: "a", before: { name: "x.jpg", folder: "" }, after: { name: "photo.jpg", folder: "Фото" }, at: "2026-10-10T10:00:00Z" }],
    }));
    expect(value(life, "files").value).toBe("3");
    expect(value(life, "kind_pdf").value).toBe("2");
    expect(value(life, "fempty").value).toBe("1");
    expect(value(life, "dups").value).toBe("1");
    expect(value(life, "free").value).toBe("4,0 КБ");
    expect(value(life, "trash").value).toBe("1 файл");
    expect(value(life, "revised").value).toBe("1");
    expect(value(life, "growth").value).toBe("+310%");
    expect(value(life, "renames").value).toBe("1");
    expect(value(life, "moved").value).toBe("1");
    expect(value(life, "favs").value).toBe("1");
    expect(value(life, "age").value).toBe("40 дней");
  });

  it("читает слова, сущности и связи из текста", () => {
    const t = textStats("# План\n\nВстреча 12.03.2026 в 10:00! Бюджет 1 500 ₽, рост 15%. Почему так?\n- пункт один\n- пункт два\nПишите: me@example.com, https://www.example.com/a «цитата»");
    expect(t.headings).toBe(1);
    expect(t.bullets).toBe(2);
    expect(t.dates).toBe(1);
    expect(t.years).toEqual([2026]);
    expect(t.money).toBe(1);
    expect(t.percents).toBe(1);
    expect(t.questions).toBe(1);
    expect(t.exclaims).toBe(1);
    expect(t.emails).toEqual(["me@example.com"]);
    expect(t.urls).toEqual(["example.com"]);
    expect(t.quotes).toBe(1);
    const words = "альфа бета гамма дельта эпсилон зета тета йота каппа лямбда ";
    const docs = new Map([["x", { text: textStats(words.repeat(3)) }], ["y", { text: textStats(words.repeat(2) + "омега") }]]);
    const life = buildLife(source({ entries: [entry("x", "a.txt", 10), entry("y", "b.md", 10, { folder: "Другая" })], docs }));
    expect(value(life, "read").value).toBe("2 из 2");
    expect(value(life, "pairs").value).toBe("1");
    expect(value(life, "cross").value).toBe("1");
    expect(value(life, "closest").value).toBe("a.txt ↔ b.md");
  });

  it("узнаёт размер картинок и поворот снимка по EXIF", () => {
    const png = Buffer.alloc(33); png.writeUInt32BE(0x89504e47, 0); png.write("IHDR", 12, "latin1"); png.writeUInt32BE(640, 16); png.writeUInt32BE(480, 20); png[25] = 6;
    expect(imageSize(png)).toEqual({ w: 640, h: 480, alpha: true });
    // JPEG: APP1 with orientation 6 (turned), then SOF0 4000×3000 → shown 3000×4000
    const tiff = Buffer.alloc(26); tiff.write("II", 0, "latin1"); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4); tiff.writeUInt16LE(1, 8);
    tiff.writeUInt16LE(0x0112, 10); tiff.writeUInt16LE(3, 12); tiff.writeUInt32LE(1, 14); tiff.writeUInt16LE(6, 18);
    const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, 0, 2 + 6 + tiff.length]), Buffer.from("Exif\0\0", "latin1"), tiff]);
    const sof = Buffer.from([0xff, 0xc0, 0, 11, 8, 0x0b, 0xb8, 0x0f, 0xa0, 3, 1, 0x11, 0]);
    expect(imageSize(Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof, Buffer.alloc(8)]))).toEqual({ w: 3000, h: 4000, alpha: false });
    expect(imageSize(Buffer.from("not an image"))).toBeNull();
  });

  it("считает страницы PDF и склоняет слова", () => {
    expect(pdfPages(Buffer.from("<< /Type /Pages /Count 3 >> << /Type /Page >> << /Type /Page >>", "latin1"))).toBe(3);
    expect([1, 2, 5, 11, 21, 104].map((n) => plural(n, "день", "дня", "дней"))).toEqual(["день", "дня", "дней", "дней", "день", "дня"]);
  });

  it("собирает показатели с настоящего Диска и читает каждый файл один раз", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "juunibi-life-"));
    try {
      const disk = new LocalDisk(dir);
      await disk.load();
      await disk.uploadBytes("заметка.md", "", Buffer.from("# Итоги\n\nМы обсудили план. Дата 01.10.2026. Сумма 300 ₽."));
      const stream = Buffer.from(`BT (Hello world from PDF text) Tj ET`);
      const pdf = Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Pages /Count 1 >> endobj\n2 0 obj << /Type /Page >> endobj\n3 0 obj << /Length ${deflateSync(stream).length} /Filter /FlateDecode >>\nstream\n`, "latin1");
      await disk.uploadBytes("отчёт.pdf", "", Buffer.concat([pdf, deflateSync(stream), Buffer.from("\nendstream\nendobj\n%%EOF")]));
      const life = await collectLife(disk);
      expect(life.metrics).toHaveLength(150);
      expect(life.analysis).toMatchObject({ documents: 2, read: 2 });
      expect(value(life, "headings").value).toBe("1");
      expect(value(life, "pdfpages").value).toBe("1");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
