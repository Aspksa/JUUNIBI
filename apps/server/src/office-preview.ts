import { open, readFile } from "node:fs/promises";
import { listZip, xmlDecode, zipDirectory, zipEntries, zipText, type ZipEntry } from "./zip-read";

/**
 * «Просмотр» of Word, Excel, PowerPoint and ZIP files without any library: the Office formats are ZIP
 * archives of XML, so the pieces worth showing are read straight from it. Everything is bounded.
 */
export type Run = { t: string; b?: true; i?: true };
export type DocBlock = { k: "h"; level: number; runs: Run[] } | { k: "p"; runs: Run[] } | { k: "li"; runs: Run[] } | { k: "table"; rows: string[][] };
export type Preview =
  | { kind: "doc"; blocks: DocBlock[]; truncated: boolean }
  | { kind: "sheet"; sheets: { name: string; rows: string[][]; truncated: boolean }[]; truncated: boolean }
  | { kind: "slides"; slides: { title: string; lines: string[] }[]; truncated: boolean }
  | { kind: "zip"; entries: { name: string; size: number; compressed: number; dir: boolean; modified?: string }[]; total: number; bytes: number; truncated: boolean };

/** Office files are unpacked in memory; a bigger one is offered as a download instead. */
export const OFFICE_MAX = 64 * 1024 * 1024;
const MAX_BLOCKS = 3000, MAX_ROWS = 300, MAX_COLS = 40, MAX_SHEETS = 12, MAX_SLIDES = 200, MAX_ZIP_ROWS = 2000;
const bad = (message: string, status = 422) => Object.assign(new Error(message), { status });

export const previewable = (ext: string) => /^(docx|xlsx|pptx|zip)$/.test(ext);

export async function officePreview(file: string, ext: string, size: number): Promise<Preview> {
  try {
    if (ext === "zip") return await zipPreview(file, size);
    if (size > OFFICE_MAX) throw bad("Файл слишком большой для просмотра (до 64 МБ). Скачайте его.", 413);
    const data = await readFile(file);
    if (ext === "docx") return docxPreview(data);
    if (ext === "xlsx") return xlsxPreview(data);
    if (ext === "pptx") return pptxPreview(data);
  } catch (e) {
    if ((e as { status?: number }).status) throw e;
    throw bad("Не удалось открыть файл: " + (e instanceof Error ? e.message : "неизвестная ошибка"));
  }
  throw bad("Этот формат не показывается", 415);
}

/* ---------------- ZIP: the list of files, read from the central directory only ---------------- */
async function zipPreview(file: string, size: number): Promise<Preview> {
  const h = await open(file, "r");
  try {
    const tailLen = Math.min(size, 65557 + 22);
    const tail = Buffer.alloc(tailLen);
    await h.read(tail, 0, tailLen, size - tailLen);
    const d = zipDirectory(tail, size);
    if (d.size > 16 * 1024 * 1024) throw bad("Слишком длинный список файлов в архиве", 413);
    const dir = Buffer.alloc(d.size);
    await h.read(dir, 0, d.size, d.offset);
    const all = zipEntries(dir, d.count, 50000);
    const files = all.filter((e) => !e.dir);
    return {
      kind: "zip", total: files.length, bytes: files.reduce((n, e) => n + e.size, 0), truncated: all.length > MAX_ZIP_ROWS,
      entries: all.slice(0, MAX_ZIP_ROWS).map(({ name, size, compressed, dir, modified }) => ({ name, size, compressed, dir, ...(modified ? { modified } : {}) })),
    };
  } finally { await h.close(); }
}

