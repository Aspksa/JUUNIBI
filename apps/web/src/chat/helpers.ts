/** Pure helpers for the chat UI (commands, attachments, window geometry, export). Unit-tested in test/chat-helpers.test.ts. */
import type { Conversation } from "./chats";

// ---------- slash commands ----------
export type CommandId = "new" | "remember" | "memory" | "modules" | "update" | "settings" | "export" | "clear" | "scenes" | "help";
export interface Command { id: CommandId; names: string[]; hint: string; arg?: string }
export const COMMANDS: Command[] = [
  { id: "new", names: ["новый", "new"], hint: "Начать новый чат" },
  { id: "remember", names: ["запомни", "remember"], hint: "Запомнить факт или предпочтение", arg: "текст" },
  { id: "memory", names: ["память", "memory"], hint: "Открыть раздел «Память»" },
  { id: "modules", names: ["модули", "modules"], hint: "Открыть раздел «Модули»" },
  { id: "update", names: ["обновления", "update"], hint: "Открыть раздел «Обновление»" },
  { id: "settings", names: ["настройки", "settings"], hint: "Открыть настройки" },
  { id: "export", names: ["экспорт", "export"], hint: "Сохранить чат в файл Markdown" },
  { id: "clear", names: ["очистить", "clear"], hint: "Очистить текущий чат" },
  { id: "scenes", names: ["сцены", "scenes"], hint: "Включить/выключить сцены персонажа" },
  { id: "help", names: ["помощь", "help"], hint: "Горячие клавиши и команды" },
];

/** `/запомни кофе без сахара` -> { command, arg }. Unknown commands return null (the text is sent as a normal message). */
export function parseCommand(input: string): { command: Command; arg: string } | null {
  const m = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(input.trim());
  if (!m) return null;
  const name = m[1]!.toLowerCase();
  const command = COMMANDS.find((c) => c.names.includes(name));
  return command ? { command, arg: (m[2] ?? "").trim() } : null;
}
/** Palette entries for what the user is typing: only while the first word is still being typed. */
export function suggestCommands(input: string): Command[] {
  const m = /^\/(\S*)$/.exec(input);
  if (!m) return [];
  const q = m[1]!.toLowerCase();
  return COMMANDS.filter((c) => c.names.some((n) => n.startsWith(q)));
}

