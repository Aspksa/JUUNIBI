/** Pure helpers for the chat UI (commands, attachments, window geometry, export). Unit-tested in test/chat-helpers.test.ts. */
import type { Conversation } from "./chats";

// ---------- slash commands ----------
export type CommandId = "new" | "remember" | "memory" | "modules" | "update" | "settings" | "export" | "clear" | "scenes" | "help" | "brief" | "quick";
export interface Command { id: CommandId; names: string[]; hint: string; arg?: string; /** For owner-defined quick commands: the text that is sent. */ quick?: string }
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
  { id: "brief", names: ["сводка", "brief"], hint: "Сводка дня: напоминания, дела, что требует внимания" },
  { id: "help", names: ["помощь", "help"], hint: "Горячие клавиши и команды" },
];
/** What `/сводка` sends: the assistant answers from the daily_brief tool. */
export const BRIEF_PROMPT = "Сделай сводку дня: возьми данные из инструмента daily_brief и коротко расскажи, что требует моего внимания сегодня.";
/** Owner-defined quick commands ("/итоги") shown next to the built-in ones. */
export const quickToCommands = (list: { name: string; text: string }[]): Command[] =>
  list.map((q) => ({ id: "quick" as const, names: [q.name], hint: q.text.replace(/\s+/g, " ").slice(0, 70), quick: q.text }));

/** Words a quick command's text may contain; they are replaced when the command is sent. */
export const PLACEHOLDERS: [string, string][] = [["{дата}", "сегодняшняя дата"], ["{время}", "текущее время"], ["{день}", "день недели"], ["{буфер}", "текст из буфера обмена"]];
const pad = (n: number) => String(n).padStart(2, "0");
const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
/** Fills {дата}, {время}, {день} and {буфер} in a quick command's text. */
export function fillPlaceholders(text: string, o: { now: Date; clipboard?: string }): string {
  const d = o.now;
  return text.replace(/\{(дата|время|день|буфер)\}/giu, (_, w: string) => {
    switch (w.toLowerCase()) {
      case "дата": return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
      case "время": return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      case "день": return WEEKDAYS[d.getDay()]!;
      default: return (o.clipboard ?? "").trim();
    }
  });
}

