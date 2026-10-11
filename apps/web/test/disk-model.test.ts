import { describe, expect, it } from "vitest";
import type { DiskLifeMetric, DiskFile } from "../src/api";
import { findMetrics, readyIn } from "../src/pages/disk-life";
import {
  askable, daysLeft, duplicateNote, filterFiles, folderChildren, folderTotals, groupLabel, hasThumb, human, kindOf,
  matchesVirtual, moveBack, plural, previewKind,
} from "../src/pages/disk-model";

const file = (name: string, extra: Partial<DiskFile> = {}): DiskFile =>
  ({ id: name, name, folder: "", size: 100, uploadedAt: "2026-10-10T10:00:00.000Z", sha256: "a".repeat(64), ...extra });
const q = { text: "", contentIds: null, ext: "", minKb: null, maxKb: null, after: "", sort: "new" as const };

describe("«Диск» без запросов к серверу", () => {
  it("виды файлов и что можно показать", () => {
    expect(kindOf("Фото.JPG")).toBe("image");
    expect(kindOf("отчёт.pdf")).toBe("pdf");
    expect(kindOf("табель.xlsx")).toBe("sheet");
    expect(kindOf("README")).toBe("other");
    expect(previewKind("ролик.mp4")).toBe("video");
    expect(previewKind("песня.mp3")).toBe("audio");
    expect(previewKind("значок.svg")).toBeNull(); // svg never shown inline
    expect(hasThumb({ name: "a.png", size: 1000 })).toBe(true);
    expect(hasThumb({ name: "a.png", size: 40 * 1024 * 1024 })).toBe(false);
    expect(askable("договор.pdf")).toBe(true);
    expect(askable("фото.png")).toBe(false);
  });
  it("разделы «Изображения» и «Документы» находят свои файлы (раньше были всегда пустыми)", () => {
    expect(matchesVirtual(file("кот.png"), "images")).toBe(true);
    expect(matchesVirtual(file("кот.png"), "documents")).toBe(false);
    expect(matchesVirtual(file("смета.docx"), "documents")).toBe(true);
    expect(matchesVirtual(file("большой.zip", { size: 6 * 1024 * 1024 }), "large")).toBe(true);
    const now = new Date("2026-10-11T10:00:00.000Z").getTime();
    expect(matchesVirtual(file("старый.txt", { uploadedAt: "2026-09-01T00:00:00.000Z" }), "recent", now)).toBe(false);
    expect(matchesVirtual(file("свежий.txt"), "recent", now)).toBe(true);
  });
  it("поиск по имени, меткам и тексту, фильтры и порядок", () => {
    const list = [file("б.txt", { size: 3000, tags: ["отпуск"] }), file("а.pdf", { uploadedAt: "2026-10-11T00:00:00.000Z" }), file("в10.txt"), file("в2.txt")];
    expect(filterFiles(list, { ...q, text: "ОТПУСК" }).map((f) => f.name)).toEqual(["б.txt"]);
    expect(filterFiles(list, { ...q, text: "внутри", contentIds: new Set(["а.pdf"]) }).map((f) => f.name)).toEqual(["а.pdf"]);
    expect(filterFiles(list, { ...q, ext: ".PDF" }).map((f) => f.name)).toEqual(["а.pdf"]);
    expect(filterFiles(list, { ...q, minKb: 2 }).map((f) => f.name)).toEqual(["б.txt"]);
    expect(filterFiles(list, { ...q, sort: "name" }).map((f) => f.name)).toEqual(["а.pdf", "б.txt", "в2.txt", "в10.txt"]);
    expect(filterFiles(list, q)[0]!.name).toBe("а.pdf");
    expect(groupLabel(file("x.png"), "type")).toBe("Изображения");
    expect(groupLabel(file("x.png"), "date")).toBe("Октябрь 2026");
  });
  it("размеры папок считают и подпапки", () => {
    const t = folderTotals([file("a", { folder: "Фото/Отпуск", size: 10 }), file("b", { folder: "Фото", size: 5 }), file("c", { size: 1 })]);
    expect(t.get("")).toEqual({ count: 3, bytes: 16 });
    expect(t.get("Фото")).toEqual({ count: 2, bytes: 15 });
    expect(t.get("Фото/Отпуск")).toEqual({ count: 1, bytes: 10 });
    expect(folderChildren(["Фото", "Фото/Отпуск", "Работа"]).get("")).toEqual(["Фото", "Работа"]);
  });
  it("подписи по-русски", () => {
    expect(human(512)).toBe("512 Б");
    expect(human(1536)).toBe("1,5 КБ");
    expect(human(5 * 1048576)).toBe("5,0 МБ");
    expect(plural(1, "файл", "файла", "файлов")).toBe("1 файл");
    expect(plural(3, "файл", "файла", "файлов")).toBe("3 файла");
    expect(plural(12, "файл", "файла", "файлов")).toBe("12 файлов");
    expect(plural(21, "файл", "файла", "файлов")).toBe("21 файл");
  });
  it("корзина, дубликаты и отмена перемещения", () => {
    const now = new Date("2026-10-11T00:00:00.000Z").getTime();
    expect(daysLeft("2026-10-01T00:00:00.000Z", 30, now)).toBe(20);
    expect(daysLeft("2026-10-01T00:00:00.000Z", 0, now)).toBeNull();
    expect(duplicateNote("a.txt", [])).toBeNull();
    expect(duplicateNote("a.txt", [{ name: "a.txt", folder: "Работа" }])).toBe("Такой файл уже есть в папке «Работа»");
    expect(duplicateNote("b.txt", [{ name: "a.txt", folder: "" }])).toBe("«b.txt» совпадает с «a.txt» в корне Диска");
    const back = moveBack([file("1", { folder: "A" }), file("2", { folder: "B" }), file("3", { folder: "A" })]);
    expect([...back]).toEqual([["A", ["1", "3"]], ["B", ["2"]]]);
  });
  it("«Жизнь документов»: поиск по названию, группе и подсказке, готовые показатели в группе", () => {
    const m = (id: string, group: string, title: string, extra: Partial<DiskLifeMetric> = {}): DiskLifeMetric => ({ id, group, icon: id, title, hint: "", value: "1", ...extra });
    const metrics = [m("a", "core", "Файлов на Диске"), m("b", "words", "Слов в документах", { empty: true, value: "—", hint: "нет документов" }), m("c", "words", "Знаков", { hint: "с пробелами" })];
    const groups = [{ id: "core", title: "Сердце Диска" }, { id: "words", title: "Слова и страницы" }];
    expect(findMetrics(metrics, groups, "файлов").map((x) => x.id)).toEqual(["a"]);
    expect(findMetrics(metrics, groups, "СТРАНИЦ").map((x) => x.id)).toEqual(["b", "c"]);
    expect(findMetrics(metrics, groups, "пробел").map((x) => x.id)).toEqual(["c"]);
    expect(findMetrics(metrics, groups, "  ").length).toBe(3);
    expect(readyIn(metrics, "words")).toBe(1);
  });
});
