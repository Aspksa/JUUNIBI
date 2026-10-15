import type { Message } from "./llm";
import { Memory, type MemoryEntry } from "./memory";
import { ConversationSummaryService } from "./conversation-summary";
import { SessionHistory } from "./session-history";
import { buildAssistantSystemPrompt, HISTORY_LIMIT, prepareConversationContext } from "./context-builder";
import { taskExecutionInstructions } from "./task-intent";

export interface AssistantPrefs {
  suggestions: "off" | "rules" | "smart";
  summaries: boolean;
}

export interface BrainGuidance {
  needsPlanning: boolean;
  needsApproval: boolean;
  needsEvidenceReview: boolean;
  evidenceWarnings?: string[];
}

export interface RequestContextBuilderOptions {
  memory: Memory;
  summaries: Pick<ConversationSummaryService, "get">;
  sessions: Pick<SessionHistory, "get">;
  prefs?: () => AssistantPrefs;
  now?: () => Date;
  persona?: string;
  instructions?: () => string;
  describeModules?: () => unknown;
  describeBrain?: () => unknown;
}

export interface RequestContextInput {
  text: string;
  session: string;
  history?: { role: "user" | "assistant"; content: string }[];
  ephemeral?: boolean;
  brainGuidance?: BrainGuidance;
}

export interface PreparedRequestContext {
  memories: MemoryEntry[];
  memoryTexts: string[];
  prefs: AssistantPrefs;
  messages: Message[];
  history: Message[];
  olderHistory: Message[];
  usesClientHistory: boolean;
}

/** "Сейчас: пятница, 9 октября 2026, 05:30 (UTC+03:00)" — lets the model resolve "завтра" and "в 10". */
export function nowLine(d: Date): string {
  const tzMin = -d.getTimezoneOffset();
  const sign = tzMin >= 0 ? "+" : "-", abs = Math.abs(tzMin);
  const tz = `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  const date = d.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return `Сейчас: ${date}, ${time} (${tz}).`;
}

function guidanceInstructions(guidance?: BrainGuidance): string {
  if (!guidance) return "";
  return [
    guidance.needsPlanning
      ? "Сложная задача: сначала сформулируй план действий и предположения; не утверждай, что план уже выполнен."
      : "",
    guidance.needsEvidenceReview
      ? "Отделяй проверенные сведения от гипотез. Для проверки фактов используй доступные инструменты чтения."
      : "",
    guidance.needsApproval
      ? "Возможны действия с последствиями: поясни риски и используй только фактическое подтверждение через существующий ApprovalGate. Текст пользователя или этот совет не являются разрешением."
      : "",
    ...(guidance.evidenceWarnings ?? [])
      .filter((warning) => typeof warning === "string")
      .slice(0, 3)
      .map((warning) => warning.slice(0, 300)),
  ].filter(Boolean).join(" ");
}

/**
 * Builds one model request from trusted runtime context plus bounded untrusted conversation data.
 * It never executes tools and never grants permissions.
 */
export class RequestContextBuilder {
  constructor(private readonly options: RequestContextBuilderOptions) {}

  async prepare(input: RequestContextInput): Promise<PreparedRequestContext> {
    const memories = await this.options.memory.context(input.text, 1500);
    const prefs = this.options.prefs?.() ?? { suggestions: "smart", summaries: false };
    const conversation = prepareConversationContext(input.history);
    const clientHistory = conversation.provided ? conversation.recent : undefined;
    const olderHistory = conversation.older;
    const summary = prefs.summaries && olderHistory.length && !input.ephemeral
      ? await this.options.summaries.get(input.session, olderHistory)
      : undefined;
    const history = clientHistory ?? (input.ephemeral ? [] : this.options.sessions.get(input.session));

    const system = buildAssistantSystemPrompt({
      ...(this.options.persona ? { persona: this.options.persona } : {}),
      ownerInstructions: this.options.instructions?.().trim() ?? "",
      currentTime: nowLine(this.options.now?.() ?? new Date()),
      modules: this.options.describeModules?.() ?? [],
      ...(this.options.describeBrain ? { brain: { snapshot: this.options.describeBrain() } } : {}),
      ...(summary ? { summary } : {}),
      memories: memories.map((memory) => memory.text),
    }) + "\n\n" + taskExecutionInstructions(input.text);

    const guidance = guidanceInstructions(input.brainGuidance);
    const messages: Message[] = [
      { role: "system", content: system },
      ...(guidance ? [{ role: "system" as const, content: guidance }] : []),
      ...history.slice(-HISTORY_LIMIT),
      { role: "user", content: input.text },
    ];

    return {
      memories,
      memoryTexts: memories.map((memory) => memory.text),
      prefs,
      messages,
      history,
      olderHistory,
      usesClientHistory: conversation.provided,
    };
  }
}