/** `/запомни кофе без сахара` -> { command, arg }. Unknown commands return null (the text is sent as a normal message). */
export function parseCommand(input: string, extra: Command[] = []): { command: Command; arg: string } | null {
  const m = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(input.trim());
  if (!m) return null;
  const name = m[1]!.toLowerCase();
  const command = [...COMMANDS, ...extra].find((c) => c.names.includes(name));
  return command ? { command, arg: (m[2] ?? "").trim() } : null;
}
/** Palette entries for what the user is typing: only while the first word is still being typed. */
export function suggestCommands(input: string, extra: Command[] = []): Command[] {
  const m = /^\/(\S*)$/.exec(input);
  if (!m) return [];
  const q = m[1]!.toLowerCase();
  return [...COMMANDS, ...extra].filter((c) => c.names.some((n) => n.startsWith(q)));
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
const STEP_LABELS: Record<string, string> = { thinking: "Обдумываю ответ",
  list_modules: "Смотрю модули проекта", search_memory: "Ищу в памяти", remember: "Предлагаю запомнить", get_time: "Узнаю время",
  list_files: "Смотрю папку", read_file: "Читаю файл", search_files: "Ищу в файлах", write_file: "Записываю файл",
  web_search: "Ищу в интернете", web_open: "Читаю страницу", wiki_search: "Ищу в Википедии", wiki_read: "Читаю статью", list_notes: "Смотрю заметки", add_note: "Добавляю заметку", complete_todo: "Отмечаю дело",
  disk_find: "Ищу на Диске", disk_folders: "Смотрю папки Диска", disk_read: "Читаю файл с Диска", disk_save: "Сохраняю на Диск",
  list_reminders: "Смотрю напоминания", add_reminder: "Ставлю напоминание", cancel_reminder: "Отменяю напоминание", daily_brief: "Собираю сводку дня",
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

/** Compact, human-readable summary for the assistant tool timeline. */
export function actionSummary(steps: { name: string; status: "running" | "ok" | "error" | "denied" }[]): string {
  const current = steps.find((step) => step.status === "running");
  if (current) return stepLabel(current.name) + "…";
  const errors = steps.filter((step) => step.status === "error").length;
  const denied = steps.filter((step) => step.status === "denied").length;
  const completed = steps.filter((step) => step.status === "ok").length;
  if (errors) return `Действия ИИ · ошибок: ${errors}`;
  if (denied) return `Действия ИИ · отклонено: ${denied}`;
  return `Действия ИИ · готово: ${completed}`;
}

/** This is progress of *observed* steps, not a prediction of how much work remains. */
export function actionProgress(steps: { status: "running" | "ok" | "error" | "denied"; ms?: number }[]) {
  const total = steps.length;
  const done = steps.filter(step => step.status !== "running").length;
  const failed = steps.filter(step => step.status === "error" || step.status === "denied").length;
  const elapsed = steps.reduce((sum, step) => sum + (typeof step.ms === "number" && Number.isFinite(step.ms) && step.ms >= 0 ? step.ms : 0), 0);
  return { total, done, failed, elapsed, observedPercent: total ? Math.round(done / total * 100) : 0 };
}

// ---------- sources of an answer from the internet ----------
const WEB_TOOLS = new Set(["web_search", "web_open", "wiki_search", "wiki_read"]);
export interface Source { url: string; host: string; title: string }
/** Links in an answer that used the internet, as cards: markdown links first, then bare addresses; one per address. */
export function sourcesOf(content: string, tools: string[] | undefined, max = 6): Source[] {
  if (!tools?.some((t) => WEB_TOOLS.has(t))) return [];
  const out: Source[] = [];
  const seen = new Set<string>();
  const add = (url: string, title: string) => {
    const clean = url.replace(/[).,;:!?»"']+$/, "");
    let u: URL;
    try { u = new URL(clean); } catch { return; }
    if (!/^https?:$/.test(u.protocol) || seen.has(u.href)) return;
    seen.add(u.href);
    const host = u.hostname.replace(/^www\./, "");
    const path = decodeURIComponent(u.pathname).replace(/\/$/, "").split("/").pop()?.replace(/[_-]+/g, " ") ?? "";
    out.push({ url: u.href, host, title: (title.trim() && title.trim() !== clean ? title.trim() : path || host).slice(0, 90) });
  };
  for (const m of content.matchAll(/\[([^\]]{1,200})\]\((https?:\/\/[^)\s]+)\)/g)) add(m[2]!, m[1]!);
  for (const m of content.replace(/\[[^\]]*\]\([^)]*\)/g, " ").matchAll(/https?:\/\/[^\s<>()]+/g)) add(m[0], "");
  return out.slice(0, max);
}

// ---------- how much of the conversation the model still sees ----------
export const CONTEXT_BUDGET = 48_000;
export const CONTEXT_TURNS = 60;
export interface ContextInfo { used: number; budget: number; kept: number; total: number; dropped: number; percent: number }
/** Mirrors `recentContext`: the newest turns that fit the budget are sent, older ones are left out. */
export function contextInfo(turns: { content: string }[], budget = CONTEXT_BUDGET, maxTurns = CONTEXT_TURNS): ContextInfo {
  let used = 0, kept = 0;
  for (let i = turns.length - 1; i >= 0 && kept < maxTurns; i--) {
    const n = turns[i]!.content.length;
    if (used + n > budget) break;
    used += n; kept++;
  }
  const total = turns.length;
  const all = turns.reduce((n, t) => n + t.content.length, 0);
  return { used, budget, kept, total, dropped: total - kept, percent: Math.min(100, Math.round((total > kept ? 1 : all / budget) * 100)) };
}

// ---------- long messages, search snippets, files ----------
/** A message of the owner that is folded under «Показать целиком». */
export const isLongText = (text: string) => text.length > 900 || text.split("\n").length > 14;
/** A few words around the first match, for the search results in the history. */
export function snippetAround(text: string, q: string, radius = 36): { before: string; hit: string; after: string } | null {
  const flat = text.replace(/\s+/g, " ");
  const i = flat.toLowerCase().indexOf(q.toLowerCase());
  if (!q || i < 0) return null;
  const from = Math.max(0, i - radius), to = Math.min(flat.length, i + q.length + radius);
  return { before: (from > 0 ? "…" : "") + flat.slice(from, i), hit: flat.slice(i, i + q.length), after: flat.slice(i + q.length, to) + (to < flat.length ? "…" : "") };
}
/** Text -> base64 of its UTF-8 bytes (what the Disk upload takes). */
export function utf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
/** Number with spaces between thousands: 12 400. */
export const groupDigits = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
