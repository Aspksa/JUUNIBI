import { inflateRawSync } from "node:zlib";

/** One file inside a ZIP, as its central directory describes it. */
export interface ZipEntry { name: string; method: number; compressed: number; size: number; offset: number; dir: boolean; modified?: string }

const EOCD = 0x06054b50, CENTRAL = 0x02014b50, LOCAL = 0x04034b50;

/** Where the central directory starts and how long it is, from the end of the archive (`tail` = its last bytes). */
export function zipDirectory(tail: Buffer, total: number): { offset: number; size: number; count: number } {
  const endMin = Math.max(0, tail.length - 65557);
  for (let i = tail.length - 22; i >= endMin; i--) {
    if (tail.readUInt32LE(i) !== EOCD) continue;
    const count = tail.readUInt16LE(i + 10), size = tail.readUInt32LE(i + 12), offset = tail.readUInt32LE(i + 16);
    if (offset === 0xffffffff || size === 0xffffffff) throw new Error("Архив ZIP64 пока не поддерживается");
    if (offset + size > total) throw new Error("Повреждён архив");
    return { offset, size, count };
  }
  throw new Error("Это не ZIP-архив");
}

/** Entries of a central directory (bounded: at most `limit` of them). */
export function zipEntries(dir: Buffer, count: number, limit = 10000): ZipEntry[] {
  const out: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < count && i < limit; i++) {
    if (p + 46 > dir.length || dir.readUInt32LE(p) !== CENTRAL) throw new Error("Повреждён архив");
    const flags = dir.readUInt16LE(p + 8), method = dir.readUInt16LE(p + 10);
    const time = dir.readUInt16LE(p + 12), date = dir.readUInt16LE(p + 14);
    const compressed = dir.readUInt32LE(p + 20), size = dir.readUInt32LE(p + 24);
    const nameLength = dir.readUInt16LE(p + 28), extraLength = dir.readUInt16LE(p + 30), commentLength = dir.readUInt16LE(p + 32);
    const offset = dir.readUInt32LE(p + 42);
    const raw = dir.subarray(p + 46, p + 46 + nameLength);
    // bit 11: UTF-8 names; older Windows archives use the OEM code page, which reads as Latin-1 at worst
    const name = flags & 0x800 ? raw.toString("utf8") : decodeCp866(raw);
    const y = 1980 + (date >> 9), mo = (date >> 5) & 15, d = date & 31;
    const modified = mo >= 1 && mo <= 12 && d >= 1 ? new Date(y, mo - 1, d, time >> 11, (time >> 5) & 63, (time & 31) * 2).toISOString() : undefined;
    out.push({ name, method, compressed, size, offset, dir: name.endsWith("/"), ...(modified ? { modified } : {}) });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return out;
}

/** All entries of an archive held in memory. */
export function listZip(data: Buffer, limit?: number): ZipEntry[] {
  const d = zipDirectory(data, data.length);
  return zipEntries(data.subarray(d.offset, d.offset + d.size), d.count, limit);
}

/** The bytes of one entry, never more than `max` once unpacked. */
export function readZipEntry(data: Buffer, e: ZipEntry, max = 8 * 1024 * 1024): Buffer {
  if (e.size > max || e.compressed > Math.max(max, 64 * 1024 * 1024)) throw new Error("Слишком большая часть архива");
  if (e.offset + 30 > data.length || data.readUInt32LE(e.offset) !== LOCAL) throw new Error("Повреждён архив");
  const start = e.offset + 30 + data.readUInt16LE(e.offset + 26) + data.readUInt16LE(e.offset + 28);
  if (start + e.compressed > data.length) throw new Error("Повреждён архив");
  const bytes = data.subarray(start, start + e.compressed);
  if (e.method === 0) return bytes;
  if (e.method === 8) return inflateRawSync(bytes, { maxOutputLength: max });
  throw new Error("Неподдерживаемое сжатие в архиве");
}

/** A named entry as UTF-8 text, or null when the archive has no such file. */
export function zipText(data: Buffer, name: string, entries = listZip(data), max?: number): string | null {
  const e = entries.find((x) => x.name === name);
  return e ? readZipEntry(data, e, max).toString("utf8") : null;
}

const CP866 = "АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмноп░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀рстуфхцчшщъыьэюяЁёЄєЇїЎў°∙·√№¤■ ";
function decodeCp866(b: Buffer): string {
  let s = "";
  for (const c of b) s += c < 128 ? String.fromCharCode(c) : CP866[c - 128]!;
  return s;
}

/** XML character references and the five named entities. */
export function xmlDecode(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|apos);|&#(?:x[\da-fA-F]+|\d+);/g, (m) => {
    const known: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&apos;": "'" };
    if (known[m]) return known[m];
    const n = m.startsWith("&#x") ? parseInt(m.slice(3, -1), 16) : parseInt(m.slice(2, -1), 10);
    return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
  });
}
