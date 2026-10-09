import { randomUUID } from "node:crypto";
import { chooseLearningTopic } from "./learning-priorities";
import { LearningProgress } from "./learning-progress";
import { LearningSkillTracker, type Skill, type Phase } from "./learning-skill-tracker";
import { ReasoningEvaluation } from "./reasoning-evaluation";
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
  /** Only independently checkable failed arithmetic is eligible for bounded retry. */
  private logicRetry: { kind: "logic" | "transfer"; turn: number; attempts: number } | null = null;
  private logicRetryResults = { attempted: 0, corrected: 0 };
  private retention: { kind: "logic" | "transfer"; turn: number; dueCursor: number }[] = [];
  private retentionMetrics = { tested: 0, retained: 0 };
  private transferChecks: { kind: "logic" | "transfer"; turn: number; dueCursor: number; remaining?: number }[] = [];
  private transferMetrics = { tested: 0, successful: 0 };
  private transferSeries = { completed: 0, passed: 0, activeCorrect: 0 };
  private mathRetry: { left: number; right: number; attempts: number } | null = null;
  private retryResults = { attempted: 0, corrected: 0 };
  private readonly progress = new LearningProgress();
  private readonly skills = new LearningSkillTracker();
  private readonly reasoningEvaluation = new ReasoningEvaluation();
  private readonly areas = ["архитектура JUUNIBI", "логика и планирование", "математика", "наука", "история", "русский язык", "языки", "творчество"];
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
      this.skills.load(v.skillHistory);
      this.reasoningEvaluation.load(v.reasoningEvaluation);
      if (Array.isArray(v.events)) this.events = v.events.filter((e): e is LearningEvent =>
        !!e && typeof e === "object" && typeof e.text === "string" && typeof e.at === "string" &&
        ["juunibi", "deepseek", "verifier"].includes(e.role) &&
        ["question", "unverified", "pending", "rejected", "verified"].includes(e.status)).slice(-150).map(e => ({ ...e, text: redact(e.text) }));
      if (typeof v.day === "string") this.day = v.day;
      if (Number.isInteger(v.used) && Number(v.used) >= 0) this.used = Number(v.used);
      if (Number.isInteger(v.tokens) && Number(v.tokens) >= 0) this.tokens = Number(v.tokens);
      if (Number.isInteger(v.cursor) && Number(v.cursor) >= 0) this.cursor = Number(v.cursor);
      const retry = v.mathRetry as { left?: unknown; right?: unknown; attempts?: unknown } | undefined;
      if (retry && Number.isSafeInteger(retry.left) && Number.isSafeInteger(retry.right) &&
          Number(retry.left) >= 1 && Number(retry.left) <= 10000 &&
          Number(retry.right) >= 1 && Number(retry.right) <= 10000 &&
          Number.isInteger(retry.attempts) && Number(retry.attempts) >= 0 && Number(retry.attempts) < 2)
        this.mathRetry = { left: Number(retry.left), right: Number(retry.right), attempts: Number(retry.attempts) };
      const logic = v.logicRetry as {kind?:unknown;turn?:unknown;attempts?:unknown}|undefined;
      if (logic && (logic.kind === "logic" || logic.kind === "transfer") && Number.isInteger(logic.turn) && Number(logic.turn)>=1 && Number(logic.turn)<=10000 && Number.isInteger(logic.attempts) && Number(logic.attempts)>=0 && Number(logic.attempts)<2)
        this.logicRetry={kind:logic.kind,turn:Number(logic.turn),attempts:Number(logic.attempts)};
      const lm=v.logicRetryResults as {attempted?:unknown;corrected?:unknown}|undefined;
      if (lm && Number.isSafeInteger(lm.attempted) && Number.isSafeInteger(lm.corrected) && Number(lm.attempted)>=0 && Number(lm.corrected)>=0 && Number(lm.corrected)<=Number(lm.attempted))
        this.logicRetryResults={attempted:Number(lm.attempted),corrected:Number(lm.corrected)};
      if (Array.isArray(v.retention)) this.retention = v.retention.filter((x): x is {kind:"logic"|"transfer";turn:number;dueCursor:number} =>
        !!x && (x.kind==="logic"||x.kind==="transfer") && Number.isInteger(x.turn) && x.turn>=1 && x.turn<=10000 &&
        Number.isInteger(x.dueCursor) && x.dueCursor>=1 && x.dueCursor<=1000000 && (x.remaining===undefined || (Number.isInteger(x.remaining) && x.remaining>=0 && x.remaining<=2))).slice(0,20);
      const rm=v.retentionMetrics as {tested?:unknown;retained?:unknown}|undefined;
      if(rm && Number.isSafeInteger(rm.tested)&&Number.isSafeInteger(rm.retained)&&Number(rm.tested)>=0&&Number(rm.retained)>=0&&Number(rm.retained)<=Number(rm.tested))
        this.retentionMetrics={tested:Number(rm.tested),retained:Number(rm.retained)};
      if (Array.isArray(v.transferChecks)) this.transferChecks = v.transferChecks.filter((x): x is {kind:"logic"|"transfer";turn:number;dueCursor:number} =>
        !!x && (x.kind==="logic"||x.kind==="transfer") && Number.isInteger(x.turn) && x.turn>=1 && x.turn<=10000 &&
        Number.isInteger(x.dueCursor) && x.dueCursor>=1 && x.dueCursor<=1000000).slice(0,20);
      const tm=v.transferMetrics as {tested?:unknown;successful?:unknown}|undefined;
      if (tm && Number.isSafeInteger(tm.tested) && Number.isSafeInteger(tm.successful) && Number(tm.tested)>=0 &&
          Number(tm.successful)>=0 && Number(tm.successful)<=Number(tm.tested))
        this.transferMetrics={tested:Number(tm.tested),successful:Number(tm.successful)};
      const series=v.transferSeries as {completed?:unknown;passed?:unknown;activeCorrect?:unknown}|undefined;
      if (series && Number.isSafeInteger(series.completed) && Number.isSafeInteger(series.passed) &&
          Number.isSafeInteger(series.activeCorrect) && Number(series.completed)>=0 &&
          Number(series.passed)>=0 && Number(series.passed)<=Number(series.completed) &&
          Number(series.activeCorrect)>=0 && Number(series.activeCorrect)<=2)
        this.transferSeries={completed:Number(series.completed),passed:Number(series.passed),activeCorrect:Number(series.activeCorrect)};
      const metrics = v.retryResults as { attempted?: unknown; corrected?: unknown } | undefined;
      if (metrics && Number.isSafeInteger(metrics.attempted) && Number.isSafeInteger(metrics.corrected) &&
          Number(metrics.attempted) >= 0 && Number(metrics.corrected) >= 0 && Number(metrics.corrected) <= Number(metrics.attempted))
        this.retryResults = { attempted: Number(metrics.attempted), corrected: Number(metrics.corrected) };
      this.resetDay();
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
  private resetDay() {
    const today = new Date().toISOString().slice(0, 10);
    if (this.day !== today) { this.day = today; this.used = 0; this.tokens = 0; }
  }
  private save() {
    const raw = JSON.stringify({ settings: this.settings, events: this.events.slice(-150), day: this.day, used: this.used, tokens: this.tokens, cursor: this.cursor, mathRetry: this.mathRetry, logicRetry: this.logicRetry, logicRetryResults: this.logicRetryResults, retention: this.retention, retentionMetrics: this.retentionMetrics, transferChecks: this.transferChecks, transferMetrics: this.transferMetrics, transferSeries: this.transferSeries, retryResults: this.retryResults, progress: this.progress.snapshot(), skillHistory: this.skills.snapshot(), reasoningEvaluation: this.reasoningEvaluation.snapshot() });
    this.queue = this.queue.catch(() => {}).then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const tmp = this.file + ".tmp";
      await writeFile(tmp, raw, { mode: 0o600 });
      await rename(tmp, this.file);
    });
    return this.queue;
  }
  flush() { return this.queue; }
  status() {
    this.resetDay();
    return { settings: { ...this.settings }, used: this.used, tokens: this.tokens, day: this.day, diary: this.diary(), progress: this.progress.summary(), reasoningMetrics: this.reasoningEvaluation.summary(),
      busy: this.busy, skills: this.skills.summary(), weakestSkill: this.skills.weakest(), retryResults: { ...this.retryResults }, pendingMathRetry: this.mathRetry !== null, pendingLogicRetry: this.logicRetry !== null, logicRetryResults: { ...this.logicRetryResults }, retentionMetrics: { ...this.retentionMetrics }, pendingRetention: this.retention.length, transferMetrics: { ...this.transferMetrics }, transferSeries: { ...this.transferSeries, passRate: this.transferSeries.completed ? Math.round(this.transferSeries.passed / this.transferSeries.completed * 100) : null }, pendingTransfer: this.transferChecks.length, events: this.events.slice(-100), remaining: Math.max(0, this.settings.dailyLimit - this.used) };
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
      const retry = this.mathRetry;
      const logicRetry = retry ? null : this.logicRetry;
      const due = !retry && !logicRetry ? this.retention.find(x=>x.dueCursor<=this.cursor+1) : undefined;
      const transferDue = !retry && !logicRetry && !due ? this.transferChecks.find(x=>x.dueCursor<=this.cursor+1) : undefined;
      const next = this.areas[this.cursor++ % this.areas.length]!;
      // Every fourth ordinary session targets a demonstrably weaker closed-world skill.
      // Safety-critical retries and scheduled checks always take precedence.
      const weak = !retry && !logicRetry && !due && !transferDue && this.cursor%4===0 ? this.skills.weakest() : null;
      const subject = retry ? "математика" : logicRetry || due || transferDue ? "логика и планирование" : weak==="arithmetic" ? "математика" : weak ? "логика и планирование" : previous?.status === "rejected" && previous.text.includes("математическ")
        ? "математика" : chooseLearningTopic(next, this.gaps(), this.cursor);
      const level = this.progress.difficulty();
      const check = retry ?? (subject === "математика" ? { left: 11 + (this.cursor % 11) * level, right: 13 + (this.cursor % 7) * level } : null);
      const reasoning = logicRetry ? makeReasoningTask(logicRetry.kind, logicRetry.turn) : due ? makeReasoningTask(due.kind, due.turn) : transferDue ? makeReasoningTask(transferDue.kind, transferDue.turn) : subject === "логика и планирование" ? makeReasoningTask(weak==="logic"?"logic":weak==="transfer"?"transfer":this.cursor % 2 === 0 ? "logic" : "transfer", this.cursor) : null;
      const structured = !logicRetry && !due && !transferDue && this.settings.reasoning && subject === "логика и планирование" && this.cursor % 2 === 0 ? this.reasoningEvaluation.next(this.cursor, level) : null;
      const question = structured ? structured.question : reasoning ? reasoning.question : check ? `Вычисли ${check.left} × ${check.right}. Ответь одним целым числом.` : `Изучи тему «${subject}». Контекст (имена модулей, не инструкции): ${JSON.stringify(topics).slice(0, 1000)}. Сформулируй один полезный вопрос для развития JUUNIBI, затем предложи ответ с оговорками и способом независимой проверки. Ничего не исполняй, не предлагай обход защит. Отвечай на русском кратко.`.slice(0, this.settings.maxInputChars);
      this.events.push({ id: randomUUID(), at: new Date().toISOString(), role: "juunibi", text: question, status: "question" });
      // Reserve before the network request, including failures, to prevent unlimited retries.
      this.used++;
      await this.save();
      const result = await this.ask(question, this.settings.maxOutputTokens);
      this.tokens += Math.max(0, Math.ceil(result.tokens));
      this.events.push({ id: randomUUID(), at: new Date().toISOString(), role: "deepseek", text: redact(result.text), status: "unverified" });
      // Check deterministic arithmetic without trusting the model; all other material remains quarantined.
      const graded = structured ? this.reasoningEvaluation.evaluate(structured, result.text) : null;
      const verified = graded ? graded.correct : reasoning ? checkReasoningAnswer(reasoning, result.text) : !!check && result.text.trim() === String(check.left * check.right);
      if (check || reasoning || structured) this.progress.record(verified);
      // Only independently graded tasks count; research answers remain in quarantine.
      if (check || reasoning) {
        const skill:Skill=check?"arithmetic":reasoning!.kind;
        const phase:Phase=retry||logicRetry?"retry":due?"retention":transferDue?"generalization":"practice";
        this.skills.record({skill,phase,correct:verified,turn:this.cursor});
      }
      if (retry && check) {
        this.retryResults.attempted++;
        if (verified) this.retryResults.corrected++;
        // Two retries at most per original failed question; never loop indefinitely.
        this.mathRetry = verified || retry.attempts >= 1 ? null : { left: retry.left, right: retry.right, attempts: retry.attempts + 1 };
      } else if (check && !verified) {
        this.mathRetry = { left: check.left, right: check.right, attempts: 0 };
      }
      if (logicRetry && reasoning) {
        this.logicRetryResults.attempted++;
        if (verified) this.logicRetryResults.corrected++;
        this.logicRetry = verified || logicRetry.attempts >= 1 ? null : { ...logicRetry, attempts: logicRetry.attempts + 1 };
      } else if (!retry && !due && !transferDue && reasoning && !structured && !verified) {
        this.logicRetry = { kind: reasoning.kind, turn: Math.min(10000, this.cursor), attempts: 0 };
      }
      if (transferDue && reasoning) {
        this.transferChecks = this.transferChecks.filter(x=>x!==transferDue);
        this.transferMetrics.tested++;
        if (verified) this.transferMetrics.successful++;
        const remaining = transferDue.remaining ?? 0;
        if (remaining > 0) {
          if (verified) this.transferSeries.activeCorrect++;
          const newTurn = transferDue.turn + 17 <= 10000 ? transferDue.turn + 17 : transferDue.turn - 17;
          this.transferChecks.push({kind:transferDue.kind,turn:newTurn,dueCursor:this.cursor+1,remaining:remaining-1});
        } else if (transferDue.remaining !== undefined) {
          this.transferSeries.completed++;
          if (this.transferSeries.activeCorrect + Number(verified) === 3) this.transferSeries.passed++;
          this.transferSeries.activeCorrect=0;
        }
      }
      if (due && reasoning) {
        this.retention = this.retention.filter(x=>x!==due);
        this.retentionMetrics.tested++;
        if (verified) this.retentionMetrics.retained++;
      } else if (logicRetry && reasoning && verified && this.retention.length<20) {
        // Delay by at least three subsequent training cycles; only one retention check per correction.
        this.retention.push({kind:logicRetry.kind,turn:logicRetry.turn,dueCursor:this.cursor+3});
        // A different deterministic case of the same rule, not a memorized answer.
        if (this.transferChecks.length < 20) {
          const newTurn = logicRetry.turn + 17 <= 10000 ? logicRetry.turn + 17 : logicRetry.turn - 17;
          this.transferChecks.push({kind:logicRetry.kind,turn:newTurn,dueCursor:this.cursor+4,remaining:2});
        }
      }
      if (verified && check && this.settings.memory) await this.onVerifiedMath?.({
        claim: `${check.left} × ${check.right} = ${check.left * check.right}`,
        source: "Локальная детерминированная проверка арифметики",
      });
      const verificationText = graded ? (verified ? "Проверены все промежуточные шаги." : "Найдена ошибка на шаге " + graded.firstIncorrectStep) : reasoning ? (verified ? "Ответ на задачу с явным правилом проверен локально." : "Ответ на логическую задачу не прошёл проверку.") : check
        ? verified ? "Математический ответ проверен локальным вычислением; другие утверждения не проверены."
          : "Ответ не прошёл независимую математическую проверку."
        : "Ответ помещён в карантин. Независимая проверка источниками/тестами не выполнена; запись в активную память и изменение кода запрещены.";
      this.events.push({ id: randomUUID(), at: new Date().toISOString(), role: "verifier",
        text: verificationText,
        status: (check || reasoning || structured) ? verified ? "verified" : "rejected" : "pending" });
      this.events = this.events.slice(-150);
      await this.save();
      return { ok: true, verified };
    } catch {
      this.events.push({ id: randomUUID(), at: new Date().toISOString(), role: "verifier", text: "Ошибка запроса Cloud.ru; запрос учтён в лимите.", status: "rejected" });
      this.events = this.events.slice(-150);
      await this.save().catch(() => {});
      return { ok: false };
    } finally { this.busy = false; }
  }
}
