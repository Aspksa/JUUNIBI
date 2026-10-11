import { inflateRawSync } from "node:zlib";

/** Strictly bounded DOCX extraction: read word/document.xml from the ZIP central directory. */
export function docxText(data: Buffer): string {
  const endMin = Math.max(0, data.length - 65557);
  let eocd = -1;
  for (let i = data.length - 22; i >= endMin; i--) {
    if (data.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Неверный архив DOCX");
  const count = data.readUInt16LE(eocd + 10);
  let offset = data.readUInt32LE(eocd + 16);
  for (let i = 0; i < count && i < 10000; i++) {
    if (offset + 46 > data.length || data.readUInt32LE(offset) !== 0x02014b50) throw new Error("Повреждён DOCX");
    const method = data.readUInt16LE(offset + 10);
    const compressed = data.readUInt32LE(offset + 20);
    const uncompressed = data.readUInt32LE(offset + 24);
    const nameLength = data.readUInt16LE(offset + 28);
    const extraLength = data.readUInt16LE(offset + 30);
    const commentLength = data.readUInt16LE(offset + 32);
    const localOffset = data.readUInt32LE(offset + 42);
    const name = data.toString("utf8", offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (name !== "word/document.xml") continue;
    if (uncompressed > 8 * 1024 * 1024 || compressed > 8 * 1024 * 1024) throw new Error("Слишком большой текст DOCX");
    if (localOffset + 30 > data.length || data.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("Повреждён DOCX");
    const start = localOffset + 30 + data.readUInt16LE(localOffset + 26) + data.readUInt16LE(localOffset + 28);
    if (start + compressed > data.length) throw new Error("Повреждён DOCX");
    const bytes = data.subarray(start, start + compressed);
    const xml = (method === 8 ? inflateRawSync(bytes, { maxOutputLength: 8 * 1024 * 1024 }) : method === 0 ? bytes : (() => { throw new Error("Неподдерживаемое сжатие DOCX"); })()).toString("utf8");
    const decoded = xml.replace(/<w:tab\b[^>]*\/?\s*>/g, "\t").replace(/<w:br\b[^>]*\/?\s*>/g, "\n")
      .replace(/<\/w:p>/g, "\n").replace(/<[^>]*>/g, "")
      .replace(/&(?:amp|lt|gt|quot|apos);|&#(?:x[\da-fA-F]+|\d+);/g, s => {
        const known: Record<string,string> = {"&amp;":"&","&lt;":"<","&gt;":">","&quot;":"\"","&apos;":"'"};
        if (known[s]) return known[s];
        const n = s.startsWith("&#x") ? parseInt(s.slice(3,-1),16) : parseInt(s.slice(2,-1),10);
        return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
      });
    return decoded.replace(/\n{3,}/g,"\n\n").trim();
  }
  throw new Error("В DOCX не найден word/document.xml");
}
