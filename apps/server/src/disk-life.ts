/**
 * «Жизнь документов»: 150 figures about the owner's Disk in 15 groups of 10, each with a small chart.
 * Everything is counted on this computer from real data: the catalogue, the revision history, the journal
 * of renames and moves, the text inside documents, picture headers and PDF pages. A figure that has nothing
 * to count from says so («—») instead of guessing.
 */
import { open, readFile } from "node:fs/promises";
import type { DiskEntry, LocalDisk } from "./local-disk";

export type LifeKind = "line" | "spark" | "split" | "dots" | "hours" | "calendar" | "list" | "swatches";
export type LifeMetric = {
  id: string; group: string; icon: string; title: string; hint: string; value: string;
  detail?: string; kind?: LifeKind; series?: number[]; labels?: string[]; list?: string[]; ring?: number; empty?: boolean;
};
export type LifeGroup = { id: string; title: string; icon: string; color: string; note: string };
export type DiskLife = {
  generatedAt: string; groups: LifeGroup[]; metrics: LifeMetric[]; highlights: string[];
  analysis: { documents: number; read: number; scans: number; unreadable: number; images: number; measured: number };
};

export const LIFE_GROUPS: LifeGroup[] = [
  { id: "core", title: "Сердце Диска", icon: "core", color: "#e0a43a", note: "сколько всего и чем занято место" },
  { id: "kinds", title: "Типы файлов", icon: "kinds", color: "#38bdf8", note: "из чего состоит коллекция" },
  { id: "pulse", title: "Пульс загрузок", icon: "pulse", color: "#22c55e", note: "когда вы добавляете файлы" },
  { id: "time", title: "Машина времени", icon: "time", color: "#8b5cf6", note: "возраст и рост Диска" },
  { id: "folders", title: "Папки", icon: "folders", color: "#f97316", note: "как устроено дерево" },
  { id: "moves", title: "Движение и порядок", icon: "moves", color: "#14b8a6", note: "переименования, переносы, папки" },
  { id: "versions", title: "Редакции", icon: "versions", color: "#ec4899", note: "как файлы меняются со временем" },
  { id: "marks", title: "Избранное и метки", icon: "marks", color: "#eab308", note: "что вы отметили сами" },
  { id: "health", title: "Здоровье и чистота", icon: "health", color: "#ef4444", note: "копии, корзина, странные имена" },
  { id: "words", title: "Слова и страницы", icon: "words", color: "#6366f1", note: "объём текста в документах" },
  { id: "style", title: "Язык и стиль", icon: "style", color: "#c084fc", note: "какими словами написано" },
  { id: "inside", title: "Что внутри текста", icon: "inside", color: "#06b6d4", note: "ссылки, даты, суммы, списки" },
  { id: "links", title: "Связи документов", icon: "links", color: "#fb7185", note: "какие документы похожи по словам" },
  { id: "media", title: "Картинки и PDF", icon: "media", color: "#84cc16", note: "размеры снимков и страницы" },
  { id: "fun", title: "Забавные рекорды", icon: "fun", color: "#ff6fa8", note: "то же самое, но с улыбкой" },
];

/* ---------------- probes: what is read from inside the files ---------------- */

export type TextStats = {
  words: number; chars: number; sentences: number; paragraphs: number; questions: number; exclaims: number; ellipses: number;
  numbers: number; urls: string[]; emails: string[]; phones: string[]; dates: number; years: number[]; money: number; percents: number;
  headings: number; bullets: number; quotes: number; tableRows: number; cyr: number; lat: number; digits: number;
  longestWord: string; longestSentence: number; letters: number; letterWords: number; wordLen: number[]; sentLen: number[];
  sttr: number; terms: [string, number][];
};
export type DocProbe = { text: TextStats | null; pages?: number; scan?: boolean; unreadable?: boolean };
export type ImageProbe = { w: number; h: number; alpha: boolean };

const STOP = new Set(("это как для что или при его она они где когда если тот тех нет все был были ещё уже также тоже после перед между потому можно нужно " +
  "так вот только чтобы который которые которая которых этот эта эти этих там тут ним нем них она оно они вас нас вам нам вы мы их его ему её ней ними без над под про " +
  "the and for that with this from are was were you your have has not but can will all its into our out").split(" "));
const MONTHS_GEN = "января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря";

/** Plain figures of one text: words, sentences, entities and its most frequent terms. Pure and tested. */
export function textStats(text: string, csv = false): TextStats {
  const tokens = text.match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) ?? [];
  const words = tokens.filter((t) => /\p{L}/u.test(t));
  const wordLen = Array.from({ length: 13 }, () => 0);
  let letters = 0, longestWord = "";
  const counts = new Map<string, number>();
  for (const w of words) {
    const clean = w.replace(/[^\p{L}]/gu, "");
    if (!clean) continue;
    letters += clean.length;
    wordLen[Math.min(12, clean.length) - 1]!++;
    if (clean.length > longestWord.length && clean.length <= 40) longestWord = w;
    const low = w.toLocaleLowerCase("ru-RU");
    if (low.length >= 3 && !STOP.has(low) && /^\p{L}/u.test(low)) counts.set(low, (counts.get(low) ?? 0) + 1);
  }
  const sentences = text.split(/[.!?…]+(?=\s|$)|\n{2,}/).map((s) => s.trim()).filter((s) => (s.match(/\p{L}+/gu) ?? []).length >= 2);
  const sentLen = [0, 0, 0, 0, 0];
  let longestSentence = 0;
  for (const s of sentences) {
    const n = (s.match(/\p{L}+/gu) ?? []).length;
    sentLen[n <= 5 ? 0 : n <= 10 ? 1 : n <= 20 ? 2 : n <= 30 ? 3 : 4]!++;
    longestSentence = Math.max(longestSentence, s.length);
  }
  const blocks = text.split(/\n\s*\n/).filter((b) => b.trim());
  const lines = text.split("\n");
  const paragraphs = blocks.length > 1 ? blocks.length : lines.filter((l) => l.trim()).length;
  const uniq = <T,>(xs: T[]) => [...new Set(xs)];
  const urls = (text.match(/https?:\/\/[^\s<>"'«»)\]]+/gi) ?? []).map((u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } }).filter(Boolean);
  const emails = uniq((text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-zа-я]{2,}/giu) ?? []).map((e) => e.toLowerCase()));
  const phones = uniq((text.match(/(?:\+7|\b8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}\b|\+\d{1,3}[\s(-]*\d{2,4}[\s)-]*\d{3}[\s-]*\d{2,4}(?:[\s-]*\d{2,4})?/g) ?? []).map((p) => p.replace(/\D/g, "")));
  const years: number[] = [];
  let dates = 0;
  for (const m of text.matchAll(/\b(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})\b/g)) { const d = +m[1]!, mo = +m[2]!; if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) { dates++; if (m[3]!.length === 4) years.push(+m[3]!); } }
  for (const m of text.matchAll(/\b((?:19|20)\d{2})-(\d{2})-(\d{2})\b/g)) { if (+m[2]! >= 1 && +m[2]! <= 12) { dates++; years.push(+m[1]!); } }
  for (const m of text.matchAll(new RegExp(`\\b\\d{1,2}\\s+(?:${MONTHS_GEN})(?:\\s+((?:19|20)\\d{2}))?`, "giu"))) { dates++; if (m[1]) years.push(+m[1]); }
  const money = (text.match(/\d[\d\s ]*(?:[.,]\d+)?\s?(?:₽|руб\.?|рубл[\p{L}]*|\$|€|USD|EUR|долл[\p{L}]*|евро)|[$€]\s?\d/giu) ?? []).length;
  const tableRows = lines.filter((l) => (l.match(/\|/g) ?? []).length >= 2 || (l.match(/\t/g) ?? []).length >= 2 || (csv && (l.match(/[,;]/g) ?? []).length >= 1)).length;
  const first = words.slice(0, 1000).map((w) => w.toLocaleLowerCase("ru-RU"));
  return {
    words: words.length, chars: text.length, sentences: sentences.length, paragraphs,
    questions: (text.match(/\?+/g) ?? []).length, exclaims: (text.match(/!+/g) ?? []).length, ellipses: (text.match(/\.{3}|…/g) ?? []).length,
    numbers: tokens.length - words.length, urls, emails, phones, dates, years, money,
    percents: (text.match(/\d+(?:[.,]\d+)?\s?%/g) ?? []).length,
    headings: lines.filter((l) => /^#{1,6}\s+\S/.test(l)).length,
    bullets: lines.filter((l) => /^\s*(?:[-*•–]|\d{1,3}[.)])\s+\S/.test(l)).length,
    quotes: (text.match(/«[^«»]{1,500}»|“[^“”]{1,500}”|„[^„“]{1,500}“/g) ?? []).length,
    tableRows, cyr: (text.match(/[Ѐ-ӿ]/g) ?? []).length, lat: (text.match(/[a-z]/gi) ?? []).length, digits: (text.match(/\d/g) ?? []).length,
    longestWord, longestSentence, letters, letterWords: words.length, wordLen, sentLen,
    sttr: first.length >= 50 ? new Set(first).size / first.length : 0,
    terms: [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 1000),
  };
}

