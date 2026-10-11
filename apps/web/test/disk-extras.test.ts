import { describe, it, expect } from "vitest";
import { askable, folderPlan, madeThumb, parseCsv, previewKind } from "../src/pages/disk-model";

describe("Disk: new previews", () => {
  it("knows which files open as documents, Markdown and tables", () => {
    expect(previewKind("договор.docx")).toBe("office");
    expect(previewKind("бюджет.xlsx")).toBe("office");
    expect(previewKind("архив.zip")).toBe("office");
    expect(previewKind("README.md")).toBe("markdown");
    expect(previewKind("выгрузка.csv")).toBe("table");
    expect(previewKind("лог.log")).toBe("text");
    expect(askable("договор.docx")).toBe(true);
    expect(askable("слайды.pptx")).toBe(true);
    expect(madeThumb({ name: "скан.pdf", size: 1000 })).toBe("pdf");
    expect(madeThumb({ name: "огромный.pdf", size: 50 * 1048576 })).toBeNull();
    expect(madeThumb({ name: "отпуск.mp4", size: 1000 })).toBe("video");
    expect(madeThumb({ name: "фото.jpg", size: 1000 })).toBeNull();
  });
  it("parses CSV with quotes, doubled quotes, line breaks and a guessed separator", () => {
    expect(parseCsv('a;b;c\n1;"x;y";"он сказал ""да"""\n2;"две\nстроки";3')).toEqual([["a", "b", "c"], ["1", "x;y", 'он сказал "да"'], ["2", "две\nстроки", "3"]]);
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a\tb\n1\t2", 1)).toEqual([["a", "b"]]);
  });
  it("turns a dropped folder into Disk folders, skipping system clutter", () => {
    const p = folderPlan(["Фото/2024/лето.jpg", "Фото/Thumbs.db", "Фото/док(1).pdf", "Фото/__MACOSX/x", "Фото/2024/a*b/c.txt"], "Личное");
    expect(p.files).toEqual([{ index: 0, folder: "Личное/Фото/2024" }, { index: 2, folder: "Личное/Фото" }, { index: 4, folder: "Личное/Фото/2024/a_b" }]);
    expect(p.folders).toEqual(["Личное", "Личное/Фото", "Личное/Фото/2024", "Личное/Фото/2024/a_b"]);
    expect(p.skipped).toBe(2);
    expect(folderPlan(["Отчёты/q3.txt"], "").folders).toEqual(["Отчёты"]);
  });
});
