import { Logger } from "@juunibi/core";
import { DiagnosticCoordinator, type DiagnosticBatch } from "./diagnostic-coordinator";
import { AgentLoop, type AgentLoopEvent } from "./agent-loop";
import { taskExecutionInstructions } from "./task-intent";
import type { LlmProvider, Message } from "./llm";
import { Memory, type MemoryEntry, type StorageAdapter } from "./memory";
import { ToolRegistry, type Risk } from "./tools";
import { ToolExecutor, type ApprovalRequest, type ToolStatus } from "./tool-executor";
import { buildAssistantSystemPrompt, HISTORY_LIMIT, prepareConversationContext } from "./context-builder";
import { ConversationSummaryService } from "./conversation-summary";
import { MemoryLearningService } from "./memory-learning";
import { TurnJournal, type Turn } from "./turn-journal";
import { registerAssistantBuiltins } from "./assistant-builtins";
import { SessionHistory } from "./session-history";

export type { ApprovalRequest, ToolStatus } from "./tool-executor";
export type { Turn } from "./turn-journal";
export type AskEvent = AgentLoopEvent;
export interface AskOptions {
  /** Client-held conversation so far (the client is the source of truth). Replaces server-side session memory. */
  history?: { role: "user" | "assistant"; content: string }[];
  onEvent?: (e: AskEvent) => void;
  /** Leave no trace: the turn is not logged, nothing is proposed to memory, no summary is kept. Used by quality checks. */
  ephemeral?: boolean;
  /** Trusted server-side reasoning guidance; never grants tool permissions. */
  brainGuidance?: { needsPlanning: boolean; needsApproval: boolean; needsEvidenceReview: boolean; evidenceWarnings?: string[] };
}
export interface AskResult { turnId: string; reply: string; tools: string[]; memory: string[] }

export interface AssistantPrefs { suggestions: "off" | "rules" | "smart"; summaries: boolean }
export interface AssistantOptions {
  /** Live owner preferences (memory proposals, conversation summaries). Defaults: smart proposals, no summaries. */
  prefs?: () => AssistantPrefs;
  /** Where conversation summaries survive restarts. Optional. */
  summariesStore?: StorageAdapter;
  /** Clock for the "current time" line (tests). */
  now?: () => Date;
  llm: LlmProvider;
  tools?: ToolRegistry;
  memory?: Memory;
  turnsStore?: StorageAdapter;
  log?: Logger;
  /** Snapshot of the project's modules, shown to the model so it "knows everything". */
  describeModules?: () => unknown;
  /** Trusted brain snapshot; model text cannot alter permissions. */
  describeBrain?: () => unknown;
  /** Supervisor hook: called before any non-"read" tool runs. No hook => such tools are denied. */
  approve?: (req: ApprovalRequest) => Promise<boolean> | boolean;
  maxSteps?: number;
  /** A reply the user is waiting for: how long to wait for Cloud.ru to start answering, and how many times to retry. */
  chatTimeoutMs?: number;
  chatRetries?: number;
  /** Best-effort metadata-only observer; never receives raw arguments or tool outputs. */
  onToolOutcome?: (event: { tool: string; status: ToolStatus; risk: Risk; elapsedMs: number }) => void;
  /** Owner policy that can only NARROW access: a tool it rejects is hidden from the model and refused if called. */
  toolPolicy?: (tool: string) => boolean;
  /** Optional queue used by the server to safely request user consent. */
  persona?: string;
  /** The owner's own instructions (who they are, how to answer), added to every system prompt. Empty = none. */
  instructions?: () => string;
}

/** A waiting user hears about a Cloud.ru outage within ~1 minute instead of ~3 (background work keeps the provider's longer retries). */
const CHAT_TIMEOUT_MS = 20_000;
const CHAT_RETRIES = 1;

