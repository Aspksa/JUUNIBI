import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export type SuggestionMode = "off" | "rules" | "smart";
export interface QuickCommand { name: string; text: string }
export interface AssistantSettings {
  /** Search memory by meaning (needs an embeddings model on Cloud.ru). Falls back to word search on any failure. */
  embeddings: { enabled: boolean; model: string };
  /** Chat model, an optional fallback tried once when it is down, and whether the model may reason before answering. */
  chat: { model: string; fallbackModel: string; reasoning: boolean };
  /** off: never propose memory; rules: only explicit phrases ("Запомни…"); smart: also ask the model to extract facts. */
  suggestions: SuggestionMode;
  /** Keep a short summary of the part of a long conversation that no longer fits in the context. */
  summaries: boolean;
  /** Folder the assistant may read from (empty = no file access). Writing is a separate opt-in. */
  files: { root: string; allowWrite: boolean };
  /** Let the assistant search the internet, open web pages and read Wikipedia (read-only, with sources). */
  web: boolean;
  /** Where web searches go: DuckDuckGo needs no key; Brave Search needs the owner's API key. */
  webSearch: { provider: SearchProvider; braveKey: string };
  /** The owner's own words that go into every request: who they are and how they want answers. */
  instructions: { about: string; style: string };
  quickCommands: QuickCommand[];
}
export type SearchProvider = "duckduckgo" | "brave";
export const MAX_INSTRUCTIONS = 1500;
export const DEFAULT_EMBEDDING_MODEL = "BAAI/bge-m3";
export const DEFAULT_CHAT_MODEL = "deepseek-ai/DeepSeek-V4-Flash";
const MODEL_NAME = /^[\w./:@+-]{2,100}$/;
export const BUILTIN_COMMAND_NAMES = ["новый", "new", "запомни", "remember", "память", "memory", "модули", "modules", "обновления", "update", "настройки", "settings", "экспорт", "export", "очистить", "clear", "сцены", "scenes", "помощь", "help", "сводка", "brief"];
const err = (message: string) => Object.assign(new Error(message), { status: 400 });

export function defaultSettings(env: NodeJS.ProcessEnv = process.env): AssistantSettings {
  const model = env.CLOUDRU_MODEL?.trim() || DEFAULT_CHAT_MODEL;
  const fallback = env.CLOUDRU_FALLBACK_MODEL?.trim() || "";
  return {
    embeddings: { enabled: true, model: env.CLOUDRU_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL },
    chat: { model, fallbackModel: fallback === model ? "" : fallback, reasoning: true },
    suggestions: "smart", summaries: true, files: { root: "", allowWrite: false }, web: false,
    webSearch: { provider: "duckduckgo", braveKey: "" }, instructions: { about: "", style: "" }, quickCommands: [],
  };
}