/* ---------------- Word ---------------- */
const tagText = (xml: string) => xmlDecode(xml.replace(/<w:tab\b[^>]*\/>/g, "\t").replace(/<w:br\b[^>]*\/>/g, "\n").replace(/<[^>]+>/g, ""));
const on = (rpr: string, tag: string) => new RegExp(`<w:${tag}(?:\\s+w:val="(?:1|true|on)")?\\s*/>`).test(rpr);
function runs(p: string): Run[] {
  const out: Run[] = [];
  for (const m of p.matchAll(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g)) {
    const body = m[1]!;
    const rpr = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(body)?.[1] ?? "";
    let t = "";
    for (const x of body.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>/g)) t += x[1] !== undefined ? xmlDecode(x[1]) : x[0].startsWith("<w:tab") ? "\t" : "\n";
    if (!t) continue;
    const r: Run = { t };
    if (on(rpr, "b")) r.b = true;
    if (on(rpr, "i")) r.i = true;
    const last = out.at(-1);
    if (last && !!last.b === !!r.b && !!last.i === !!r.i) last.t += t; else out.push(r);
  }
  return out;
}
/** Heading level from a paragraph style: «Heading 2», «Заголовок 2», or the bare ids Russian Word gives them. */
export function headingLevel(style: string): number {
  const m = /^(?:heading|заголовок)\s*([1-6])$/i.exec(style) ?? /^([1-6])$/.exec(style);
  if (m) return Number(m[1]);
  return /^(title|название)$/i.test(style) ? 1 : 0;
}
export function docxPreview(data: Buffer): Preview {
  const xml = zipText(data, "word/document.xml");
  if (xml === null) throw bad("В документе нет текста");
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(xml)?.[1] ?? xml;
  const blocks: DocBlock[] = [];
  let truncated = false;
  for (const m of body.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)) {
    if (blocks.length >= MAX_BLOCKS) { truncated = true; break; }
    const x = m[0];
    if (x.startsWith("<w:tbl")) {
      const rows = [...x.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].slice(0, MAX_ROWS)
        .map((r) => [...r[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].slice(0, MAX_COLS).map((c) => [...c[0].matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((p) => tagText(p[0])).join("\n").trim()));
      if (rows.length) blocks.push({ k: "table", rows });
      continue;
    }
    const r = runs(x);
    if (!r.length) { if (blocks.length && blocks.at(-1)!.k !== "p") continue; blocks.push({ k: "p", runs: [] }); continue; }
    const style = /<w:pStyle w:val="([^"]+)"/.exec(x)?.[1] ?? "";
    const level = headingLevel(style);
    if (level) blocks.push({ k: "h", level, runs: r });
    else if (/<w:numPr>/.test(x) || /^(list|спис)/i.test(style)) blocks.push({ k: "li", runs: r });
    else blocks.push({ k: "p", runs: r });
  }
  // empty paragraphs only space things out: drop them at the edges and keep at most one in a row
  const clean = blocks.filter((b, i) => !(b.k === "p" && !b.runs.length && (i === 0 || i === blocks.length - 1 || (blocks[i - 1]!.k === "p" && !(blocks[i - 1] as { runs: Run[] }).runs.length))));
  if (!clean.some((b) => b.k === "table" || b.runs.length)) throw bad("Документ пустой");
  return { kind: "doc", blocks: clean, truncated };
}

