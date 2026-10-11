import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";

/** A file to put into a streamed ZIP: its name inside the archive and where its bytes are. */
export interface ZipSource { name: string; path: string; size: number; sha256: string; modified: string }

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(buf: Buffer, crc = 0): number {
  let c = ~crc >>> 0;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}
function dosTime(iso: string): { time: number; date: number } {
  const d = new Date(iso);
  const y = Math.min(2107, Math.max(1980, d.getFullYear()));
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2), date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}
/** Without ZIP64 an archive stays under 4 ГБ and 65 535 files. */
export const ZIP_MAX_BYTES = 0xffffffff - 64 * 1024 * 1024, ZIP_MAX_FILES = 65000;

/**
 * Writes a ZIP (stored, no compression: photos and documents are already packed) piece by piece,
 * so a folder of any size never sits in memory. Each file is checked against its SHA-256 on the way;
 * a mismatch stops the archive, so a broken download is never mistaken for a good one.
 */
export async function* zipStream(files: ZipSource[]): AsyncGenerator<Buffer> {
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const { time, date } = dosTime(f.modified);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0808, 6); // data descriptor + UTF-8 names
    local.writeUInt16LE(0, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
    local.writeUInt16LE(name.length, 26);
    yield local; yield name;
    let crc = 0, size = 0;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(f.path)) { const b = chunk as Buffer; crc = crc32(b, crc); size += b.length; hash.update(b); yield b; }
    if (size !== f.size || hash.digest("hex") !== f.sha256) throw new Error("Файл «" + f.name + "» повреждён: архив прерван");
    const desc = Buffer.alloc(16);
    desc.writeUInt32LE(0x08074b50, 0); desc.writeUInt32LE(crc, 4); desc.writeUInt32LE(size, 8); desc.writeUInt32LE(size, 12);
    yield desc;
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0808, 8); c.writeUInt16LE(0, 10);
    c.writeUInt16LE(time, 12); c.writeUInt16LE(date, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(size, 20); c.writeUInt32LE(size, 24);
    c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + size + 16;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  yield dir; yield end;
}
/** Exact archive length, so the browser can show real download progress. */
export const zipLength = (files: ZipSource[]) => files.reduce((n, f) => n + 30 + 46 + 2 * Buffer.byteLength(f.name, "utf8") + f.size + 16, 0) + 22;

/** Unique names inside the archive: a second «отчёт.pdf» in the same place becomes «отчёт (2).pdf». */
export function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  return names.map((n) => {
    let out = n, i = 2;
    const dot = n.lastIndexOf("."), slash = n.lastIndexOf("/");
    const [base, ext] = dot > slash + 1 ? [n.slice(0, dot), n.slice(dot)] : [n, ""];
    while (seen.has(out.toLowerCase())) out = `${base} (${i++})${ext}`;
    seen.add(out.toLowerCase());
    return out;
  });
}