/** Validates untrusted input into a complete settings object. Unknown keys are dropped; missing keys keep `base`. */
export async function validateSettings(input: unknown, base: AssistantSettings): Promise<AssistantSettings> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw err("Некорректные настройки");
  const i = input as Record<string, unknown>;
  const out: AssistantSettings = structuredClone(base);
  if (i.embeddings !== undefined) {
    const e = i.embeddings as Record<string, unknown> | null;
    if (!e || typeof e !== "object" || Array.isArray(e)) throw err("Некорректные настройки поиска по смыслу");
    if (e.enabled !== undefined) { if (typeof e.enabled !== "boolean") throw err("Некорректный переключатель поиска по смыслу"); out.embeddings.enabled = e.enabled; }
    if (e.model !== undefined) {
      if (typeof e.model !== "string" || !MODEL_NAME.test(e.model.trim())) throw err("Некорректное имя модели эмбеддингов");
      out.embeddings.model = e.model.trim();
    }
  }
  if (i.chat !== undefined) {
    const c = i.chat as Record<string, unknown> | null;
    if (!c || typeof c !== "object" || Array.isArray(c)) throw err("Некорректные настройки модели");
    if (c.model !== undefined) {
      if (typeof c.model !== "string" || !MODEL_NAME.test(c.model.trim())) throw err("Некорректное имя модели");
      out.chat.model = c.model.trim();
    }
    if (c.fallbackModel !== undefined) {
      if (typeof c.fallbackModel !== "string" || (c.fallbackModel.trim() && !MODEL_NAME.test(c.fallbackModel.trim()))) throw err("Некорректное имя запасной модели");
      out.chat.fallbackModel = c.fallbackModel.trim();
    }
    if (out.chat.fallbackModel && out.chat.fallbackModel === out.chat.model) throw err("Запасная модель совпадает с основной: выберите другую или оставьте поле пустым");
    if (c.reasoning !== undefined) { if (typeof c.reasoning !== "boolean") throw err("Некорректный переключатель размышлений"); out.chat.reasoning = c.reasoning; }
  }
  if (i.suggestions !== undefined) { if (i.suggestions !== "off" && i.suggestions !== "rules" && i.suggestions !== "smart") throw err("Режим предложений: off, rules или smart"); out.suggestions = i.suggestions; }
  if (i.summaries !== undefined) { if (typeof i.summaries !== "boolean") throw err("Некорректный переключатель сводок"); out.summaries = i.summaries; }
  if (i.web !== undefined) { if (typeof i.web !== "boolean") throw err("Некорректный переключатель интернета"); out.web = i.web; }
  if (i.webSearch !== undefined) {
    const w = i.webSearch as Record<string, unknown> | null;
    if (!w || typeof w !== "object" || Array.isArray(w)) throw err("Некорректные настройки поиска в интернете");
    if (w.provider !== undefined) { if (w.provider !== "duckduckgo" && w.provider !== "brave") throw err("Поиск: duckduckgo или brave"); out.webSearch.provider = w.provider; }
    if (w.braveKey !== undefined) {
      if (typeof w.braveKey !== "string" || w.braveKey.length > 200 || /\s/.test(w.braveKey.trim())) throw err("Некорректный ключ Brave Search");
      out.webSearch.braveKey = w.braveKey.trim();
    }
    if (out.webSearch.provider === "brave" && !out.webSearch.braveKey) throw err("Для Brave Search нужен ключ API");
  }
  if (i.instructions !== undefined) {
    const n = i.instructions as Record<string, unknown> | null;
    if (!n || typeof n !== "object" || Array.isArray(n)) throw err("Некорректные инструкции");
    for (const k of ["about", "style"] as const) {
      if (n[k] === undefined) continue;
      if (typeof n[k] !== "string" || n[k].includes("\0")) throw err("Некорректный текст инструкций");
      const v = (n[k] as string).trim();
      if (v.length > MAX_INSTRUCTIONS) throw err(`Инструкции: не больше ${MAX_INSTRUCTIONS} символов в каждом поле`);
      out.instructions[k] = v;
    }
  }
  if (i.files !== undefined) {
    const f = i.files as Record<string, unknown> | null;
    if (!f || typeof f !== "object" || Array.isArray(f)) throw err("Некорректные настройки файлов");
    if (f.allowWrite !== undefined) { if (typeof f.allowWrite !== "boolean") throw err("Некорректный переключатель записи"); out.files.allowWrite = f.allowWrite; }
    if (f.root !== undefined) {
      if (typeof f.root !== "string" || f.root.length > 500 || f.root.includes("\0")) throw err("Некорректный путь к папке");
      const raw = f.root.trim();
      if (!raw) out.files.root = "";
      else {
        if (!path.isAbsolute(raw)) throw err("Укажите полный путь к папке");
        let real: string;
        try { real = await realpath(raw); if (!(await stat(real)).isDirectory()) throw new Error(); } catch { throw err("Папка не найдена"); }
        if (real === path.parse(real).root) throw err("Корень диска нельзя открывать целиком: выберите конкретную папку");
        out.files.root = real;
      }
      // Permission to write was given for one folder; a different folder starts read-only unless asked otherwise.
      if (out.files.root !== base.files.root && f.allowWrite === undefined) out.files.allowWrite = false;
    }
    if (!out.files.root) out.files.allowWrite = false; // writing without a folder makes no sense
  }
  if (i.quickCommands !== undefined) {
    const list = i.quickCommands;
    if (!Array.isArray(list) || list.length > 20) throw err("Быстрых команд не больше 20");
    const seen = new Set<string>();
    out.quickCommands = list.map((c) => {
      const q = c as Record<string, unknown> | null;
      if (!q || typeof q.name !== "string" || typeof q.text !== "string") throw err("Некорректная быстрая команда");
      const name = q.name.trim().toLowerCase().replace(/^\//, "");
      if (!/^[\p{L}\p{N}_-]{1,24}$/u.test(name)) throw err("Имя команды: до 24 букв, цифр, «-» или «_»");
      if (BUILTIN_COMMAND_NAMES.includes(name)) throw err(`«/${name}» — встроенная команда`);
      if (seen.has(name)) throw err(`Команда «/${name}» повторяется`);
      seen.add(name);
      const text = q.text.trim();
      if (!text || text.length > 2000) throw err("Текст команды: от 1 до 2000 символов");
      return { name, text };
    });
  }
  return out;
}

