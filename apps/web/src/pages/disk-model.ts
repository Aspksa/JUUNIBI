/** «Диск» as data: file kinds, filters, sorting, groups and folder totals. Pure, so it is unit-tested. */
import type { DiskFile } from "../api";

export type FileKind = "image" | "video" | "audio" | "pdf" | "doc" | "sheet" | "slides" | "text" | "code" | "archive" | "other";
export type Virtual = "none" | "images" | "documents" | "large" | "recent";
export type SortKey = "new" | "old" | "name" | "size";
export type GroupKey = "none" | "type" | "date";

const KINDS: [FileKind, RegExp][] = [
  ["image", /^(png|jpe?g|webp|gif|avif|bmp|svg|heic|ico)$/],
  ["video", /^(mp4|webm|mov|m4v|mkv|avi)$/],
  ["audio", /^(mp3|wav|ogg|m4a|flac|aac|opus)$/],
  ["pdf", /^pdf$/],
  ["doc", /^(docx?|odt|rtf|pages)$/],
  ["sheet", /^(xlsx?|ods|numbers|tsv)$/],
  ["slides", /^(pptx?|odp|key)$/],
  ["text", /^(txt|md|log|csv|ini|cfg|conf|srt)$/],
  ["code", /^(ts|tsx|js|jsx|mjs|cjs|py|json|html?|css|scss|xml|ya?ml|sh|bat|ps1|sql|go|rs|java|c|cpp|h|cs|php|rb)$/],
  ["archive", /^(zip|7z|rar|tar|gz|tgz|bz2|xz)$/],
];
export const KIND_LABEL: Record<FileKind, string> = {
  image: "Изображения", video: "Видео", audio: "Аудио", pdf: "PDF", doc: "Документы", sheet: "Таблицы", slides: "Презентации",
  text: "Текст", code: "Код", archive: "Архивы", other: "Другое",
};

export const extOf = (name: string) => (name.includes(".") ? name.split(".").pop()!.toLowerCase() : "");
export function kindOf(name: string): FileKind {
  const ext = extOf(name);
  return KINDS.find(([, re]) => re.test(ext))?.[0] ?? "other";
}
/** Pictures the browser can draw as a thumbnail; huge ones stay an icon so a folder of photos opens fast. */
export const THUMB_MAX = 12 * 1024 * 1024;
export const hasThumb = (f: Pick<DiskFile, "name" | "size">) => /^(png|jpe?g|webp|gif|avif|bmp)$/.test(extOf(f.name)) && f.size <= THUMB_MAX;
/** What the preview can show inside the page. */
export function previewKind(name: string): "image" | "video" | "audio" | "pdf" | "text" | null {
  const ext = extOf(name), kind = kindOf(name);
  if (kind === "image" && ext !== "svg" && ext !== "heic" && ext !== "ico") return "image";
  if (kind === "video" && /^(mp4|webm|mov|m4v)$/.test(ext)) return "video";
  if (kind === "audio" && ext !== "aac") return "audio";
  if (kind === "pdf") return "pdf";
  if (/^(txt|md|log|csv|json)$/.test(ext)) return "text";
  return null;
}
/** Files JUUNIBI can read to answer a question about them (the server takes the text out). */
export const askable = (name: string) => kindOf(name) === "pdf" || /^(txt|md|csv|json|log|ts|tsx|js|mjs|css|html|xml|ya?ml|ini|py)$/.test(extOf(name));

export function human(b: number): string {
  if (b < 1024) return b + " Б";
  if (b < 1048576) return (b / 1024).toFixed(b < 10240 ? 1 : 0).replace(".", ",") + " КБ";
  if (b < 1073741824) return (b / 1048576).toFixed(1).replace(".", ",") + " МБ";
  return (b / 1073741824).toFixed(2).replace(".", ",") + " ГБ";
}
/** «1 файл», «2 файла», «5 файлов». */
export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  return n + " " + (m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many);
}
export const files = (n: number) => plural(n, "файл", "файла", "файлов");
export const folderName = (folder: string) => (folder ? folder.split("/").pop()! : "Все файлы");
export const parentOf = (folder: string) => (folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : "");