// ---------- attachments ----------
export const MAX_FILES = 5;
export const MAX_FILE_BYTES = 100 * 1024;
export const MAX_TOTAL_BYTES = 250 * 1024;
const TEXT_EXT = new Set(["txt", "md", "markdown", "json", "csv", "tsv", "log", "js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "html", "htm", "css", "scss", "xml", "yml", "yaml", "toml", "ini", "cfg", "conf", "env", "sql", "sh", "bat", "ps1", "c", "h", "cpp", "hpp", "cs", "java", "kt", "go", "rs", "rb", "php", "swift", "lua", "r", "vue", "svelte", "tex", "srt", "gitignore"]);
export interface Attachment { name: string; size: number; text: string }

export function isTextFile(name: string, mime: string): boolean {
  if (/^text\//.test(mime) || /^application\/(json|xml|x-yaml|javascript|x-sh)/.test(mime)) return true;
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : name.toLowerCase();
  return TEXT_EXT.has(ext);
}
/** Binary files sneak in as "text" via wrong extensions; NUL bytes or many replacement characters give them away. */
export function looksBinary(text: string): boolean {
  if (text.includes("\u0000")) return true;
  const bad = (text.match(/�/g) ?? []).length;
  return text.length > 0 && bad / text.length > 0.02;
}
export interface Rejected { name: string; reason: string }
export function checkFile(f: { name: string; size: number; type: string }, have: Attachment[]): string | null {
  if (have.length >= MAX_FILES) return `не больше ${MAX_FILES} файлов`;
  if (!isTextFile(f.name, f.type)) return "поддерживаются только текстовые файлы и код";
  if (f.size === 0) return "файл пустой";
  if (f.size > MAX_FILE_BYTES) return `больше ${formatBytes(MAX_FILE_BYTES)}`;
  if (have.reduce((n, a) => n + a.size, 0) + f.size > MAX_TOTAL_BYTES) return `суммарно больше ${formatBytes(MAX_TOTAL_BYTES)}`;
  if (have.some((a) => a.name === f.name && a.size === f.size)) return "уже прикреплён";
  return null;
}
export function formatBytes(n: number): string {
  return n < 1024 ? `${n} Б` : n < 1024 * 1024 ? `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} КБ` : `${(n / 1048576).toFixed(1)} МБ`;
}
/** A Markdown fence longer than any backtick run inside, so a file can never break out of its block. */
export function fenceFor(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length));
  return "`".repeat(Math.max(3, longest + 1));
}
/** What the model receives: the typed text plus every file as a labelled code block. */
export function withFiles(text: string, files: Attachment[] | undefined): string {
  if (!files?.length) return text;
  const blocks = files.map((f) => { const fence = fenceFor(f.text); return `Файл «${f.name}» (${formatBytes(f.size)}):\n${fence}\n${f.text}\n${fence}`; });
  return [text.trim(), ...blocks].filter(Boolean).join("\n\n");
}

// ---------- tool steps ----------
const STEP_LABELS: Record<string, string> = {
  list_modules: "Смотрю модули проекта", search_memory: "Ищу в памяти", remember: "Предлагаю запомнить", get_time: "Узнаю время",
};
export const stepLabel = (name: string) => STEP_LABELS[name] ?? `Использую «${name}»`;

// ---------- window geometry ----------
export interface Rect { x: number; y: number; w: number; h: number }
export const MIN_W = 520;
export const MIN_H = 420;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
export function clampRect(r: Rect, vw: number, vh: number): Rect {
  const w = clamp(r.w, Math.min(MIN_W, vw), vw), h = clamp(r.h, Math.min(MIN_H, vh), vh);
  return { w, h, x: clamp(r.x, 0, vw - w), y: clamp(r.y, 0, vh - h) };
}
/** dir: any of "n" "s" "e" "w" combined (e.g. "nw"). Opposite edges stay put; the window never leaves the viewport or shrinks below the minimum. */
export function resizeRect(r: Rect, dir: string, dx: number, dy: number, vw: number, vh: number): Rect {
  let { x, y, w, h } = r;
  if (dir.includes("e")) w = clamp(r.w + dx, Math.min(MIN_W, vw), vw - r.x);
  if (dir.includes("s")) h = clamp(r.h + dy, Math.min(MIN_H, vh), vh - r.y);
  if (dir.includes("w")) { const right = r.x + r.w; w = clamp(r.w - dx, Math.min(MIN_W, vw), right); x = right - w; }
  if (dir.includes("n")) { const bottom = r.y + r.h; h = clamp(r.h - dy, Math.min(MIN_H, vh), bottom); y = bottom - h; }
  return { x, y, w, h };
}

// ---------- export ----------
export function chatToMarkdown(c: Conversation, now = new Date()): string {
  const out = [`# ${c.title}`, "", `_Экспорт JUUNIBI, ${now.toLocaleString("ru-RU")}_`, ""];
  for (const m of c.messages) {
    if (m.role === "note") { out.push(`> ${m.content}`, ""); continue; }
    out.push(`## ${m.role === "user" ? "Вы" : "JUUNIBI"}`, "");
    if (m.files?.length) out.push(...m.files.map((f) => `📎 ${f.name} (${formatBytes(f.size)})`), "");
    out.push(m.content || (m.error ? `_Ошибка: ${m.error}_` : ""), "");
  }
  return out.join("\n").trimEnd() + "\n";
}
export const safeFileName = (title: string) => (title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "chat") + ".md";

// ---------- read aloud ----------
/** Markdown -> plain sentence text for speech synthesis (code blocks are announced, not read). */
export function speechText(md: string, max = 4000): string {
  return md
    .replace(/(`{3,}|~{3,})[\s\S]*?(\1|$)/g, " Блок кода. ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/[*_~|]+/g, "")
    .replace(/https?:\/\/\S+/g, " ссылка ")
    .replace(/\s+/g, " ").trim().slice(0, max);
}

// ---------- sidebar & day separators ----------
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const dayDiff = (ts: number, now: Date) => Math.round((startOfDay(now) - startOfDay(new Date(ts))) / 86_400_000);
const shortDate = (ts: number) => new Date(ts).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }).replace(/\.$/, "");
/** Compact "how long ago" for the history list. */
export function relTime(ts: number, now = new Date()): string {
  const s = Math.max(0, (now.getTime() - ts) / 1000);
  if (s < 60) return "сейчас";
  if (s < 3600) return `${Math.floor(s / 60)} мин`;
  const d = dayDiff(ts, now);
  if (d <= 0 && s < 86_400) return `${Math.floor(s / 3600)} ч`;
  if (d === 1) return "вчера";
  if (d < 7) return new Date(ts).toLocaleDateString("ru-RU", { weekday: "short" });
  return shortDate(ts);
}
/** Label for the separator between days inside a conversation. */
export function dayLabel(ts: number, now = new Date()): string {
  const d = dayDiff(ts, now);
  if (d <= 0) return "Сегодня";
  if (d === 1) return "Вчера";
  const dt = new Date(ts);
  return dt.toLocaleDateString("ru-RU", { day: "numeric", month: "long", ...(dt.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}
export const sameDay = (a: number, b: number) => startOfDay(new Date(a)) === startOfDay(new Date(b));
/** One-line preview of a conversation for the sidebar. */
export function previewOf(messages: { role: string; content: string }[]): string {
  const last = [...messages].reverse().find((m) => m.role !== "note" && m.content.trim());
  if (!last) return "";
  const t = speechText(last.content, 80);
  return last.role === "user" ? `Вы: ${t}` : t;
}