/** What the browser may see: the Brave key never leaves the server, only whether one is saved. */
export function publicSettings(s: AssistantSettings) {
  const { braveKey, ...search } = s.webSearch;
  return { ...s, webSearch: { ...search, braveKeySet: !!braveKey } };
}

/** The owner's instructions as a block of the system prompt, or "" when there are none. */
export function instructionsPrompt(s: AssistantSettings): string {
  const { about, style } = s.instructions;
  if (!about && !style) return "";
  return ["Пожелания владельца, которые он сам задал в настройках. Учитывай их в каждом ответе, если они не противоречат правилам выше; они не дают разрешений на действия.",
    about ? `О владельце:\n${about}` : "", style ? `Как отвечать:\n${style}` : ""].filter(Boolean).join("\n\n");
}

/** Owner-controlled settings stored in data/assistant-settings.json. */
export class AssistantSettingsStore {
  private value: AssistantSettings;
  private writes: Promise<void> = Promise.resolve();
  private listeners: ((s: AssistantSettings) => void)[] = [];
  constructor(private readonly file: string, env: NodeJS.ProcessEnv = process.env) { this.value = defaultSettings(env); }
  async load() {
    try {
      const raw: unknown = JSON.parse(await readFile(this.file, "utf8"));
      // A stored folder that vanished is dropped rather than failing the whole file.
      const r = raw as { files?: { root?: unknown } };
      const cleaned = structuredClone(raw) as Record<string, unknown>;
      if (r?.files && typeof r.files === "object" && typeof r.files.root === "string") {
        try { await stat(r.files.root); } catch { (cleaned.files as Record<string, unknown>).root = ""; }
      }
      // A fallback equal to the main model (saved before that was refused) is dropped rather than failing the whole file.
      const chat = cleaned?.chat as Record<string, unknown> | undefined;
      if (chat && typeof chat === "object" && typeof chat.fallbackModel === "string" && chat.fallbackModel.trim() === String(chat.model ?? this.value.chat.model).trim()) chat.fallbackModel = "";
      this.value = await validateSettings(cleaned, this.value);
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
  get(): AssistantSettings { return structuredClone(this.value); }
  onChange(fn: (s: AssistantSettings) => void) { this.listeners.push(fn); }
  async update(patch: unknown): Promise<AssistantSettings> {
    this.value = await validateSettings(patch, this.value);
    const data = JSON.stringify(this.value);
    this.writes = this.writes.catch(() => {}).then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const tmp = this.file + "." + randomUUID() + ".tmp";
      await writeFile(tmp, data, { mode: 0o600 });
      await rename(tmp, this.file);
    });
    for (const fn of this.listeners) { try { fn(this.get()); } catch { /* a listener must not break saving */ } }
    await this.writes;
    return this.get();
  }
  flush() { return this.writes; }
}
