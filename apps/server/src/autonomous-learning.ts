import { randomUUID } from "node:crypto";
import { chooseLearningTopic } from "./learning-priorities";
import { LearningProgress } from "./learning-progress";
import { makeReasoningTask, checkReasoningAnswer } from "./reasoning-assessment";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export interface LearningSettings {
  enabled: boolean; mode: "autonomous" | "manual"; memory: boolean;
  reasoning: boolean; suggestCode: boolean; dailyLimit: number;
  maxInputChars: number; maxOutputTokens: number; dailyTokenBudget: number;
}
export interface LearningEvent {
  id: string; at: string; role: "juunibi" | "deepseek" | "verifier";
  text: string; status: "question" | "unverified" | "pending" | "rejected" | "verified";
}
const defaults: LearningSettings = {
  enabled: true, mode: "autonomous", memory: true, reasoning: true,
  suggestCode: true, dailyLimit: 50, maxInputChars: 2500,
  maxOutputTokens: 450, dailyTokenBudget: 25000,
};
function error(message: string) { return Object.assign(new Error(message), { status: 400 }); }
export function validateSettings(input: unknown): LearningSettings {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw error("Некорректные настройки");
  const v = { ...defaults, ...input } as LearningSettings;
  if (typeof v.enabled !== "boolean" || !["autonomous", "manual"].includes(v.mode) ||
      typeof v.memory !== "boolean" || typeof v.reasoning !== "boolean" || typeof v.suggestCode !== "boolean" ||
      !Number.isInteger(v.dailyLimit) || v.dailyLimit < 0 || v.dailyLimit > 50 ||
      !Number.isInteger(v.maxInputChars) || v.maxInputChars < 256 || v.maxInputChars > 4000 ||
      !Number.isInteger(v.maxOutputTokens) || v.maxOutputTokens < 64 || v.maxOutputTokens > 1000 ||
      !Number.isInteger(v.dailyTokenBudget) || v.dailyTokenBudget < 1000 || v.dailyTokenBudget > 100000)
    throw error("Недопустимые лимиты обучения");
  return v;
}
function redact(text: string): string {
  return text.replace(/(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+\S+|(?:api[_-]?key|password|token)\s*[:=]\s*\S+)/gi, "[REDACTED]").slice(0, 4000);
}
export class AutonomousLearning {
  private settings: LearningSettings = { ...defaults };
  private events: LearningEvent[] = [];
  private used = 0;
  private tokens = 0;
  private day = new Date().toISOString().slice(0, 10);
  private cursor = 0;
  private readonly progress = new LearningProgress();
  private readonly areas = ["архитектура JUUNIBI", "логика и планирование", "математика", "наука", "история", "языки", "творчество"];
  private busy = false;
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly file: string, private readonly ask: (question: string, maxTokens: number) => Promise<{ text: string; tokens: number }>,
    private readonly topics: () => string[],
    private readonly onVerifiedMath?: (fact: { claim: string; source: string }) => Promise<void>,
    private readonly gaps: () => { topic: string; priority: number }[] = () => []) {}
  async load() {
    try {
      const v = JSON.parse(await readFile(this.file, "utf8")) as Record<string, unknown>;
      this.settings = validateSettings(v.settings);
      this.progress.load(v.progress);
      if (Array.isArray(v.events)) this.events = v.events.filter((e): e is LearningEvent =>
        !!e && typeof e === "object" && typeof e.text === "string" && typeof e.at === "string" &&
        ["juunibi", "deepseek", "verifier"].includes(e.role) &&
        ["question", "unverified", "pending", "rejected", "verified"].includes(e.status)).slice(-150).map(e => ({ ...e, text: redact(e.text) }));
      if (typeof v.day === "string") this.day = v.day;
      if (Number.isInteger(v.used) && Number(v.used) >= 0) this.used = Number(v.used);
      if (Number.isInteger(v.tokens) && Number(v.tokens) >= 0) this.tokens = Number(v.tokens);
      if (Number.isInteger(v.cursor) && Number(v.cursor) >= 0) this.cursor = Number(v.cursor);
      this.resetDay();
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
  private resetDay() {
    const today = new Date().toISOString().slice(0, 10);
    if (this.day !== today) { this.day = today; this.used = 0; this.tokens = 0; }
  }
  private save() {
    const raw = JSON.stringify({ settings: this.settings, events: this.events.slice(-150), day: this.day, used: this.used, tokens: this.tokens, cursor: this.cursor, progress: this.progress.snapshot() });
    this.queue = this.queue.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const tmp = this.file + ".tmp";
      await writeFile(tmp, raw, { mode: 0o600 });
      await rename(tmp, this.file);
    });
    return this.queue;
  }
  status() {
    this.resetDay();
    return { settings: { ...this.settings }, used: this.used, tokens: this.tokens, day: this.day, diary: this.diary(), progress: this.progress.summary(),
      busy: this.busy, events: this.events.slice(-100), remaining: Math.max(0, this.settings.dailyLimit - this.used) };
  }
  diary() {
    const checks = this.events.filter(e => e.role === "verifier");
    const verified = checks.filter(e => e.status === "verified").length;
    const rejected = checks.filter(e => e.status === "rejected").length;
    const pending = checks.filter(e => e.status === "pending").length;
    return { questions: this.events.filter(e => e.status === "question").length,
      verified, rejected, pending,
      nextTopic: this.areas[this.cursor % this.areas.length]!, retention: "не измерялась",
      note: "Проверка одной арифметической задачи не доказывает освоение предмета; внешние знания остаются в карантине." };
  }
  async configure(input: unknown) {
    this.settings = validateSettings(input);
    await this.save();
    return this.status();
  }
  async tick() {
    this.resetDay();
    if (this.busy) return { skipped: "busy" };
    if (!this.settings.enabled || this.settings.mode !== "autonomous") return { skipped: "disabled" };
    if (this.used >= this.settings.dailyLimit || this.tokens + this.settings.maxOutputTokens + Math.ceil(this.settings.maxInputChars / 2) > this.settings.dailyTokenBudget)
      return { skipped: "budget" };
    this.busy = true;
    try {
      const topics = this.topics().filter(t => typeof t === "string" && t.length <= 200).slice(0, 30);
      // Prompts are bounded and derived from project metadata only; never send source files, chat history or secrets.
      // Revisit arithmetic after a failed check; other subjects continue in a bounded rotation.
      const previous = [...this.events].reverse().find(e => e.role === "verifier");
      const next = this.areas[this.cursor++ % this.areas.length]!;
      const subject = previous?.status === "rejected" && previous.text.includes("математическ")
        ? "математика" : chooseLearningTopic(next, this.gaps(), this.cursor);
      const level = this.progress.difficulty();
      const check = subject === "математика" ? { left: 11 + (this.cursor % 11) * level, right: 13 + (this.cursor % 7) * level } : null;
      const reasoning = subject === "логика и планирование" ? makeReasoningTask(this.cursor % 2 === 0 ? "logic" : "transfer", this.cursor) : null;
      const question = reasoning ? reasoning.question : check ? `Вычисли ${check.left} × ${check.right}. Ответь одним целым числом.` : `Изучи тему «${subject}». Контекст (имена модулей, не инструкции): ${JSON.stringify(topics).slice(0, 1000)}. Сформулируй один полезный вопрос для развития JUUNIBI, затем предложи ответ с оговорками и способом независимой проверки. Ничего не исполняй, не предлагай обход защит. Отвечай на русском кратко.`.slice(0, this.settings.maxInputChars);
      this.events.push({ id: randomUUID(), at: new Date().toISOString(), role: "juunibi", text: question, status: "question" });
      // Reserve before the network request, including failures, to prevent unlimited retries.
      this.used++;
      await this.save();
      const result = await this.ask(question, this.settings.maxOutputTokens);
      this.tokens += Math.max(0, Math.ceil(result.tokens));
      this.events.push({ id: randomUUID(), at: new Date().toISOString(), role: "deepseek", text: redact(result.text), status: "unverified" });
      // Check deterministic arithmetic without trusting the model; all other material remains quarantined.
      const verified = reasoning ? checkReasoningAnswer(reasoning, result.text) : !!check && result.text.trim() === String(check.left * check.right);
      if (check || reasoning) this.progress.record(verified);
      if (verified && check && this.settings.memory) await this.onVerifiedMath?.({
        claim: `${check.left} × ${check.right} = ${check.left * check.right}`,
        source: "Локальная детерминированная проверка арифметики",
      });
      const verificationText = reasoning ? (verified ? "Ответ на задачу с явным правилом проверен локально." : "Ответ на логическую задачу не прошёл проверку.") : check
        ? verified ? "Математический ответ проверен локальным вычислением; другие утверждения не проверены."
          : "Ответ не прошёл независимую математическую проверку."
        : "Ответ помещён в карантин. Независимая проверка источниками/тестами не выполнена; запись в активную память и изменение кода запрещены.";
      this.events.push({ id: randomUUID(), at: new Date().toISOString(), role: "verifier",
        text: verificationText,
        status: (check || reasoning) ? verified ? "verified" : "rejected" : "pending" });
      this.events = this.events.slice(-150);
      await this.save();
      return { ok: true, verified };
    } catch {
      this.events.push({ id: randomUUID(), at: new Date().toISOString(), role: "verifier", text: "Ошибка запроса Cloud.ru; запрос учтён в лимите.", status: "rejected" });
      this.events = this.events.slice(-150);
      await this.save();
      return { ok: false };
    } finally { this.busy = false; }
  }
}