/** Width, height and transparency from the first bytes of PNG, GIF, BMP, WebP or JPEG (EXIF turn applied). */
export function imageSize(b: Buffer): ImageProbe | null {
  if (b.length >= 26 && b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), alpha: b[25] === 4 || b[25] === 6 || b.includes("tRNS") };
  if (b.length >= 10 && b.toString("latin1", 0, 4) === "GIF8") return { w: b.readUInt16LE(6), h: b.readUInt16LE(8), alpha: false };
  if (b.length >= 26 && b.toString("latin1", 0, 2) === "BM") return { w: b.readInt32LE(18), h: Math.abs(b.readInt32LE(22)), alpha: false };
  if (b.length >= 30 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") {
    const chunk = b.toString("latin1", 12, 16);
    if (chunk === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3), alpha: !!(b[20]! & 0x10) };
    if (chunk === "VP8L") { const b0 = b[21]!, b1 = b[22]!, b2 = b[23]!, b3 = b[24]!; return { w: 1 + (b0 | ((b1 & 0x3f) << 8)), h: 1 + ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10)), alpha: !!(b3 & 0x10) }; }
    if (chunk === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff, alpha: false };
    return null;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2, turned = false;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1]!;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = b.readUInt16BE(i + 2);
      if (marker === 0xe1 && b.toString("latin1", i + 4, i + 8) === "Exif") turned = exifTurned(b.subarray(i + 10, i + 2 + len));
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const h = b.readUInt16BE(i + 5), w = b.readUInt16BE(i + 7);
        return turned ? { w: h, h: w, alpha: false } : { w, h, alpha: false };
      }
      i += 2 + len;
    }
  }
  return null;
}
/** True when the EXIF orientation says the picture is shown turned by 90° (values 5–8). */
function exifTurned(t: Buffer): boolean {
  if (t.length < 8) return false;
  const le = t.toString("latin1", 0, 2) === "II";
  const u16 = (o: number) => (le ? t.readUInt16LE(o) : t.readUInt16BE(o));
  const u32 = (o: number) => (le ? t.readUInt32LE(o) : t.readUInt32BE(o));
  const ifd = u32(4);
  if (ifd + 2 > t.length) return false;
  const n = u16(ifd);
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > t.length) break;
    if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 5 && v <= 8; }
  }
  return false;
}
/** Pages of a PDF: page objects, or the page tree's /Count when pages sit in compressed object streams. */
export function pdfPages(b: Buffer): number {
  const s = b.toString("latin1");
  const objects = (s.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
  let count = 0;
  for (const m of s.matchAll(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)|\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages/g)) count = Math.max(count, +(m[1] ?? m[2] ?? 0));
  return Math.max(objects, count);
}

/* ---------------- the figures ---------------- */

export type LifeSource = {
  now: number;
  entries: DiskEntry[];
  versions: Record<string, { revision: number; size: number; at: string }[]>;
  folders: string[];
  folderStyles: Record<string, { color?: string; pinned?: boolean }>;
  folderActions: { at: string; action: string; folder: string; destination?: string; files?: number }[];
  fileActions: { id: string; before: { name: string; folder: string }; after: { name: string; folder: string }; at: string }[];
  deletedFolders: { root: string; paths: string[]; at: string }[];
  trashDays: number;
  usedBytes: number;
  docs: Map<string, DocProbe>;
  images: Map<string, ImageProbe>;
};

const KINDS: [string, RegExp][] = [
  ["image", /^(png|jpe?g|webp|gif|avif|bmp|svg|heic|ico)$/], ["video", /^(mp4|webm|mov|m4v|mkv|avi)$/], ["audio", /^(mp3|wav|ogg|m4a|flac|aac|opus)$/],
  ["pdf", /^pdf$/], ["doc", /^(docx?|odt|rtf|pages)$/], ["sheet", /^(xlsx?|ods|numbers|tsv)$/], ["slides", /^(pptx?|odp|key)$/],
  ["text", /^(txt|md|log|csv|ini|cfg|conf|srt)$/], ["code", /^(ts|tsx|js|jsx|mjs|cjs|py|json|html?|css|scss|xml|ya?ml|sh|bat|ps1|sql|go|rs|java|c|cpp|h|cs|php|rb)$/],
  ["archive", /^(zip|7z|rar|tar|gz|tgz|bz2|xz)$/],
];
export const extOf = (name: string) => (name.includes(".") ? name.split(".").pop()!.toLowerCase() : "");
export const kindOf = (name: string) => KINDS.find(([, re]) => re.test(extOf(name)))?.[0] ?? "other";
/** Documents whose words can be read here. */
export const readable = (name: string) => /^(pdf|docx|txt|md|log|csv)$/.test(extOf(name));
const picture = (name: string) => /^(png|jpe?g|gif|bmp|webp)$/.test(extOf(name));

