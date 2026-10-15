import type { Message } from "./llm";
import type { MemoryEntry } from "./memory";
import type { AssistantPrefs } from "./request-context";
import { ConversationSummaryService } from "./conversation-summary";
import { MemoryLearningService } from "./memory-learning";
import { SessionHistory } from "./session-history";
import { TurnJournal } from "./turn-journal";

export interface FinalizedTurn {
  turnId: string;
  reply: string;
  tools: string[];
  memory: string[];
}

export interface TurnFinalizerOptions {
  sessions: Pick<SessionHistory, "appendTurn">;
  journal: Pick<TurnJournal, "record">;
  summaries: Pick<ConversationSummaryService, "queue">;
  memoryLearning: Pick<MemoryLearningService, "queue">;
}

export interface FinalizeTurnInput {
  session: string;
  user: string;
  reply: string;
  tools: readonly string[];
  memories: readonly MemoryEntry[];
  prefs: AssistantPrefs;
  olderHistory: readonly Message[];
  usesClientHistory: boolean;
  ephemeral: boolean;
  /** Functional diagnostics historically do not trigger summary refresh or memory learning. */
  background: "full" | "none";
}

/**
 * Applies all post-reply side effects in one place.
 * Ephemeral replies remain trace-free; client-held history remains the source of truth when supplied.
 */
export class TurnFinalizer {
  constructor(private readonly options: TurnFinalizerOptions) {}

  async finalize(input: FinalizeTurnInput): Promise<FinalizedTurn> {
    const memory = input.memories.map((entry) => entry.text);

    if (input.background === "full" && input.prefs.summaries && input.olderHistory.length && !input.ephemeral) {
      this.options.summaries.queue(input.session, [...input.olderHistory]);
    }

    if (input.ephemeral) {
      return {
        turnId: "",
        reply: input.reply,
        tools: [...input.tools],
        memory,
      };
    }

    if (!input.usesClientHistory) {
      this.options.sessions.appendTurn(input.session, input.user, input.reply);
    }

    const turn = await this.options.journal.record({
      session: input.session,
      user: input.user,
      reply: input.reply,
      tools: [...input.tools],
      memoryIds: input.memories.map((entry) => entry.id),
    });

    if (input.background === "full") {
      this.options.memoryLearning.queue(input.user, input.prefs.suggestions);
    }

    return {
      turnId: turn.id,
      reply: input.reply,
      tools: [...input.tools],
      memory,
    };
  }
}