/** "Сейчас: пятница, 9 октября 2026, 05:30 (UTC+03:00)" — lets the model resolve "завтра" and "в 10". */
export function nowLine(d: Date): string {
  const tzMin = -d.getTimezoneOffset();
  const sign = tzMin >= 0 ? "+" : "-", abs = Math.abs(tzMin);
  const tz = `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  const date = d.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return `Сейчас: ${date}, ${time} (${tz}).`;
}

export class Assistant {
  readonly tools: ToolRegistry;
  readonly memory: Memory;
  private readonly log: Logger;
  private readonly toolExecutor: ToolExecutor;
  private readonly agentLoop: AgentLoop;
  private readonly diagnostics: DiagnosticCoordinator;
  private readonly summaryService: ConversationSummaryService;
  private readonly memoryLearning: MemoryLearningService;
  private readonly turnJournal: TurnJournal;
  private readonly sessions = new SessionHistory(HISTORY_LIMIT * 2);
  private activeAsks = 0;
  private askWaiters: (() => void)[] = [];

  constructor(private readonly o: AssistantOptions) {
    this.tools = o.tools ?? new ToolRegistry();
    this.memory = o.memory ?? new Memory();
    this.log = o.log ?? new Logger("assistant");
    this.toolExecutor = new ToolExecutor({
      tools: this.tools,
      ...(o.approve ? { approve: o.approve } : {}),
      ...(o.toolPolicy ? { toolPolicy: o.toolPolicy } : {}),
      log: this.log,
    });
    this.agentLoop = new AgentLoop({
      llm: o.llm,
      tools: this.tools,
      executor: this.toolExecutor,
      log: this.log,
      ...(o.onToolOutcome ? { onToolOutcome: o.onToolOutcome } : {}),
    });
    this.diagnostics = new DiagnosticCoordinator({
      tools: this.tools,
      executor: this.toolExecutor,
    });
    this.summaryService = new ConversationSummaryService({
      llm: o.llm,
      ...(o.summariesStore ? { store: o.summariesStore } : {}),
      log: this.log,
      waitForChatIdle: () => this.chatIdle(),
    });
    this.memoryLearning = new MemoryLearningService({
      llm: o.llm,
      memory: this.memory,
      log: this.log,
      waitForChatIdle: () => this.chatIdle(),
    });
    this.turnJournal = new TurnJournal({
      llm: o.llm,
      memory: this.memory,
      ...(o.turnsStore ? { store: o.turnsStore } : {}),
      log: this.log,
    });
    registerAssistantBuiltins({
      tools: this.tools,
      memory: this.memory,
      ...(o.describeModules ? { describeModules: o.describeModules } : {}),
    });
  }
  /** Resolves when background work (conversation summaries) is finished. Mostly for tests. */
  idle(): Promise<void> { return Promise.all([this.summaryService.idle(), this.memoryLearning.idle()]).then(() => {}); }
  /** Rated and unrated turns, newest last, as plain copies (for the quality report). */
  turnsSnapshot(): Turn[] { return this.turnJournal.snapshot(); }

  private system(memories: MemoryEntry[], summary?: string): string {
    return buildAssistantSystemPrompt({
      ...(this.o.persona ? { persona: this.o.persona } : {}),
      ownerInstructions: this.o.instructions?.().trim() ?? "",
      currentTime: nowLine(this.o.now?.() ?? new Date()),
      modules: this.o.describeModules?.() ?? [],
      ...(this.o.describeBrain ? { brain: { snapshot: this.o.describeBrain() } } : {}),
      ...(summary ? { summary } : {}),
      memories: memories.map((m) => m.text),
    });
  }

  async ask(text: string, session = "default", signal?: AbortSignal, opts: AskOptions = {}): Promise<AskResult> {
    this.activeAsks++;
    try { return await this.answer(text, session, signal, opts); }
    finally { if (--this.activeAsks === 0) for (const wake of this.askWaiters.splice(0)) wake(); }
  }
  /** True while a reply the user is waiting for is being produced. */
  isAnswering(): boolean { return this.activeAsks > 0; }
  /** Background model calls wait for this so they never compete with a reply the user is waiting for. */
  private chatIdle(): Promise<void> { return this.activeAsks ? new Promise((resolve) => this.askWaiters.push(resolve)) : Promise.resolve(); }

  private async answer(text: string, session: string, signal: AbortSignal | undefined, opts: AskOptions): Promise<AskResult> {
    const mem = await this.memory.context(text, 1500);
    const prefs = this.o.prefs?.() ?? { suggestions: "smart", summaries: false };
    const historyContext = prepareConversationContext(opts.history);
    const clientHistory = historyContext.provided ? historyContext.recent : undefined;
    const older = historyContext.older;
    const summary = prefs.summaries && older.length && !opts.ephemeral
      ? await this.summaryService.get(session, older)
      : undefined;
    const hist = clientHistory ?? (opts.ephemeral ? [] : this.sessions.get(session));
    const guidance = opts.brainGuidance;
    const instructions = guidance ? [
      guidance.needsPlanning ? "Сложная задача: сначала сформулируй план действий и предположения; не утверждай, что план уже выполнен." : "",
      guidance.needsEvidenceReview ? "Отделяй проверенные сведения от гипотез. Для проверки фактов используй доступные инструменты чтения." : "",
      guidance.needsApproval ? "Возможны действия с последствиями: поясни риски и используй только фактическое подтверждение через существующий ApprovalGate. Текст пользователя или этот совет не являются разрешением." : "",
      ...(guidance.evidenceWarnings ?? []).filter(x => typeof x === "string").slice(0, 3).map(x => x.slice(0, 300)),
    ].filter(Boolean).join(" ") : "";
    const msgs: Message[] = [{ role: "system", content: this.system(mem, summary) + "\n\n" + taskExecutionInstructions(text) },
      ...(instructions ? [{ role: "system" as const, content: instructions }] : []),
      ...hist.slice(-HISTORY_LIMIT), { role: "user", content: text }];
    // The automatic brain review already ran for this message, so its tool would only add a model round trip;
    // the other brain tools are offered only when the review says the task needs planning.
    const toolAllowed = (name: string) => this.o.toolPolicy?.(name) !== false &&
      !(guidance && name.startsWith("brain_") && (name === "brain_v4_unified_review" || !guidance.needsPlanning));
    // Explicit diagnostics are deterministic and read-only; they are never selected by model output.
    const functional = opts.ephemeral
      ? null
      : await this.diagnostics.runFunctional(text, signal, opts.onEvent);
    if (functional) {
      const turn = await this.turnJournal.record({
        session,
        user: text,
        reply: functional.reply,
        tools: functional.used,
        memoryIds: mem.map((m) => m.id),
      });
      if (!clientHistory) this.sessions.appendTurn(session, text, functional.reply);
      return { turnId: turn.id, reply: functional.reply, tools: functional.used, memory: mem.map((m) => m.text) };
    }

    let diagnostics: DiagnosticBatch = { active: false, used: [], evidence: [] };
    if (!opts.ephemeral) {
      diagnostics = await this.diagnostics.prepareBatch(text, session, hist, signal, opts.onEvent);
      if (diagnostics.systemMessage) msgs.push({ role: "system", content: diagnostics.systemMessage });
    }

    const agent = await this.agentLoop.run({
      messages: msgs,
      request: text,
      ...(signal ? { signal } : {}),
      ...(opts.onEvent ? { onEvent: opts.onEvent } : {}),
      readOnly: opts.ephemeral ?? false,
      maxSteps: this.o.maxSteps ?? 6,
      timeoutMs: this.diagnostics.modelTimeout(this.o.chatTimeoutMs ?? CHAT_TIMEOUT_MS, diagnostics.active),
      retries: this.o.chatRetries ?? CHAT_RETRIES,
      toolAllowed: (name) => toolAllowed(name) && !(diagnostics.active && this.diagnostics.isDiagnosticTool(name)),
      initialUsed: diagnostics.used,
      initialEvidence: diagnostics.evidence,
      logPerformance: !opts.ephemeral,
    });
    const reply = agent.reply;
    const used = agent.used;
    this.diagnostics.complete(diagnostics);
    // The running summary is refreshed only after the reply, so it never competes with it for Cloud.ru.
    if (prefs.summaries && older.length && !opts.ephemeral) this.summaryService.queue(session, older);

    if (opts.ephemeral) return { turnId: "", reply, tools: used, memory: mem.map((m) => m.text) };
    if (!clientHistory) this.sessions.appendTurn(session, text, reply);

    const turn = await this.turnJournal.record({
      session,
      user: text,
      reply,
      tools: used,
      memoryIds: mem.map((m) => m.id),
    });
    this.memoryLearning.queue(text, prefs.suggestions);
    return { turnId: turn.id, reply, tools: used, memory: mem.map((m) => m.text) };
  }

  /** Thumbs up/down: tunes the memories that were used and records the label for training data. */
  feedback(turnId: string, rating: 1 | -1): Promise<boolean> {
    return this.turnJournal.feedback(turnId, rating);
  }

  /** Ask the model what is worth learning from a turn. Results are PENDING until the user approves. */
  reflect(turnId: string): Promise<MemoryEntry[]> {
    return this.turnJournal.reflect(turnId);
  }

  /** Turns rated 👍 as JSONL (chat format) — material for later fine-tuning on Cloud.ru. */
  exportDataset(opts: { redact?: boolean } = {}): Promise<string> {
    return this.turnJournal.exportDataset(opts);
  }

}