/* ---------------- Excel ---------------- */
/** «B12» → column 1 (zero-based). */
export function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}
const siText = (si: string) => xmlDecode([...si.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((m) => m[1]).join(""));
function relTargets(xml: string | null): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of (xml ?? "").matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1], target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) map.set(id, target);
  }
  return map;
}
const resolve = (base: string, target: string) => target.startsWith("/") ? target.slice(1) : base + target.replace(/^\.\//, "");
export function xlsxPreview(data: Buffer): Preview {
  const entries = listZip(data);
  const workbook = zipText(data, "xl/workbook.xml", entries);
  if (workbook === null) throw bad("В книге нет листов");
  const rels = relTargets(zipText(data, "xl/_rels/workbook.xml.rels", entries));
  const shared = [...(zipText(data, "xl/sharedStrings.xml", entries, 32 * 1024 * 1024) ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => siText(m[1]!));
  const sheets: { name: string; rows: string[][]; truncated: boolean }[] = [];
  const tags = [...workbook.matchAll(/<sheet\b[^>]*>/g)];
  for (const s of tags.slice(0, MAX_SHEETS)) {
    const name = xmlDecode(/\bname="([^"]*)"/.exec(s[0])?.[1] ?? "Лист");
    const rid = /\br:id="([^"]+)"/.exec(s[0])?.[1];
    const target = rid ? rels.get(rid) : undefined;
    const xml = target ? zipText(data, resolve("xl/", target), entries, 32 * 1024 * 1024) : null;
    if (xml === null) { sheets.push({ name, rows: [], truncated: false }); continue; }
    const rows: string[][] = [];
    let truncated = false, width = 0;
    for (const r of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const at = Number(/\br="(\d+)"/.exec(r[1]!)?.[1] ?? rows.length + 1) - 1;
      if (at >= MAX_ROWS) { truncated = true; break; }
      const row: string[] = [];
      for (const c of r[2]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1]!, inner = c[2] ?? "";
        const col = colIndex(/\br="([A-Z]+)\d*"/.exec(attrs)?.[1] ?? String.fromCharCode(65 + Math.min(25, row.length)));
        if (col >= MAX_COLS) { truncated = true; continue; }
        const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? "n";
        const v = /<v>([^<]*)<\/v>/.exec(inner)?.[1];
        const text = type === "s" ? shared[Number(v)] ?? "" : type === "inlineStr" ? siText(inner) : type === "b" ? (v === "1" ? "ИСТИНА" : "ЛОЖЬ") : v !== undefined ? xmlDecode(v) : "";
        row[col] = type === "n" && text && Number.isFinite(Number(text)) ? Number(text).toLocaleString("ru-RU", { maximumFractionDigits: 6 }) : text;
      }
      while (rows.length < at) rows.push([]);
      rows[at] = Array.from(row, (x) => x ?? "");
      width = Math.max(width, rows[at]!.length);
    }
    // drop trailing empty rows and pad every row to the same width
    while (rows.length && rows.at(-1)!.every((x) => !x)) rows.pop();
    sheets.push({ name, rows: rows.map((r) => [...r, ...Array(Math.max(0, width - r.length)).fill("")]), truncated });
  }
  if (!sheets.length) throw bad("В книге нет листов");
  return { kind: "sheet", sheets, truncated: tags.length > MAX_SHEETS || sheets.some((s) => s.truncated) };
}

/* ---------------- PowerPoint ---------------- */
export function pptxPreview(data: Buffer): Preview {
  const entries = listZip(data);
  const all = entries.map((e: ZipEntry) => e.name).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
  const files = all.slice(0, MAX_SLIDES);
  let truncated = all.length > files.length;
  if (!files.length) throw bad("В презентации нет слайдов");
  const slides = files.map((f) => {
    const xml = zipText(data, f, entries) ?? "";
    const shapes = [...xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)].map((s) => ({
      title: /<p:ph\b[^>]*type="(?:title|ctrTitle)"/.test(s[0]),
      lines: [...s[0].matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)].map((p) => xmlDecode([...p[0].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => t[1]).join("")).trim()).filter(Boolean),
    }));
    const head = shapes.find((s) => s.title && s.lines.length);
    const lines = shapes.filter((s) => s !== head).flatMap((s) => s.lines);
    if (lines.length > 60) truncated = true;
    return { title: head?.lines.join(" ") ?? "", lines: lines.slice(0, 60) };
  });
  return { kind: "slides", slides, truncated };
}

/** Whether the preview left something out (rows, sheets, slides, blocks or archive entries). */
export const previewTruncated = (p: Preview) => p.truncated;
/** Plain text of an Office file, for the chat: what the preview shows, flattened. */
export function previewText(p: Preview): string {
  if (p.kind === "doc") return p.blocks.map((b) => b.k === "table" ? b.rows.map((r) => r.join(" | ")).join("\n") : (b.k === "li" ? "• " : b.k === "h" ? "#".repeat(b.level) + " " : "") + b.runs.map((r) => r.t).join("")).join("\n");
  if (p.kind === "sheet") return p.sheets.map((s) => "Лист «" + s.name + "»\n" + s.rows.map((r) => r.join("\t")).join("\n")).join("\n\n");
  if (p.kind === "slides") return p.slides.map((s, i) => "Слайд " + (i + 1) + (s.title ? ": " + s.title : "") + "\n" + s.lines.join("\n")).join("\n\n");
  return p.entries.map((e) => e.name + (e.dir ? "" : " (" + e.size + " Б)")).join("\n");
}
