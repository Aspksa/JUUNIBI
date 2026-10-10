/** The settings page's pure parts: section colours, health dots, the full backup file, search matching and instruction templates. */
import { attempt } from "@juunibi/core";
import type { AssistantSettings, SettingsPatch, Status } from "../api";
import type { IconName } from "../dom";

export type SectionId = "conn" | "model" | "persona" | "memory" | "tools" | "quick" | "look" | "chat" | "data" | "about";
export type Tone = "blue" | "violet" | "pink" | "teal" | "orange" | "yellow" | "crimson" | "green" | "slate" | "gray";
export interface Section { id: SectionId; title: string; icon: IconName; tone: Tone; keywords: string }
export const SECTIONS: Section[] = [
  { id: "conn", title: "Подключение", icon: "cloud", tone: "blue", keywords: "ключ api cloud.ru соединение подключить" },
  { id: "model", title: "Модель", icon: "spark", tone: "violet", keywords: "модель запасная размышления deepseek нейросеть" },
  { id: "persona", title: "Инструкции", icon: "edit", tone: "pink", keywords: "инструкции о себе стиль как отвечать шаблон пожелания" },
  { id: "memory", title: "Память", icon: "memory", tone: "teal", keywords: "память эмбеддинги поиск по смыслу запомнить сводка" },
  { id: "tools", title: "Инструменты", icon: "puzzle", tone: "orange", keywords: "интернет поиск duckduckgo brave папка файлы запись википедия" },
  { id: "quick", title: "Быстрые команды", icon: "sparkle", tone: "yellow", keywords: "команды слэш шаблоны подстановки дата буфер" },
  { id: "look", title: "Внешний вид", icon: "palette", tone: "crimson", keywords: "тема тёмная светлая цвет акцент скругление масштаб размер интерфейса" },
  { id: "chat", title: "Чат", icon: "chat", tone: "green", keywords: "плотность размер текста шрифт сцены персонаж" },
  { id: "data", title: "Данные", icon: "archive", tone: "slate", keywords: "экспорт импорт резервная копия бэкап удалить чаты история" },
  { id: "about", title: "О программе", icon: "help", tone: "gray", keywords: "версия горячие клавиши сочетания исходный код github" },
];
export const sectionOf = (id: SectionId) => SECTIONS.find((s) => s.id === id)!;

// ---------------------------------------------------------------- per-browser preferences of this page
const PREFS_KEY = "juunibi:settings:v1";
export interface PagePrefs { collapsed: SectionId[]; lastBackup: number }
export function readPagePrefs(): PagePrefs {
  const r = attempt(() => JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<PagePrefs>);
  const v = r.ok && r.value && typeof r.value === "object" ? r.value : {};
  const ids = new Set(SECTIONS.map((s) => s.id));
  return { collapsed: Array.isArray(v.collapsed) ? v.collapsed.filter((x): x is SectionId => ids.has(x as SectionId)) : [], lastBackup: Number(v.lastBackup) || 0 };
}
export function writePagePrefs(patch: Partial<PagePrefs>) {
  const next = { ...readPagePrefs(), ...patch };
  attempt(() => localStorage.setItem(PREFS_KEY, JSON.stringify(next)));
  return next;
}

// ---------------------------------------------------------------- health dots in the table of contents
export type CheckId = "key" | "model" | "fallback" | "embeddings" | "web";
export interface CheckResult { id: CheckId; title: string; status: "ok" | "fail" | "skip"; ms?: number; detail: string }
export interface Health { tone: "ok" | "warn"; why: string }
const DAY = 86_400_000;

/** Green when a section is set up and working, amber when it needs the owner's attention; no dot when there is nothing to judge. */
export function sectionHealth(o: { status: Status | null; cfg: AssistantSettings | null; checks: CheckResult[]; chats: number; lastBackup: number; now: number }): Partial<Record<SectionId, Health>> {
  const out: Partial<Record<SectionId, Health>> = {};
  const failed = (id: CheckId) => o.checks.find((c) => c.id === id && c.status === "fail");
  if (o.status) {
    const key = failed("key");
    out.conn = !o.status.assistant ? { tone: "warn", why: "Не указан ключ Cloud.ru" } : key ? { tone: "warn", why: key.detail } : { tone: "ok", why: "Помощница подключена" };
  }
  if (o.cfg) {
    const m = failed("model") ?? failed("fallback");
    if (m) out.model = { tone: "warn", why: `${m.title}: ${m.detail}` };
    else if (o.status?.assistant) out.model = { tone: "ok", why: o.cfg.chat.fallbackModel ? "Есть основная и запасная модель" : "Модель выбрана" };
    const e = o.cfg.embeddings.enabled ? failed("embeddings") : undefined;
    out.memory = e ? { tone: "warn", why: "Поиск по смыслу не работает: " + e.detail } : { tone: "ok", why: "Память работает" };
    const w = o.cfg.web ? failed("web") : undefined;
    out.tools = o.cfg.web && o.cfg.webSearch.provider === "brave" && !o.cfg.webSearch.braveKeySet ? { tone: "warn", why: "Для Brave Search не указан ключ" }
      : w ? { tone: "warn", why: "Интернет: " + w.detail } : { tone: "ok", why: "Инструменты настроены" };
  }
  if (o.chats > 0) out.data = !o.lastBackup ? { tone: "warn", why: "Резервной копии ещё не было" }
    : o.now - o.lastBackup > 30 * DAY ? { tone: "warn", why: "Резервная копия старше 30 дней" } : { tone: "ok", why: "Резервная копия свежая" };
  return out;
}