const DAY = 86_400_000;
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const WEEKDAYS_FULL = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];
const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const MONTHS_FULL = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU");
const dec = (n: number) => (Math.round(n * 10) / 10).toLocaleString("ru-RU");
const pct = (part: number, whole: number) => (whole ? Math.round((100 * part) / whole) : 0);
export function bytes(b: number): string {
  if (b < 1024) return Math.round(b) + " Б";
  if (b < 1048576) return (b / 1024).toFixed(b < 10240 ? 1 : 0).replace(".", ",") + " КБ";
  if (b < 1073741824) return (b / 1048576).toFixed(1).replace(".", ",") + " МБ";
  return (b / 1073741824).toFixed(2).replace(".", ",") + " ГБ";
}
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(Math.round(n)) % 100, b = a % 10;
  return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
}
const nDays = (n: number) => `${fmt(n)} ${plural(n, "день", "дня", "дней")}`;
const nFiles = (n: number) => `${fmt(n)} ${plural(n, "файл", "файла", "файлов")}`;
const dayKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const dayStart = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const dateText = (t: number) => new Date(t).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
const shortDate = (t: number) => new Date(t).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
function ago(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 1) return "только что";
  if (m < 60) return `${m} мин назад`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ч назад`;
  return `${nDays(Math.round(h / 24))} назад`;
}
const top = <T,>(m: Map<T, number>) => [...m].sort((a, b) => b[1] - a[1])[0];
const tally = <T,>(xs: T[]) => { const m = new Map<T, number>(); for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1); return m; };
const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]!; };
const leaf = (folder: string) => folder ? folder.split("/").pop()! : "Главная";

/** Counts per day for the last `n` days, oldest first. */
function perDay(times: number[], now: number, n: number): number[] {
  const out = Array.from({ length: n }, () => 0), today = dayStart(now);
  for (const t of times) { const i = n - 1 - Math.round((today - dayStart(t)) / DAY); if (i >= 0 && i < n) out[i]!++; }
  return out;
}
/** Sums per calendar month for the last `n` months, oldest first, with short month labels. */
function perMonth(points: { t: number; v: number }[], now: number, n: number): { series: number[]; labels: string[] } {
  const d = new Date(now), series = Array.from({ length: n }, () => 0), labels: string[] = [];
  for (let i = n - 1; i >= 0; i--) { const m = new Date(d.getFullYear(), d.getMonth() - i, 1); labels.push(MONTHS[m.getMonth()]!); }
  for (const p of points) { const x = new Date(p.t); const i = n - 1 - ((d.getFullYear() - x.getFullYear()) * 12 + d.getMonth() - x.getMonth()); if (i >= 0 && i < n) series[i]! += p.v; }
  return { series, labels };
}
/** A running total over time sampled into at most 24 points (for growth lines). */
function growth(points: { t: number; v: number }[]): number[] {
  if (!points.length) return [];
  const s = [...points].sort((a, b) => a.t - b.t);
  if (s.length === 1) return [0, s[0]!.v];
  const t0 = s[0]!.t, t1 = s.at(-1)!.t, n = 24, out: number[] = [];
  let acc = 0, j = 0;
  for (let i = 0; i < n; i++) { const edge = t0 + ((t1 - t0) * i) / (n - 1); while (j < s.length && s[j]!.t <= edge) acc += s[j++]!.v; out.push(acc); }
  return out;
}
/** Weekly counts over the last `n` weeks, oldest first. */
function perWeek(times: number[], now: number, n: number): number[] {
  const out = Array.from({ length: n }, () => 0), today = dayStart(now);
  for (const t of times) { const i = n - 1 - Math.floor((today - dayStart(t)) / (7 * DAY)); if (i >= 0 && i < n) out[i]!++; }
  return out;
}
const weekLabels = (n: number) => Array.from({ length: n }, (_, i) => (i === n - 1 ? "эта неделя" : `${n - 1 - i} нед. назад`));

export function buildLife(src: LifeSource): DiskLife {
  const { now } = src;
  const out: LifeMetric[] = [];
  const add = (group: string, id: string, icon: string, title: string, hint: string, value: string | null, extra: Partial<LifeMetric> = {}, why = "пока не из чего считать") =>
    out.push(value === null ? { id, group, icon, title, hint: why, value: "—", empty: true } : { id, group, icon, title, hint, value, ...extra });

  const active = src.entries.filter((e) => !e.deletedAt), trash = src.entries.filter((e) => e.deletedAt);
  const activeBytes = active.reduce((n, e) => n + e.size, 0);
  const history = (e: DiskEntry) => [...(src.versions[e.id] ?? []).map((v) => ({ at: Date.parse(v.at), size: v.size })), { at: Date.parse(e.uploadedAt), size: e.size }].filter((v) => Number.isFinite(v.at)).sort((a, b) => a.at - b.at);
  const born = (e: DiskEntry) => history(e)[0] ?? { at: Date.parse(e.uploadedAt), size: e.size };
  const uploads = src.entries.map((e) => ({ e, t: born(e).at, size: born(e).size })).filter((u) => Number.isFinite(u.t) && u.t <= now + DAY);
  const times = uploads.map((u) => u.t);
  const activeBorn = active.map((e) => ({ e, t: born(e).at })).filter((x) => Number.isFinite(x.t));

  /* ---- Сердце Диска ---- */
  const sizes = active.map((e) => e.size);
  const versionBytes = Object.entries(src.versions).reduce((n, [, h]) => n + h.reduce((m, v) => m + v.size, 0), 0);
  const trashBytes = trash.reduce((n, e) => n + e.size, 0);
  const recent30 = activeBorn.filter((x) => x.t >= now - 30 * DAY).length;
  add("core", "files", "stack", "Файлов на Диске", "столько лежит сейчас, без корзины", fmt(active.length),
    { kind: "line", series: growth(activeBorn.map((x) => ({ t: x.t, v: 1 }))), detail: recent30 ? `+${fmt(recent30)} за 30 дней` : "за 30 дней новых нет" });
  add("core", "used", "drive", "Занято всего", "файлы, старые редакции и корзина", bytes(src.usedBytes),
    { kind: "split", series: [activeBytes, versionBytes, trashBytes], labels: ["файлы", "редакции", "корзина"] });
  const buckets = [0, 0, 0, 0, 0];
  for (const s of sizes) buckets[s < 10240 ? 0 : s < 102400 ? 1 : s < 1048576 ? 2 : s < 10485760 ? 3 : 4]!++;
  add("core", "median", "scale", "Типичный файл", "медиана: половина файлов меньше", sizes.length ? bytes(median(sizes)) : null,
    { kind: "spark", series: buckets, labels: ["до 10 КБ", "10–100 КБ", "0,1–1 МБ", "1–10 МБ", "от 10 МБ"] }, "файлов пока нет");
  const monthAvg = perMonth(activeBorn.map((x) => ({ t: x.t, v: x.e.size })), now, 12), monthCnt = perMonth(activeBorn.map((x) => ({ t: x.t, v: 1 })), now, 12);
  add("core", "average", "average", "Средний размер", "по месяцам загрузки за год", sizes.length ? bytes(activeBytes / sizes.length) : null,
    { kind: "spark", series: monthAvg.series.map((v, i) => (monthCnt.series[i] ? Math.round(v / monthCnt.series[i]!) : 0)), labels: monthAvg.labels }, "файлов пока нет");
  const biggest = [...active].sort((a, b) => b.size - a.size)[0];
  add("core", "biggest", "whale", "Самый крупный файл", biggest ? biggest.name : "", biggest ? bytes(biggest.size) : null,
    { ring: activeBytes ? biggest!.size / activeBytes : 0, detail: "доля от всех файлов" }, "файлов пока нет");
  const big = active.filter((e) => e.size >= 10485760);
  add("core", "big", "weight", "Крупные файлы", "от 10 МБ, доля в объёме", nFiles(big.length),
    { ring: activeBytes ? big.reduce((n, e) => n + e.size, 0) / activeBytes : 0 });
  const exts = tally(active.map((e) => extOf(e.name)).filter(Boolean));
  const extTop = [...exts].sort((a, b) => b[1] - a[1]);
  add("core", "exts", "puzzle", "Разных расширений", extTop[0] ? `чаще всего .${extTop[0][0]}` : "", exts.size ? fmt(exts.size) : null,
    { kind: "split", series: extTop.slice(0, 5).map((x) => x[1]), labels: extTop.slice(0, 5).map((x) => "." + x[0]) }, "файлов пока нет");
  const smallest = [...active].sort((a, b) => a.size - b.size)[0];
  add("core", "smallest", "feather", "Самый лёгкий файл", smallest?.name ?? "", smallest ? bytes(smallest.size) : null, {}, "файлов пока нет");
  const firstT = times.length ? Math.min(...times) : now;
  const weeksAlive = Math.max(1, (now - firstT) / (7 * DAY));
  add("core", "pace", "speed", "Скорость наполнения", "файлов в неделю за всю жизнь Диска", times.length ? dec(uploads.length / weeksAlive) : null,
    { kind: "spark", series: perWeek(times, now, 12), labels: weekLabels(12) }, "загрузок ещё не было");
  const steps = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
  const goal = steps.find((s) => s > active.length) ?? active.length + 1;
  const perDayPace = uploads.length / Math.max(1, (now - firstT) / DAY);
  const eta = perDayPace > 0 ? Math.ceil((goal - active.length) / perDayPace) : 0;
  add("core", "milestone", "flag", `До ${fmt(goal)} файлов`, eta ? `при нынешнем темпе — около ${nDays(eta)}` : "темп пока неизвестен",
    `осталось ${fmt(goal - active.length)}`, { ring: active.length / goal });

  /* ---- Типы файлов ---- */
  const KIND_NAMES: [string, string, string][] = [["image", "Изображения", "image"], ["video", "Видео", "film"], ["audio", "Аудио", "music"], ["pdf", "PDF", "pdf"],
    ["doc", "Документы Word", "doc"], ["sheet", "Таблицы", "grid"], ["slides", "Презентации", "slides"], ["text", "Текст и заметки", "text"], ["code", "Код и данные", "code"], ["archive", "Архивы", "zip"]];
  for (const [k, title, ic] of KIND_NAMES) {
    const xs = activeBorn.filter((x) => kindOf(x.e.name) === k);
    const b = xs.reduce((n, x) => n + x.e.size, 0);
    const m = perMonth(xs.map((x) => ({ t: x.t, v: 1 })), now, 6);
    add("kinds", "kind_" + k, ic, title, `${bytes(b)} · ${pct(b, activeBytes)}% объёма`, fmt(xs.length),
      { ring: active.length ? xs.length / active.length : 0, kind: "spark", series: m.series, labels: m.labels });
  }

  /* ---- Пульс загрузок ---- */
  const days = tally(times.map(dayKey));
  const week = perDay(times, now, 7);
  add("pulse", "week", "bolt", "За неделю", "загрузок за последние 7 дней", fmt(week.reduce((a, b) => a + b, 0)),
    { kind: "spark", series: week, labels: week.map((_, i) => WEEKDAYS[(new Date(now - (6 - i) * DAY).getDay() + 6) % 7]!) });
  const month = perDay(times, now, 30);
  add("pulse", "month", "wave", "За 30 дней", "загрузок за месяц по дням", fmt(month.reduce((a, b) => a + b, 0)),
    { kind: "spark", series: month, labels: month.map((_, i) => shortDate(now - (29 - i) * DAY)) });
  const activeDays30 = month.filter(Boolean).length;
  add("pulse", "activedays", "calendarCheck", "Дней с загрузками", "из последних 30", `${activeDays30} из 30`, { ring: activeDays30 / 30 });
  let streak = 0;
  for (let i = days.has(dayKey(now)) ? 0 : 1; days.has(dayKey(now - i * DAY)); i++) streak++;
  const sortedDays = [...days.keys()].sort();
  let best = 0, run = 0, prev = 0;
  for (const k of sortedDays) { const t = Date.parse(k + "T12:00:00"); run = prev && Math.round((t - prev) / DAY) === 1 ? run + 1 : 1; best = Math.max(best, run); prev = t; }
  add("pulse", "streak", "flame", "Серия дней подряд", best ? `рекорд — ${nDays(best)}` : "загрузок ещё не было", nDays(streak), { kind: "dots", series: [streak] });
  const recordDay = top(days);
  add("pulse", "record", "trophy", "Рекорд за день", recordDay ? dateText(Date.parse(recordDay[0] + "T12:00:00")) : "", recordDay ? nFiles(recordDay[1]) : null,
    { kind: "spark", series: perWeek(times, now, 12), labels: weekLabels(12) }, "загрузок ещё не было");
  const hours = Array.from({ length: 24 }, () => 0);
  for (const t of times) hours[new Date(t).getHours()]!++;
  const hBest = hours.indexOf(Math.max(...hours));
  add("pulse", "hours", "clock", "Любимый час", "в какое время суток вы загружаете", times.length ? `${hBest}:00–${hBest + 1}:00` : null, { kind: "hours", series: hours }, "загрузок ещё не было");
  const wd = Array.from({ length: 7 }, () => 0);
  for (const t of times) wd[(new Date(t).getDay() + 6) % 7]!++;
  add("pulse", "weekday", "weekday", "Любимый день недели", "загрузки по дням недели", times.length ? WEEKDAYS_FULL[wd.indexOf(Math.max(...wd))]! : null,
    { kind: "spark", series: wd, labels: WEEKDAYS }, "загрузок ещё не было");
  const gaps: { d: number; from: string; to: string }[] = [];
  for (let i = 1; i < sortedDays.length; i++) gaps.push({ d: Math.round((Date.parse(sortedDays[i]! + "T12:00:00") - Date.parse(sortedDays[i - 1]! + "T12:00:00")) / DAY) - 1, from: sortedDays[i - 1]!, to: sortedDays[i]! });
  const longGap = [...gaps].sort((a, b) => b.d - a.d)[0];
  add("pulse", "pause", "pause", "Самая долгая пауза", longGap ? `${shortDate(Date.parse(longGap.from))} → ${shortDate(Date.parse(longGap.to))}` : "", longGap ? nDays(longGap.d) : null,
    { kind: "spark", series: gaps.slice(-12).map((g) => g.d), labels: gaps.slice(-12).map((g) => `до ${shortDate(Date.parse(g.to))}`) }, "нужно хотя бы два дня с загрузками");
  add("pulse", "perday", "beat", "Файлов за активный день", "в среднем, когда вы что-то загружаете", days.size ? dec(uploads.length / days.size) : null,
    { kind: "spark", series: sortedDays.slice(-14).map((k) => days.get(k)!), labels: sortedDays.slice(-14).map((k) => shortDate(Date.parse(k + "T12:00:00"))) }, "загрузок ещё не было");
  const startCal = dayStart(now) - (((new Date(now).getDay() + 6) % 7) + 7 * 11) * DAY;
  const cal = perDay(times, now, Math.round((dayStart(now) - startCal) / DAY) + 1);
  add("pulse", "calendar", "heat", "Календарь 12 недель", "каждая клетка — день, ярче — больше загрузок", `${nDays(cal.filter(Boolean).length)} с загрузками`, { kind: "calendar", series: cal });

  /* ---- Машина времени ---- */
  add("time", "age", "hourglass", "Возраст Диска", times.length ? `первая загрузка — ${dateText(firstT)}` : "", times.length ? nDays(Math.floor((now - firstT) / DAY)) : null,
    { kind: "line", series: growth(uploads.map((u) => ({ t: u.t, v: u.size }))), detail: "рост объёма загрузок" }, "загрузок ещё не было");
  const ages = activeBorn.map((x) => (now - x.t) / DAY);
  const ageB = [0, 0, 0, 0, 0];
  for (const a of ages) ageB[a < 7 ? 0 : a < 30 ? 1 : a < 90 ? 2 : a < 365 ? 3 : 4]!++;
  add("time", "avgage", "sandclock", "Средний возраст файла", "сколько дней файлы уже лежат", ages.length ? nDays(ages.reduce((a, b) => a + b, 0) / ages.length) : null,
    { kind: "spark", series: ageB, labels: ["до недели", "до месяца", "до 3 мес", "до года", "старше года"] }, "файлов пока нет");
  const oldest = [...activeBorn].sort((a, b) => a.t - b.t)[0], newest = [...activeBorn].sort((a, b) => b.t - a.t)[0];
  add("time", "oldest", "fossil", "Старожил", oldest ? `с ${dateText(oldest.t)}` : "", oldest ? oldest.e.name : null, oldest ? { detail: nDays((now - oldest.t) / DAY) + " на Диске" } : {}, "файлов пока нет");
  add("time", "newest", "seedling", "Новичок", newest ? ago(now - newest.t) : "", newest ? newest.e.name : null, {}, "файлов пока нет");
  const old90 = ages.filter((a) => a >= 90).length;
  add("time", "old90", "leaf", "Старше трёх месяцев", "файлы, которые лежат 90 дней и больше", nFiles(old90), { ring: ages.length ? old90 / ages.length : 0 });
  const year = perMonth(uploads.map((u) => ({ t: u.t, v: 1 })), now, 12);
  const monthsAll = tally(times.map((t) => { const d = new Date(t); return d.getFullYear() * 12 + d.getMonth(); }));
  const bestMonth = top(monthsAll);
  add("time", "bestmonth", "crown", "Месяц-рекорд", bestMonth ? nFiles(bestMonth[1]) : "", bestMonth ? `${MONTHS_FULL[bestMonth[0] % 12]} ${Math.floor(bestMonth[0] / 12)}` : null,
    { kind: "spark", series: year.series, labels: year.labels }, "загрузок ещё не было");
  const added30 = uploads.filter((u) => u.t >= now - 30 * DAY);
  add("time", "grow30", "trend", "Прирост за 30 дней", "сколько места добавили за месяц", "+" + bytes(added30.reduce((n, u) => n + u.size, 0)),
    { kind: "line", series: (() => { const s = perDay([], now, 30); for (const u of added30) { const i = 29 - Math.round((dayStart(now) - dayStart(u.t)) / DAY); if (i >= 0) s[i]! += u.size; } let acc = 0; return s.map((v) => (acc += v)); })() });
  const thisM = year.series.at(-1) ?? 0, prevM = year.series.at(-2) ?? 0;
  add("time", "vsmonth", "compare", "Этот месяц и прошлый", `${fmt(thisM)} против ${fmt(prevM)}`, thisM === prevM ? "поровну" : (thisM > prevM ? "+" : "−") + fmt(Math.abs(thisM - prevM)),
    { kind: "spark", series: [prevM, thisM], labels: ["прошлый", "этот"] });
  const parts = [0, 0, 0, 0];
  for (const t of times) { const h = new Date(t).getHours(); parts[h >= 5 && h < 12 ? 0 : h >= 12 && h < 17 ? 1 : h >= 17 && h < 23 ? 2 : 3]!++; }
  const PARTS = ["утро", "день", "вечер", "ночь"];
  add("time", "dayparts", "sunmoon", "Время суток", "когда появляются файлы", times.length ? PARTS[parts.indexOf(Math.max(...parts))]! : null,
    { kind: "split", series: parts, labels: PARTS }, "загрузок ещё не было");
  const yNow = new Date(now).getFullYear(), mNow = new Date(now).getMonth();
  const thisYear = perMonth(uploads.filter((u) => new Date(u.t).getFullYear() === yNow).map((u) => ({ t: u.t, v: 1 })), now, mNow + 1);
  add("time", "thisyear", "calendarYear", `В ${yNow} году`, "загрузок с января", fmt(thisYear.series.reduce((a, b) => a + b, 0)), { kind: "spark", series: thisYear.series, labels: thisYear.labels });

  /* ---- Папки ---- */
  const byFolder = new Map<string, DiskEntry[]>();
  for (const e of active) { const l = byFolder.get(e.folder) ?? []; l.push(e); byFolder.set(e.folder, l); }
  const folderRows = [...byFolder].map(([f, xs]) => ({ f, n: xs.length, b: xs.reduce((s, e) => s + e.size, 0) }));
  const byBytes = [...folderRows].sort((a, b) => b.b - a.b), byCount = [...folderRows].sort((a, b) => b.n - a.n);
  add("folders", "fbytes", "folderWeight", "Самая объёмная папка", byBytes[0] ? bytes(byBytes[0].b) : "", byBytes[0] ? leaf(byBytes[0].f) : null,
    { kind: "split", series: byBytes.slice(0, 5).map((r) => r.b), labels: byBytes.slice(0, 5).map((r) => leaf(r.f)) }, "файлов пока нет");
  add("folders", "fcount", "folderFull", "Самая населённая папка", byCount[0] ? nFiles(byCount[0].n) : "", byCount[0] ? leaf(byCount[0].f) : null,
    { kind: "split", series: byCount.slice(0, 5).map((r) => r.n), labels: byCount.slice(0, 5).map((r) => leaf(r.f)) }, "файлов пока нет");
  const used = new Set(active.map((e) => e.folder));
  const emptyF = src.folders.filter((f) => !used.has(f) && ![...used].some((u) => u.startsWith(f + "/")));
  add("folders", "fempty", "folderEmpty", "Пустые папки", emptyF.length ? emptyF.slice(0, 3).map(leaf).join(", ") : "все папки при деле", fmt(emptyF.length),
    { ring: src.folders.length ? emptyF.length / src.folders.length : 0 });
  const depths = src.folders.map((f) => f.split("/").length);
  const maxDepth = Math.max(0, ...depths);
  add("folders", "depth", "tree", "Глубина дерева", "уровней вложенности", maxDepth ? `${maxDepth} ${plural(maxDepth, "уровень", "уровня", "уровней")}` : null,
    { kind: "spark", series: Array.from({ length: maxDepth }, (_, i) => depths.filter((d) => d === i + 1).length), labels: Array.from({ length: maxDepth }, (_, i) => `${i + 1}-й уровень`) }, "папок пока нет");
  const inFolders = active.filter((e) => e.folder).length;
  add("folders", "sorted", "sorted", "Разложено по папкам", `${fmt(active.length - inFolders)} лежат в корне`, active.length ? pct(inFolders, active.length) + "%" : null, { ring: active.length ? inFolders / active.length : 0 }, "файлов пока нет");
  const nonEmpty = folderRows.filter((r) => r.f);
  add("folders", "perfolder", "layers", "Файлов в папке", "в среднем в непустой папке", nonEmpty.length ? dec(inFolders / nonEmpty.length) : null,
    { kind: "spark", series: byCount.filter((r) => r.f).slice(0, 10).map((r) => r.n), labels: byCount.filter((r) => r.f).slice(0, 10).map((r) => leaf(r.f)) }, "папок с файлами пока нет");
  const pinned = src.folders.filter((f) => src.folderStyles[f]?.pinned);
  add("folders", "pinned", "pin", "Закреплённые папки", pinned.length ? pinned.slice(0, 3).map(leaf).join(", ") : "закрепите важные папки в дереве", fmt(pinned.length),
    { ring: src.folders.length ? pinned.length / src.folders.length : 0 });
  const colors = src.folders.map((f) => src.folderStyles[f]?.color ?? "").filter((c) => /^#[0-9a-f]{3,6}$/i.test(c));
  add("folders", "fcolors", "palette", "Цветные папки", colors.length ? `${new Set(colors).size} разных цветов` : "цвет папки меняется в её меню", fmt(colors.length),
    { kind: "swatches", list: [...new Set(colors)].slice(0, 24) });
  const created = src.folderActions.filter((a) => a.action === "create").map((a) => Date.parse(a.at));
  add("folders", "fnew", "folderPlus", "Новые папки за месяц", "по журналу папок", fmt(created.filter((t) => t >= now - 30 * DAY).length),
    { kind: "spark", series: perWeek(created, now, 8), labels: weekLabels(8) });
  add("folders", "ftrash", "folderX", "Папки в корзине", src.deletedFolders.length ? "их можно вернуть из корзины" : "удалённых папок нет", fmt(src.deletedFolders.length),
    { kind: "dots", series: [src.deletedFolders.length] });

  /* ---- Движение и порядок ---- */
  const renames = src.fileActions.filter((a) => a.before.name !== a.after.name).map((a) => Date.parse(a.at));
  const moves = src.fileActions.filter((a) => a.before.folder !== a.after.folder);
  add("moves", "renames", "rename", "Переименования файлов", "по журналу последних действий", fmt(renames.length), { kind: "spark", series: perWeek(renames, now, 8), labels: weekLabels(8) });
  add("moves", "moved", "move", "Перемещения файлов", "из папки в папку", fmt(moves.length), { kind: "spark", series: perWeek(moves.map((a) => Date.parse(a.at)), now, 8), labels: weekLabels(8) });
  const wander = top(tally(src.fileActions.map((a) => a.id)));
  const wanderName = wander ? (src.entries.find((e) => e.id === wander[0])?.name ?? src.fileActions.filter((a) => a.id === wander[0]).at(-1)!.after.name) : "";
  add("moves", "wanderer", "compass", "Самый кочующий файл", wander ? `${fmt(wander[1])} ${plural(wander[1], "перемена", "перемены", "перемен")} имени или места` : "", wander ? wanderName : null, {}, "файлы ещё не переименовывали и не переносили");
  const dest = [...tally(moves.map((a) => a.after.folder))].sort((a, b) => b[1] - a[1]);
  add("moves", "dest", "target", "Куда переносите чаще", dest[0] ? `${nFiles(dest[0][1])} перенесено сюда` : "", dest[0] ? leaf(dest[0][0]) : null,
    { kind: "split", series: dest.slice(0, 4).map((d) => d[1]), labels: dest.slice(0, 4).map((d) => leaf(d[0])) }, "файлы ещё не переносили");
  const ACTION: Record<string, string> = { create: "создание", rename: "переименование", style: "оформление", copy: "копирование", restore: "возврат", trash: "удаление" };
  const acts = [...tally(src.folderActions.map((a) => a.action))].sort((a, b) => b[1] - a[1]);
  add("moves", "factions", "folderGear", "Действия с папками", acts[0] ? `чаще всего — ${ACTION[acts[0][0]] ?? acts[0][0]}` : "", fmt(src.folderActions.length),
    { kind: "split", series: acts.map((a) => a[1]), labels: acts.map((a) => ACTION[a[0]] ?? a[0]) });
  const lastAct = Math.max(0, ...src.fileActions.map((a) => Date.parse(a.at)), ...src.folderActions.map((a) => Date.parse(a.at)));
  add("moves", "lastorder", "broom", "Последний порядок", lastAct ? dateText(lastAct) : "", lastAct ? ago(now - lastAct) : null, {}, "порядок ещё не наводили");
  const copies = src.folderActions.filter((a) => a.action === "copy");
  add("moves", "fcopy", "copy", "Скопировано папок", copies.length ? `с ними ${nFiles(copies.reduce((n, a) => n + (a.files ?? 0), 0))}` : "копий папок не было", fmt(copies.length), { kind: "dots", series: [copies.length] });
  const frenames = src.folderActions.filter((a) => a.action === "rename");
  add("moves", "frename", "folderPen", "Переименовано папок", frenames.at(-1) ? `последней — «${leaf(frenames.at(-1)!.destination ?? frenames.at(-1)!.folder)}»` : "папки не переименовывали", fmt(frenames.length), { kind: "dots", series: [frenames.length] });
  const restored = src.folderActions.filter((a) => a.action === "restore");
  add("moves", "frestore", "undo", "Возвращено папок", "из корзины обратно", fmt(restored.length), { kind: "dots", series: [restored.length] });
  const journal = [...src.fileActions, ...src.folderActions].map((a) => ({ t: Date.parse(a.at), v: 1 })).filter((x) => Number.isFinite(x.t));
  add("moves", "journal", "journal", "Журнал порядка", "все записанные действия с файлами и папками", fmt(journal.length), { kind: "line", series: growth(journal) });

  /* ---- Редакции ---- */
  const revised = active.filter((e) => (src.versions[e.id]?.length ?? 0) > 0);
  const revTimes = active.flatMap((e) => history(e).slice(1).map((h) => h.at));
  add("versions", "revised", "versions", "Файлы с редакциями", "заменялись новой версией", fmt(revised.length), { ring: active.length ? revised.length / active.length : 0 });
  add("versions", "revcount", "stackUp", "Сохранено редакций", "старых версий можно вернуть", fmt(Object.values(src.versions).reduce((n, h) => n + h.length, 0)),
    { kind: "spark", series: perWeek(revTimes, now, 8), labels: weekLabels(8) });
  const most = [...revised].sort((a, b) => (src.versions[b.id]?.length ?? 0) - (src.versions[a.id]?.length ?? 0))[0];
  add("versions", "mostrev", "pen", "Чаще всех переписывали", most ? `${fmt(src.versions[most.id]!.length + 1)} ${plural(src.versions[most.id]!.length + 1, "редакция", "редакции", "редакций")}` : "", most?.name ?? null, {}, "новых версий файлов ещё не было");
  add("versions", "revbytes", "archive", "Вес старых редакций", "сколько места занимает история", bytes(versionBytes), { ring: src.usedBytes ? versionBytes / src.usedBytes : 0 });
  const rev30 = perDay(revTimes, now, 30);
  add("versions", "rev30", "refresh", "Правки за 30 дней", "новые версии за месяц", fmt(rev30.reduce((a, b) => a + b, 0)), { kind: "spark", series: rev30, labels: rev30.map((_, i) => shortDate(now - (29 - i) * DAY)) });
  const lastRev = revised.map((e) => ({ e, t: history(e).at(-1)!.at })).sort((a, b) => b.t - a.t)[0];
  add("versions", "lastrev", "sparkPen", "Последняя правка", lastRev?.e.name ?? "", lastRev ? ago(now - lastRev.t) : null, {}, "новых версий файлов ещё не было");
  const changes = revised.map((e) => { const h = history(e); return h[0]!.size ? (h.at(-1)!.size - h[0]!.size) / h[0]!.size : 0; });
  const medChange = median(changes);
  add("versions", "growth", "resize", "Как меняется размер", "медиана: от первой версии к нынешней", changes.length ? (medChange >= 0 ? "+" : "−") + Math.abs(Math.round(medChange * 100)) + "%" : null,
    { kind: "spark", series: [changes.filter((c) => c < -0.05).length, changes.filter((c) => Math.abs(c) <= 0.05).length, changes.filter((c) => c > 0.05).length], labels: ["похудели", "почти как были", "выросли"] }, "новых версий файлов ещё не было");
  const nearLimit = active.filter((e) => (src.versions[e.id]?.length ?? 0) >= 15);
  add("versions", "limit", "gauge", "Близко к лимиту", "15+ из 20 возможных редакций", fmt(nearLimit.length), { ring: revised.length ? nearLimit.length / revised.length : 0 });
  add("versions", "perfile", "rows", "Редакций на файл", "в среднем у изменённых", revised.length ? dec(revised.reduce((n, e) => n + src.versions[e.id]!.length + 1, 0) / revised.length) : null,
    { kind: "spark", series: [2, 3, 4, 5].map((k) => revised.filter((e) => Math.min(5, src.versions[e.id]!.length + 1) === k).length), labels: ["2", "3", "4", "5 и больше"] }, "новых версий файлов ещё не было");
  let jump: { name: string; d: number } | null = null;
  for (const e of revised) { const h = history(e); for (let i = 1; i < h.length; i++) { const d = h[i]!.size - h[i - 1]!.size; if (!jump || Math.abs(d) > Math.abs(jump.d)) jump = { name: e.name, d }; } }
  add("versions", "jump", "jump", "Самая крупная правка", jump?.name ?? "", jump ? (jump.d >= 0 ? "+" : "−") + bytes(Math.abs(jump.d)) : null, {}, "новых версий файлов ещё не было");

  /* ---- Избранное и метки ---- */
  const favs = active.filter((e) => e.favorite);
  const favBytes = favs.reduce((n, e) => n + e.size, 0);
  add("marks", "favs", "star", "В избранном", `${bytes(favBytes)} · ${pct(favBytes, activeBytes)}% объёма`, fmt(favs.length), { ring: active.length ? favs.length / active.length : 0 });
  const tags = [...tally(active.flatMap((e) => e.tags ?? []))].sort((a, b) => b[1] - a[1]);
  add("marks", "tags", "tag", "Меток в ходу", tags[0] ? `чаще всего «${tags[0][0]}»` : "метки ставятся в сведениях о файле", fmt(tags.length),
    { kind: "split", series: tags.slice(0, 5).map((t) => t[1]), labels: tags.slice(0, 5).map((t) => t[0]) });
  const tagged = active.filter((e) => e.tags?.length);
  add("marks", "tagged", "tags", "Файлы с метками", "хотя бы одна метка", fmt(tagged.length), { ring: active.length ? tagged.length / active.length : 0 });
  const noted = active.filter((e) => e.note?.trim());
  add("marks", "notes", "note", "Файлы с заметкой", "своя пометка к файлу", fmt(noted.length), { ring: active.length ? noted.length / active.length : 0 });
  const fileColors = active.map((e) => e.color ?? "").filter((c) => /^#[0-9a-f]{3,6}$/i.test(c));
  add("marks", "filecolors", "drop", "Цветные отметки", fileColors.length ? `${new Set(fileColors).size} разных цветов` : "цвет ставится в сведениях о файле", fmt(fileColors.length),
    { kind: "swatches", list: [...new Set(fileColors)].slice(0, 24) });
  const oldFav = favs.map((e) => ({ e, t: born(e).at })).sort((a, b) => a.t - b.t)[0];
  add("marks", "oldfav", "medal", "Старейшее избранное", oldFav?.e.name ?? "", oldFav ? nDays((now - oldFav.t) / DAY) : null, {}, "избранного пока нет");
  const favFolders = [...tally(favs.map((e) => e.folder))].sort((a, b) => b[1] - a[1]);
  add("marks", "treasury", "chest", "Папка-сокровищница", favFolders[0] ? `${fmt(favFolders[0][1])} в избранном` : "", favFolders[0] ? leaf(favFolders[0][0]) : null,
    { kind: "split", series: favFolders.slice(0, 4).map((f) => f[1]), labels: favFolders.slice(0, 4).map((f) => leaf(f[0])) }, "избранного пока нет");
  const described = active.filter((e) => e.favorite || e.tags?.length || e.note?.trim() || e.color);
  add("marks", "cards", "idcard", "Подписанные файлы", "есть звезда, метка, заметка или цвет", active.length ? pct(described.length, active.length) + "%" : null, { ring: active.length ? described.length / active.length : 0 }, "файлов пока нет");
  add("marks", "pertag", "hash", "Меток на файл", "в среднем у отмеченных", tagged.length ? dec(tagged.reduce((n, e) => n + e.tags!.length, 0) / tagged.length) : null,
    { kind: "spark", series: [1, 2, 3, 4].map((k) => tagged.filter((e) => Math.min(4, e.tags!.length) === k).length), labels: ["1", "2", "3", "4 и больше"] }, "меток пока нет");
  const favKinds = [...tally(favs.map((e) => KIND_NAMES.find(([k]) => k === kindOf(e.name))?.[1] ?? "другое"))].sort((a, b) => b[1] - a[1]);
  add("marks", "favkinds", "heartFile", "Что вы любите", favKinds[0] ? `больше всего — ${favKinds[0][0].toLocaleLowerCase("ru-RU")}` : "", favKinds[0] ? favKinds[0][0] : null,
    { kind: "split", series: favKinds.slice(0, 4).map((k) => k[1]), labels: favKinds.slice(0, 4).map((k) => k[0]) }, "избранного пока нет");

  /* ---- Здоровье и чистота ---- */
  const bySha = [...tally(active.map((e) => e.sha256))].filter(([, n]) => n > 1);
  const dupExtra = bySha.reduce((n, [sha, k]) => n + (active.find((e) => e.sha256 === sha)!.size * (k - 1)), 0);
  add("health", "dups", "twins", "Точные копии", bySha.length ? `${nFiles(bySha.reduce((n, [, k]) => n + k, 0))} в ${fmt(bySha.length)} ${plural(bySha.length, "группе", "группах", "группах")}` : "копий нет — чисто", fmt(bySha.length),
    { kind: "dots", series: [bySha.length] });
  add("health", "free", "freeSpace", "Можно освободить", "если оставить по одной копии", bytes(dupExtra), { ring: activeBytes ? dupExtra / activeBytes : 0 });
  const names = [...tally(active.map((e) => e.name.toLocaleLowerCase("ru-RU")))].filter(([, n]) => n > 1);
  add("health", "namesakes", "namesakes", "Тёзки", names[0] ? `например, «${active.find((e) => e.name.toLocaleLowerCase("ru-RU") === names[0]![0])!.name}»` : "все имена разные", nFiles(names.reduce((n, [, k]) => n + k, 0)), { kind: "dots", series: [names.length] });
  const noExt = active.filter((e) => !extOf(e.name));
  add("health", "noext", "question", "Без расширения", noExt[0] ? `например, «${noExt[0].name}»` : "у всех файлов есть тип", fmt(noExt.length), { ring: active.length ? noExt.length / active.length : 0 });
  const sneaky = active.filter((e) => /\.(exe|js|bat|cmd|scr|vbs|ps1|msi)\.(txt|pdf|jpe?g|png|docx?)$/i.test(e.name) || /\.(txt|pdf|jpe?g|png|docx?)\.(exe|js|bat|cmd|scr|vbs|ps1|msi)$/i.test(e.name));
  add("health", "sneaky", "mask", "Двойные расширения", sneaky.length ? "так иногда маскируют программы" : "подозрительных имён нет", fmt(sneaky.length), { kind: "list", list: sneaky.slice(0, 3).map((e) => e.name) });
  const trashT = trash.map((e) => Date.parse(e.deletedAt!)).filter(Number.isFinite);
  add("health", "trash", "trash", "В корзине", bytes(trashBytes), nFiles(trash.length), { kind: "spark", series: perWeek(trashT, now, 8), labels: weekLabels(8) });
  add("health", "autoclean", "timer", "Автоочистка корзины", src.trashDays ? "файлы старше этого срока удаляются сами" : "корзина хранит всё, пока вы её не очистите",
    src.trashDays ? `через ${nDays(src.trashDays)}` : "выключена", src.trashDays ? { ring: Math.min(1, src.trashDays / 365) } : {});
  const soon = src.trashDays ? trash.filter((e) => now - Date.parse(e.deletedAt!) >= (src.trashDays - 3) * DAY) : [];
  add("health", "soon", "alarm", "Скоро исчезнут", src.trashDays ? "из корзины в ближайшие 3 дня" : "автоочистка выключена", nFiles(soon.length), { ring: trash.length ? soon.length / trash.length : 0 });
  const uniqueSha = new Set(active.map((e) => e.sha256)).size;
  add("health", "unique", "fingerprint", "Уникальное содержимое", "файлов без точной копии", active.length ? pct(uniqueSha, active.length) + "%" : null, { ring: active.length ? uniqueSha / active.length : 0 }, "файлов пока нет");
  const longTrash = trash.map((e) => ({ e, d: (now - Date.parse(e.deletedAt!)) / DAY })).sort((a, b) => b.d - a.d)[0];
  add("health", "longtrash", "ghost", "Дольше всех в корзине", longTrash?.e.name ?? "", longTrash ? nDays(longTrash.d) : null, {}, "корзина пуста");

  /* ---- text from documents ---- */
  const docs = active.filter((e) => readable(e.name)).map((e) => ({ e, p: src.docs.get(e.id) })).filter((x): x is { e: DiskEntry; p: DocProbe } => !!x.p);
  const read = docs.filter((x) => x.p.text && x.p.text.words > 0) as { e: DiskEntry; p: DocProbe & { text: TextStats } }[];
  const eligible = active.filter((e) => readable(e.name)).length;
  const scans = docs.filter((x) => x.p.scan).length;
  const sum = (f: (t: TextStats) => number) => read.reduce((n, x) => n + f(x.p.text), 0);
  const noText = eligible ? "в документах пока нет текста, который можно прочитать" : "нет документов PDF, DOCX, TXT или MD";
  const W = sum((t) => t.words), C = sum((t) => t.chars);
  const tx = (v: string | null) => (read.length ? v : null);

  /* ---- Слова и страницы ---- */
  add("words", "read", "glasses", "Прочитано документов", scans ? `PDF-сканов без текста: ${fmt(scans)}` : "PDF, DOCX, TXT и MD", eligible ? `${fmt(read.length)} из ${fmt(eligible)}` : null,
    { ring: eligible ? read.length / eligible : 0 }, "нет документов PDF, DOCX, TXT или MD");
  const byWords = [...read].sort((a, b) => b.p.text.words - a.p.text.words);
  add("words", "words", "words", "Слов в документах", "во всех прочитанных", tx(fmt(W)),
    { kind: "spark", series: byWords.slice(0, 10).map((x) => x.p.text.words), labels: byWords.slice(0, 10).map((x) => x.e.name) }, noText);
  const kindChars = ["pdf", "doc", "text"].map((k) => read.filter((x) => kindOf(x.e.name) === k).reduce((n, x) => n + x.p.text.chars, 0));
  add("words", "chars", "type", "Знаков", "с пробелами", tx(fmt(C)), { kind: "split", series: kindChars, labels: ["PDF", "Word", "текст"] }, noText);
  const pages = C / 1800;
  add("words", "pages", "pages", "Страниц текста", "по 1 800 знаков — стандартная страница", tx(fmt(Math.max(1, pages))), { kind: "dots", series: [Math.max(1, Math.round(pages))] }, noText);
  const minutes = W / 200;
  add("words", "reading", "readTime", "Время чтения", "при скорости 200 слов в минуту", tx(minutes < 60 ? `${fmt(Math.max(1, minutes))} мин` : `${fmt(Math.floor(minutes / 60))} ч ${fmt(minutes % 60)} мин`),
    { kind: "spark", series: byWords.slice(0, 10).map((x) => Math.max(1, Math.round(x.p.text.words / 200))), labels: byWords.slice(0, 10).map((x) => `${x.e.name}, мин`) }, noText);
  add("words", "longest", "scroll", "Самый длинный документ", byWords[0] ? `${fmt(byWords[0].p.text.words)} слов` : "", tx(byWords[0]?.e.name ?? ""), { ring: W ? (byWords[0]?.p.text.words ?? 0) / W : 0, detail: "доля всех слов" }, noText);
  const wb = [0, 0, 0, 0, 0];
  for (const x of read) { const w = x.p.text.words; wb[w < 300 ? 0 : w < 1000 ? 1 : w < 3000 ? 2 : w < 10000 ? 3 : 4]!++; }
  add("words", "avgdoc", "ruler", "Средний документ", "слов в одном документе", tx(fmt(W / Math.max(1, read.length))), { kind: "spark", series: wb, labels: ["до 300", "300–1000", "1–3 тыс.", "3–10 тыс.", "больше 10 тыс."] }, noText);
  const P = sum((t) => t.paragraphs);
  add("words", "paragraphs", "paragraph", "Абзацев", `в среднем ${dec(W / Math.max(1, P))} слов в абзаце`, tx(fmt(P)), { kind: "dots", series: [P] }, noText);
  const S = sum((t) => t.sentences);
  add("words", "sentences", "quoteMark", "Предложений", `в среднем ${dec(S / Math.max(1, read.length))} на документ`, tx(fmt(S)),
    { kind: "spark", series: byWords.slice(0, 10).map((x) => x.p.text.sentences), labels: byWords.slice(0, 10).map((x) => x.e.name) }, noText);
  const sl = [0, 1, 2, 3, 4].map((i) => sum((t) => t.sentLen[i]!));
  add("words", "sentlen", "meter", "Длина предложения", "слов в среднем", tx(dec(W / Math.max(1, S))), { kind: "spark", series: sl, labels: ["до 5 слов", "6–10", "11–20", "21–30", "больше 30"] }, noText);

  /* ---- Язык и стиль ---- */
  const withSttr = read.filter((x) => x.p.text.sttr > 0);
  add("style", "richness", "gem", "Словарное богатство", "разных слов среди первой тысячи слов документа", withSttr.length ? Math.round((100 * withSttr.reduce((n, x) => n + x.p.text.sttr, 0)) / withSttr.length) + "%" : null,
    { ring: withSttr.length ? withSttr.reduce((n, x) => n + x.p.text.sttr, 0) / withSttr.length : 0 }, read.length ? "нужен документ хотя бы на 50 слов" : noText);
  const terms = new Map<string, number>();
  for (const x of read) for (const [t, n] of x.p.text.terms) terms.set(t, (terms.get(t) ?? 0) + n);
  const topTerms = [...terms].sort((a, b) => b[1] - a[1]).slice(0, 5);
  add("style", "topwords", "heartWord", "Любимые слова", "чаще всего встречаются", tx(topTerms[0]?.[0] ?? "—"), { kind: "list", list: topTerms.map(([t, n]) => `${t} · ${fmt(n)}`) }, noText);
  const lw = read.map((x) => ({ w: x.p.text.longestWord, n: x.e.name })).sort((a, b) => b.w.length - a.w.length)[0];
  add("style", "longword", "longWord", "Самое длинное слово", lw ? `${lw.w.length} букв · ${lw.n}` : "", tx(lw?.w ?? ""), {}, noText);
  const wl = Array.from({ length: 13 }, (_, i) => sum((t) => t.wordLen[i]!));
  add("style", "wordlen", "letters", "Средняя длина слова", "букв в слове", tx(dec(sum((t) => t.letters) / Math.max(1, sum((t) => t.letterWords)))),
    { kind: "spark", series: wl, labels: wl.map((_, i) => (i === 12 ? "13+ букв" : `${i + 1} ${plural(i + 1, "буква", "буквы", "букв")}`)) }, noText);
  const cyr = sum((t) => t.cyr), lat = sum((t) => t.lat), dig = sum((t) => t.digits);
  add("style", "alphabet", "alphabet", "Кириллица и латиница", "из каких знаков состоит текст", tx(cyr >= lat ? `${pct(cyr, cyr + lat)}% кириллицы` : `${pct(lat, cyr + lat)}% латиницы`),
    { kind: "split", series: [cyr, lat, dig], labels: ["кириллица", "латиница", "цифры"] }, noText);
  const Q = sum((t) => t.questions);
  add("style", "questions", "questionBubble", "Вопросы", `${dec((1000 * Q) / Math.max(1, W))} на тысячу слов`, tx(fmt(Q)), { kind: "spark", series: byWords.slice(0, 10).map((x) => x.p.text.questions), labels: byWords.slice(0, 10).map((x) => x.e.name) }, noText);
  const X = sum((t) => t.exclaims);
  add("style", "exclaims", "exclaim", "Восклицания", `${dec((1000 * X) / Math.max(1, W))} на тысячу слов`, tx(fmt(X)), { kind: "spark", series: byWords.slice(0, 10).map((x) => x.p.text.exclaims), labels: byWords.slice(0, 10).map((x) => x.e.name) }, noText);
  const ls = read.map((x) => ({ n: x.p.text.longestSentence, name: x.e.name })).sort((a, b) => b.n - a.n)[0];
  add("style", "longsent", "snake", "Самое длинное предложение", ls?.name ?? "", tx(`${fmt(ls?.n ?? 0)} знаков`), {}, noText);
  const N = sum((t) => t.numbers);
  add("style", "numbers", "digits", "Чисел в тексте", `${dec((1000 * N) / Math.max(1, W))} на тысячу слов`, tx(fmt(N)), { ring: W + N ? N / (W + N) : 0 }, noText);
  const E = sum((t) => t.ellipses);
  add("style", "ellipses", "dots", "Многоточия…", "недосказанность в цифрах", tx(fmt(E)), { kind: "dots", series: [E] }, noText);

  /* ---- Что внутри текста ---- */
  const domains = [...tally(read.flatMap((x) => x.p.text.urls))].sort((a, b) => b[1] - a[1]);
  add("inside", "urls", "link", "Ссылки", domains[0] ? `чаще всего ${domains[0][0]}` : "ссылок в тексте нет", tx(fmt(sum((t) => t.urls.length))), { kind: "list", list: domains.slice(0, 3).map(([d, n]) => `${d} · ${fmt(n)}`) }, noText);
  const emails = new Set(read.flatMap((x) => x.p.text.emails));
  add("inside", "emails", "mail", "Адреса почты", "разных адресов", tx(fmt(emails.size)), { kind: "dots", series: [emails.size] }, noText);
  const phones = new Set(read.flatMap((x) => x.p.text.phones));
  add("inside", "phones", "phone", "Телефоны", "разных номеров", tx(fmt(phones.size)), { kind: "dots", series: [phones.size] }, noText);
  const yearsT = tally(read.flatMap((x) => x.p.text.years).filter((y) => y >= 1900 && y <= yNow + 10));
  const ys = [...yearsT.keys()].sort((a, b) => a - b).slice(-10);
  add("inside", "dates", "calendarDate", "Даты", ys.length ? `чаще всего ${top(yearsT)![0]} год` : "найденные даты по годам", tx(fmt(sum((t) => t.dates))), { kind: "spark", series: ys.map((y) => yearsT.get(y)!), labels: ys.map(String) }, noText);
  add("inside", "money", "coins", "Суммы с валютой", "₽, руб., $, € и другие", tx(fmt(sum((t) => t.money))), { kind: "spark", series: byWords.slice(0, 10).map((x) => x.p.text.money), labels: byWords.slice(0, 10).map((x) => x.e.name) }, noText);
  add("inside", "percents", "percent", "Проценты", "числа со знаком %", tx(fmt(sum((t) => t.percents))), { kind: "spark", series: byWords.slice(0, 10).map((x) => x.p.text.percents), labels: byWords.slice(0, 10).map((x) => x.e.name) }, noText);
  add("inside", "headings", "heading", "Заголовки", "строки Markdown с #", tx(fmt(sum((t) => t.headings))), { kind: "dots", series: [sum((t) => t.headings)] }, noText);
  add("inside", "bullets", "list", "Пункты списков", "строки с маркером или номером", tx(fmt(sum((t) => t.bullets))), { kind: "dots", series: [sum((t) => t.bullets)] }, noText);
  add("inside", "quotes", "quote", "Цитаты в кавычках", "«…» и “…”", tx(fmt(sum((t) => t.quotes))), { kind: "dots", series: [sum((t) => t.quotes)] }, noText);
  add("inside", "tables", "table", "Строки таблиц", "в CSV и текстовых таблицах", tx(fmt(sum((t) => t.tableRows))), { kind: "dots", series: [sum((t) => t.tableRows)] }, noText);

  /* ---- Связи документов ---- */
  const sets = read.map((x) => ({ e: x.e, set: new Set(x.p.text.terms.slice(0, 200).map(([t]) => t)) })).filter((x) => x.set.size >= 5);
  const links: { a: DiskEntry; b: DiskEntry; score: number }[] = [];
  for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) {
    const A = sets[i]!, B = sets[j]!;
    if (A.e.sha256 === B.e.sha256) continue;
    let shared = 0;
    for (const w of A.set) if (B.set.has(w)) shared++;
    const score = Math.round((100 * shared) / Math.max(1, A.set.size + B.set.size - shared));
    if (score >= 20 && shared >= 5) links.push({ a: A.e, b: B.e, score });
  }
  links.sort((x, y) => y.score - x.score);
  const lk = (v: string | null) => (sets.length >= 2 ? v : null);
  const noLinks = sets.length >= 2 ? "" : read.length ? "нужно хотя бы два прочитанных документа" : noText;
  add("links", "pairs", "chain", "Связанные пары", "документы с общими словами (от 20%)", lk(fmt(links.length)),
    { kind: "spark", series: [links.filter((l) => l.score < 40).length, links.filter((l) => l.score >= 40 && l.score < 60).length, links.filter((l) => l.score >= 60 && l.score < 80).length, links.filter((l) => l.score >= 80).length], labels: ["20–39%", "40–59%", "60–79%", "80–100%"] }, noLinks);
  const strong = links.filter((l) => l.score >= 60);
  add("links", "strong", "magnet", "Сильные связи", "общих слов 60% и больше", lk(fmt(strong.length)), { ring: links.length ? strong.length / links.length : 0 }, noLinks);
  add("links", "closest", "handshake", "Самая близкая пара", links[0] ? `${links[0].score}% общих слов` : "похожих документов нет", lk(links[0] ? `${links[0].a.name} ↔ ${links[0].b.name}` : "нет похожих"), { ring: (links[0]?.score ?? 0) / 100 }, noLinks);
  const degree = tally(links.flatMap((l) => [l.a.id, l.b.id]));
  const hub = top(degree);
  add("links", "hub", "hub", "Документ-узел", hub ? `${fmt(hub[1])} ${plural(hub[1], "связь", "связи", "связей")}` : "связей пока нет", lk(hub ? active.find((e) => e.id === hub[0])!.name : "нет связей"),
    { kind: "spark", series: [...degree.values()].sort((a, b) => b - a).slice(0, 10), labels: [...degree].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id]) => active.find((e) => e.id === id)?.name ?? "") }, noLinks);
  const parent = new Map<string, string>();
  const find = (x: string): string => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x)!)!); x = parent.get(x)!; } return x; };
  for (const l of links) { for (const id of [l.a.id, l.b.id]) if (!parent.has(id)) parent.set(id, id); parent.set(find(l.a.id), find(l.b.id)); }
  const islands = [...tally([...parent.keys()].map(find)).values()].sort((a, b) => b - a);
  add("links", "islands", "islands", "Тематические острова", islands.length ? `в самом большом — ${fmt(islands[0]!)} док.` : "островов пока нет", lk(fmt(islands.length)),
    { kind: "split", series: islands.slice(0, 5), labels: islands.slice(0, 5).map((_, i) => `остров ${i + 1}`) }, noLinks);
  const lonely = sets.filter((s) => !degree.has(s.e.id)).length;
  add("links", "lonely", "lonely", "Одиночки", "документы без похожих", lk(fmt(lonely)), { ring: sets.length ? lonely / sets.length : 0 }, noLinks);
  const cross = links.filter((l) => l.a.folder !== l.b.folder).length;
  add("links", "cross", "bridge", "Связи между папками", "похожие документы лежат в разных местах", lk(fmt(cross)), { ring: links.length ? cross / links.length : 0 }, noLinks);
  const df = tally(sets.flatMap((s) => [...new Set(read.find((x) => x.e.id === s.e.id)!.p.text.terms.map(([t]) => t))]));
  const common = top(df);
  add("links", "thread", "thread", "Сквозное слово", common ? `есть в ${fmt(common[1])} из ${fmt(sets.length)} документов` : "", lk(common?.[0] ?? "нет"),
    { ring: common && sets.length ? common[1] / sets.length : 0 }, noLinks);
  add("links", "avgscore", "percentRing", "Средняя близость", "у связанных пар", lk(links.length ? Math.round(links.reduce((n, l) => n + l.score, 0) / links.length) + "%" : "нет связей"),
    { ring: links.length ? links.reduce((n, l) => n + l.score, 0) / links.length / 100 : 0 }, noLinks);
  const possible = (sets.length * (sets.length - 1)) / 2;
  add("links", "density", "network", "Плотность сети", "связанных пар из всех возможных", lk(possible ? Math.round((100 * links.length) / possible) + "%" : "—"), { ring: possible ? links.length / possible : 0 }, noLinks);

  /* ---- Картинки и PDF ---- */
  const imgs = active.filter((e) => picture(e.name)).map((e) => ({ e, p: src.images.get(e.id) })).filter((x): x is { e: DiskEntry; p: ImageProbe } => !!x.p && x.p.w > 0 && x.p.h > 0);
  const noImg = active.some((e) => picture(e.name)) ? "размер снимков не удалось прочитать" : "картинок PNG, JPEG, GIF, WebP или BMP пока нет";
  const im = (v: string | null) => (imgs.length ? v : null);
  const orient = [imgs.filter((x) => x.p.w > x.p.h * 1.05).length, imgs.filter((x) => x.p.h > x.p.w * 1.05).length, 0];
  orient[2] = imgs.length - orient[0]! - orient[1]!;
  const ORI = ["горизонтальные", "вертикальные", "квадратные"];
  add("media", "orient", "orientation", "Ориентация снимков", "с учётом поворота из EXIF", im(ORI[orient.indexOf(Math.max(...orient))]!), { kind: "split", series: orient, labels: ORI }, noImg);
  const mp = (x: { p: ImageProbe }) => (x.p.w * x.p.h) / 1e6;
  const biggestImg = [...imgs].sort((a, b) => mp(b) - mp(a))[0];
  add("media", "bigimg", "mountain", "Самая большая картинка", biggestImg ? `${biggestImg.e.name} · ${dec(mp(biggestImg))} Мп` : "", im(biggestImg ? `${fmt(biggestImg.p.w)}×${fmt(biggestImg.p.h)}` : ""), {}, noImg);
  const MP = imgs.reduce((n, x) => n + mp(x), 0);
  add("media", "megapixels", "aperture", "Мегапикселей всего", "все снимки вместе", im(dec(MP)), { kind: "spark", series: [...imgs].sort((a, b) => mp(b) - mp(a)).slice(0, 10).map((x) => Math.round(mp(x) * 10) / 10), labels: [...imgs].sort((a, b) => mp(b) - mp(a)).slice(0, 10).map((x) => x.e.name) }, noImg);
  const mpb = [0, 0, 0, 0, 0];
  for (const x of imgs) { const v = mp(x); mpb[v < 1 ? 0 : v < 4 ? 1 : v < 12 ? 2 : v < 24 ? 3 : 4]!++; }
  add("media", "avgimg", "frame", "Средний снимок", "мегапикселей", im(dec(MP / Math.max(1, imgs.length)) + " Мп"), { kind: "spark", series: mpb, labels: ["до 1 Мп", "1–4", "4–12", "12–24", "больше 24"] }, noImg);
  const allPics = active.filter((e) => picture(e.name) || kindOf(e.name) === "image");
  const shots = allPics.filter((e) => /screen\s?shot|скриншот|снимок экрана|screen_?\d|^scr[_-]/i.test(e.name));
  add("media", "screens", "screen", "Скриншоты", "по названию файла", fmt(shots.length), { ring: allPics.length ? shots.length / allPics.length : 0 });
  const camera = allPics.filter((e) => /^(img|dsc|dscn|dscf|pxl|mvimg|photo)[_-]?\d|^\d{8}[_-]\d{6}/i.test(e.name));
  add("media", "camera", "camera", "Снимки с камеры", "IMG_, DSC_, PXL_ и похожие имена", fmt(camera.length), { ring: allPics.length ? camera.length / allPics.length : 0 });
  const alpha = imgs.filter((x) => x.p.alpha);
  add("media", "alpha", "transparent", "С прозрачностью", "PNG и WebP с прозрачным фоном", im(fmt(alpha.length)), { ring: imgs.length ? alpha.length / imgs.length : 0 }, noImg);
  const pdfs = active.filter((e) => kindOf(e.name) === "pdf").map((e) => ({ e, n: src.docs.get(e.id)?.pages ?? 0 })).filter((x) => x.n > 0);
  const noPdf = active.some((e) => kindOf(e.name) === "pdf") ? "страницы PDF не удалось посчитать" : "PDF-файлов пока нет";
  const pp = (v: string | null) => (pdfs.length ? v : null);
  const byPages = [...pdfs].sort((a, b) => b.n - a.n);
  add("media", "pdfpages", "book", "Страниц в PDF", `в ${fmt(pdfs.length)} ${plural(pdfs.length, "файле", "файлах", "файлах")}`, pp(fmt(pdfs.reduce((n, x) => n + x.n, 0))),
    { kind: "spark", series: byPages.slice(0, 10).map((x) => x.n), labels: byPages.slice(0, 10).map((x) => x.e.name) }, noPdf);
  add("media", "fatpdf", "thick", "Самый толстый PDF", byPages[0] ? `${fmt(byPages[0].n)} ${plural(byPages[0].n, "страница", "страницы", "страниц")}` : "", pp(byPages[0]?.e.name ?? ""), {}, noPdf);
  const pdfAll = active.filter((e) => kindOf(e.name) === "pdf").length;
  add("media", "scans", "scanner", "PDF-сканы", "без текстового слоя — только картинки", pdfAll ? fmt(scans) : null, { ring: pdfAll ? scans / pdfAll : 0 }, "PDF-файлов пока нет");

  /* ---- Забавные рекорды ---- */
  add("fun", "floppy", "floppy", "Дискет 3,5″", "столько понадобилось бы в 1995 году (1,44 МБ)", fmt(Math.ceil(src.usedBytes / 1474560)), { kind: "dots", series: [Math.ceil(src.usedBytes / 1474560)] });
  const ROUND = [100, 200, 365, 500, 730, 1000, 1095, 1461, 1500, 1826, 2000, 2500, 3000, 3653];
  const jubilee = activeBorn.map((x) => { const a = Math.floor((now - x.t) / DAY); const m = ROUND.find((r) => r > a); return m ? { e: x.e, m, left: m - a } : null; })
    .filter((x): x is { e: DiskEntry; m: number; left: number } => !!x).sort((a, b) => a.left - b.left)[0];
  const ageText = (d: number) => (d % 365 === 0 || d === 1461 || d === 1826 || d === 3653 ? `${Math.round(d / 365.25)} ${plural(Math.round(d / 365.25), "год", "года", "лет")}` : nDays(d));
  add("fun", "jubilee", "cake", "Ближайший юбилей", jubilee ? `${ageText(jubilee.m)} на Диске — через ${nDays(jubilee.left)}` : "", jubilee?.e.name ?? null, jubilee ? { ring: 1 - jubilee.left / jubilee.m } : {}, "файлов пока нет");
  const byName = [...active].sort((a, b) => b.name.length - a.name.length);
  add("fun", "longname", "longName", "Самое длинное название", byName[0] ? `${byName[0].name.length} знаков` : "", byName[0]?.name ?? null, {}, "файлов пока нет");
  const shortName = [...active].sort((a, b) => a.name.length - b.name.length)[0];
  add("fun", "shortname", "shortName", "Самое короткое название", shortName ? `${shortName.name.length} знаков` : "", shortName?.name ?? null, {}, "файлов пока нет");
  const dayBytes = new Map<string, number>();
  for (const u of uploads) dayBytes.set(dayKey(u.t), (dayBytes.get(dayKey(u.t)) ?? 0) + u.size);
  const heavyDay = top(dayBytes);
  add("fun", "heavyday", "truck", "Самый тяжёлый день", heavyDay ? dateText(Date.parse(heavyDay[0] + "T12:00:00")) : "", heavyDay ? bytes(heavyDay[1]) : null, {}, "загрузок ещё не было");
  const at = (f: (d: Date) => boolean) => times.filter((t) => f(new Date(t))).length;
  const owl = at((d) => d.getHours() < 5);
  add("fun", "owl", "owl", "Ночная сова", "загрузки с полуночи до 5 утра", fmt(owl), { ring: times.length ? owl / times.length : 0 });
  const lark = at((d) => d.getHours() >= 5 && d.getHours() < 8);
  add("fun", "lark", "sunrise", "Ранняя пташка", "загрузки с 5 до 8 утра", fmt(lark), { ring: times.length ? lark / times.length : 0 });
  const weekend = at((d) => d.getDay() === 0 || d.getDay() === 6);
  add("fun", "weekend", "beach", "Выходные", "доля загрузок в субботу и воскресенье", times.length ? pct(weekend, times.length) + "%" : null, { ring: times.length ? weekend / times.length : 0 }, "загрузок ещё не было");
  const friday = at((d) => d.getDay() === 5 && d.getHours() >= 17);
  add("fun", "friday", "party", "Пятничный вечер", "загрузки в пятницу после 17:00", fmt(friday), { ring: times.length ? friday / times.length : 0 });
  const busiestHourDay = top(tally(times.map((t) => dayKey(t) + " " + new Date(t).getHours())));
  add("fun", "burst", "rocket", "Самый жаркий час", busiestHourDay ? `${shortDate(Date.parse(busiestHourDay[0].slice(0, 10) + "T12:00:00"))}, ${busiestHourDay[0].slice(11)}:00` : "", busiestHourDay ? nFiles(busiestHourDay[1]) : null, {}, "загрузок ещё не было");

  const order = new Map(LIFE_GROUPS.map((g, i) => [g.id, i]));
  out.sort((a, b) => order.get(a.group)! - order.get(b.group)!);
  return {
    generatedAt: new Date(now).toISOString(), groups: LIFE_GROUPS, metrics: out,
    highlights: ["files", "used", "words", "activedays", "revcount", "pairs"],
    analysis: { documents: eligible, read: read.length, scans, unreadable: docs.filter((x) => x.p.unreadable).length, images: active.filter((e) => picture(e.name)).length, measured: imgs.length },
  };
}

/* ---------------- reading the files, with a cache by content ---------------- */

const cache = new Map<string, DocProbe | ImageProbe | null>();
const remember = <T extends DocProbe | ImageProbe | null>(key: string, v: T): T => {
  cache.set(key, v);
  if (cache.size > 6000) cache.delete(cache.keys().next().value!);
  return v;
};
async function head(file: string, n: number): Promise<Buffer> {
  const h = await open(file, "r");
  try { const b = Buffer.alloc(n); const { bytesRead } = await h.read(b, 0, n, 0); return b.subarray(0, bytesRead); } finally { await h.close(); }
}
/** Bytes of a file are read once per content: a second visit reuses the figures by SHA-256. */
async function probe(disk: LocalDisk, e: DiskEntry): Promise<{ doc?: DocProbe; image?: ImageProbe | null }> {
  const ext = extOf(e.name);
  if (readable(e.name)) {
    const key = "d:" + e.sha256 + ":" + ext;
    if (cache.has(key)) return { doc: cache.get(key) as DocProbe };
    const doc: DocProbe = { text: null };
    if (ext === "pdf") { try { doc.pages = pdfPages(await readFile(disk.rawFile(e.id).path)); } catch { /* counted as unknown */ } }
    try { const r = await disk.readText(e.id, 300 * 1024); doc.text = textStats(r.text, ext === "csv"); }
    catch (err) { if ((err as { status?: number }).status === 422 && ext === "pdf") doc.scan = true; else if ((err as { status?: number }).status !== 422) doc.unreadable = true; }
    if (ext === "pdf" && doc.text && doc.text.words < 5) { doc.scan = true; doc.text = null; }
    return { doc: remember(key, doc) };
  }
  if (picture(e.name)) {
    const key = "i:" + e.sha256;
    if (cache.has(key)) return { image: cache.get(key) as ImageProbe | null };
    let img: ImageProbe | null = null;
    try { img = imageSize(await head(disk.rawFile(e.id).path, /^jpe?g$/.test(ext) ? 1024 * 1024 : 64 * 1024)); } catch { img = null; }
    return { image: remember(key, img) };
  }
  return {};
}

let running: Promise<DiskLife> | null = null;
/** All 150 figures; documents and pictures are read at most once per content, newest first. */
export function collectLife(disk: LocalDisk, now = Date.now()): Promise<DiskLife> {
  if (running) return running;
  running = (async () => {
    const s = disk.lifeSource();
    const docs = new Map<string, DocProbe>(), images = new Map<string, ImageProbe>();
    const live = s.entries.filter((e) => !e.deletedAt).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    let d = 0, i = 0;
    for (const e of live) {
      const isDoc = readable(e.name), isImg = picture(e.name);
      if ((isDoc && d >= 500) || (isImg && i >= 3000) || (!isDoc && !isImg)) continue;
      if (isDoc) d++; else i++;
      const r = await probe(disk, e);
      if (r.doc) docs.set(e.id, r.doc);
      if (r.image) images.set(e.id, r.image);
    }
    return buildLife({ ...s, now, docs, images });
  })().finally(() => { running = null; });
  return running;
}