const DAY = 86400000;
export function matchesVirtual(f: DiskFile, v: Virtual, now = Date.now()): boolean {
  if (v === "none") return true;
  if (v === "recent") return now - new Date(f.uploadedAt).getTime() < 7 * DAY;
  if (v === "large") return f.size > 5 * 1024 * 1024;
  if (v === "images") return kindOf(f.name) === "image";
  const k = kindOf(f.name);
  return k === "pdf" || k === "doc" || k === "sheet" || k === "slides" || k === "text";
}

export interface FileQuery {
  text: string; contentIds: Set<string> | null; ext: string;
  minKb: number | null; maxKb: number | null; after: string; sort: SortKey;
}
/** The visible list: search by name or by text inside, size and date bounds, extension, then the order. */
export function filterFiles(list: DiskFile[], q: FileQuery): DiskFile[] {
  const text = q.text.trim().toLocaleLowerCase();
  const ext = q.ext.trim().replace(/^\./, "").toLowerCase();
  const out = list.filter((f) =>
    (q.minKb === null || f.size >= q.minKb * 1024) && (q.maxKb === null || f.size <= q.maxKb * 1024) &&
    (!q.after || f.uploadedAt.slice(0, 10) >= q.after) && (!ext || extOf(f.name) === ext) &&
    (!text || f.name.toLocaleLowerCase().includes(text) || (q.contentIds?.has(f.id) ?? false) || (f.tags ?? []).some((t) => t.toLocaleLowerCase().includes(text))));
  const by: Record<SortKey, (a: DiskFile, b: DiskFile) => number> = {
    new: (a, b) => b.uploadedAt.localeCompare(a.uploadedAt),
    old: (a, b) => a.uploadedAt.localeCompare(b.uploadedAt),
    name: (a, b) => a.name.localeCompare(b.name, "ru", { numeric: true }),
    size: (a, b) => b.size - a.size,
  };
  return out.sort(by[q.sort]);
}
const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
export function groupLabel(f: DiskFile, g: GroupKey): string {
  if (g === "type") return KIND_LABEL[kindOf(f.name)];
  if (g === "date") { const d = new Date(f.uploadedAt); return MONTHS[d.getMonth()] + " " + d.getFullYear(); }
  return "";
}

/** Files and bytes in every folder, its subfolders included; "" is the whole disk. */
export function folderTotals(list: DiskFile[]): Map<string, { count: number; bytes: number }> {
  const out = new Map<string, { count: number; bytes: number }>();
  const add = (k: string, size: number) => { const t = out.get(k) ?? { count: 0, bytes: 0 }; t.count++; t.bytes += size; out.set(k, t); };
  for (const f of list) {
    add("", f.size);
    for (let p = f.folder; p; p = parentOf(p)) add(p, f.size);
  }
  return out;
}
/** Folder children for the tree, sorted the way the owner chose. */
export function folderChildren(folders: string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of folders) { const p = parentOf(f); out.set(p, [...(out.get(p) ?? []), f]); }
  return out;
}

/** Days left before a trashed file goes for good; null when the trash never cleans itself. */
export function daysLeft(deletedAt: string | undefined, keepDays: number, now = Date.now()): number | null {
  if (!deletedAt || !keepDays) return null;
  return Math.max(0, Math.ceil((new Date(deletedAt).getTime() + keepDays * DAY - now) / DAY));
}
/** «Такой файл уже есть в папке …» for an upload whose bytes already sit on the disk. */
export function duplicateNote(name: string, twins: { name: string; folder: string }[]): string | null {
  if (!twins.length) return null;
  const t = twins[0]!;
  const where = t.folder ? "в папке «" + t.folder + "»" : "в корне Диска";
  return t.name === name ? `Такой файл уже есть ${where}` : `«${name}» совпадает с «${t.name}» ${where}`;
}
/** The undo for a move: put each file back into the folder it came from. */
export function moveBack(before: DiskFile[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of before) out.set(f.folder, [...(out.get(f.folder) ?? []), f.id]);
  return out;
}