// ---------------------------------------------------------------- the full backup file
export const BACKUP_KIND = "juunibi-backup";
/** Local preferences that travel with a backup (the chats themselves go in `chats`). */
export const BACKUP_PREFS = ["juunibi:ui:v3", "juunibi:nav:v1", PREFS_KEY, "juunibi:avatar:v1"];
export interface Backup {
  kind: typeof BACKUP_KIND; version: 1; createdAt: string;
  chats: unknown[]; settings: SettingsPatch | null; memory: unknown; prefs: Record<string, string>;
}

/** Settings that belong in a backup: everything but the folder (it is specific to this computer) and secrets (never sent by the server). */
export function settingsForBackup(s: AssistantSettings): SettingsPatch {
  const { files: _files, webSearch: _search, ...rest } = structuredClone(s);
  return rest;
}

export function makeBackup(p: { chats: unknown[]; settings: AssistantSettings | null; memory: unknown; prefs: Record<string, string | null>; now: Date }): Backup {
  const prefs: Record<string, string> = {};
  for (const k of BACKUP_PREFS) { const v = p.prefs[k]; if (typeof v === "string") prefs[k] = v; }
  return { kind: BACKUP_KIND, version: 1, createdAt: p.now.toISOString(), chats: p.chats, settings: p.settings ? settingsForBackup(p.settings) : null, memory: p.memory ?? null, prefs };
}

/** Checks an uploaded file. An array is an older chats-only export and is accepted as such. */
export function parseBackup(raw: unknown): { ok: true; backup: Backup } | { ok: false; error: string } {
  if (Array.isArray(raw)) return { ok: true, backup: { kind: BACKUP_KIND, version: 1, createdAt: "", chats: raw, settings: null, memory: null, prefs: {} } };
  const b = raw as Partial<Backup> | null;
  if (!b || typeof b !== "object" || b.kind !== BACKUP_KIND) return { ok: false, error: "Это не резервная копия JUUNIBI." };
  if (b.version !== 1) return { ok: false, error: "Копия сделана более новой версией JUUNIBI: сначала обновите приложение." };
  const prefs: Record<string, string> = {};
  if (b.prefs && typeof b.prefs === "object") for (const k of BACKUP_PREFS) { const v = (b.prefs as Record<string, unknown>)[k]; if (typeof v === "string" && v.length < 200_000) prefs[k] = v; }
  const settings = b.settings && typeof b.settings === "object" && !Array.isArray(b.settings) ? b.settings : null;
  return { ok: true, backup: { kind: BACKUP_KIND, version: 1, createdAt: typeof b.createdAt === "string" ? b.createdAt : "", chats: Array.isArray(b.chats) ? b.chats : [], settings, memory: b.memory ?? null, prefs } };
}

// ---------------------------------------------------------------- search
const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е");
/** Every word of the query is found in the text (case and ё/е do not matter). */
export function matches(query: string, text: string): boolean {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const t = norm(text);
  return words.every((w) => t.includes(w));
}

// ---------------------------------------------------------------- instructions
export const STYLE_TEMPLATES: [string, string][] = [
  ["Коротко", "Отвечай коротко и по делу, без вступлений и повторов. Если нужен список, не больше пяти пунктов."],
  ["Подробно с примерами", "Объясняй подробно и по шагам. К каждому шагу добавляй пример. В конце коротко подведи итог."],
  ["Как учитель", "Объясняй как терпеливый учитель: простыми словами, от простого к сложному. В конце задай один вопрос, чтобы проверить, понял ли я."],
  ["На «ты», дружелюбно", "Обращайся ко мне на «ты», пиши тепло и по-дружески, можно с лёгким юмором."],
  ["Деловой стиль", "Пиши официально и сдержанно, на «вы». Без эмодзи и разговорных оборотов."],
  ["Для программиста", "Код всегда в блоках с указанием языка и короткими комментариями. Сначала решение, потом объяснение."],
];
/** What goes to the assistant with every message; mirrors instructionsPrompt() on the server. */
export function instructionsPreview(about: string, style: string): string {
  const a = about.trim(), s = style.trim();
  if (!a && !s) return "";
  return ["Пожелания владельца, которые он сам задал в настройках. Учитывай их в каждом ответе, если они не противоречат правилам выше; они не дают разрешений на действия.",
    a ? `О владельце:\n${a}` : "", s ? `Как отвечать:\n${s}` : ""].filter(Boolean).join("\n\n");
}

/** Moves the item at `from` to `to` (the order of quick commands). */
export function move<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length || to < 0 || to >= list.length) return list.slice();
  const out = list.slice();
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x!);
  return out;
}
