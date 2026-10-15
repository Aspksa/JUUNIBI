import type { LlmProvider } from "./llm";
import { Memory, MemoryAdapter, type MemoryEntry, type StorageAdapter } from "./memory";
import { redactSensitive } from "./redact";

const TURNS_LIMIT = 1000;

export interface Turn {
  id: string;
  session: string;
  user: string;
  reply: string;
  tools: string[];
  memoryIds: string[];
  rating?: 1 | -1;
  /** Lessons were already proposed for this turn: another vote must not propose them again. */
  reflected?: boolean;
  at: number;
}

export interface TurnJournalLog {
  warn(message: string, error?: unknown): void;
}

export interface TurnJournalOptions {
  llm: LlmProvider;
  memory: Memory;
  store?: StorageAdapter;
  log?: TurnJournalLog;
}

/**
 * Persistent journal for assistant turns, feedback and reflection.
 * Reflection can only create pending memory lessons; approval remains outside this service.
 */
export class TurnJournal {
  private turns: Turn[] = [];
  private readonly ready: Promise<void>;
  private readonly store: StorageAdapter;

  constructor(private readonly options: TurnJournalOptions) {
    this.store = options.store ?? new MemoryAdapter();
    this.ready = this.store.load().then((raw) => {
      try {
        const parsed = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) this.turns = parsed;
      } catch {
        // Corrupt optional turn history must not break chat startup.
      }
    });
  }

  async record(input: Omit<Turn, "id" | "at">): Promise<Turn> {
    await this.ready;
    const turn: Turn = {
      ...input,
      tools: [...input.tools],
      memoryIds: [...input.memoryIds],
      id: crypto.randomUUID(),
      at: Date.now(),
    };
    this.turns.push(turn);
    this.turns = this.turns.slice(-TURNS_LIMIT);
    await this.save();
    return { ...turn, tools: [...turn.tools], memoryIds: [...turn.memoryIds] };
  }

  snapshot(): Turn[] {
    return this.turns.map((turn) => ({
      ...turn,
      tools: [...turn.tools],
      memoryIds: [...turn.memoryIds],
    }));
  }

  async feedback(turnId: string, rating: 1 | -1): Promise<boolean> {
    await this.ready;
    const turn = this.turns.find((item) => item.id === turnId);
    if (!turn) return false;
    if (turn.rating) await this.options.memory.feedback(turn.memoryIds, -turn.rating);
    turn.rating = rating;
    await this.options.memory.feedback(turn.memoryIds, rating);
    await this.save();
    return true;
  }

  async reflect(turnId: string): Promise<MemoryEntry[]> {
    await this.ready;
    const turn = this.turns.find((item) => item.id === turnId);
    if (!turn || turn.reflected) return [];

    turn.reflected = true;
    let response: Awaited<ReturnType<LlmProvider["chat"]>>;
    try {
      response = await this.options.llm.chat([
        {
          role: "system",
          content: 'Извлеки до 3 коротких переиспользуемых уроков/предпочтений пользователя из диалога. Ответ — только JSON-массив строк, например ["..."]. Если учиться нечему — [].',
        },
        {
          role: "user",
          content: `Пользователь: ${turn.user}\nПомощник: ${turn.reply}\nОценка: ${turn.rating ?? "нет"}`,
        },
      ]);
    } catch (error) {
      turn.reflected = false;
      throw error;
    }

    await this.save();

    let items: unknown;
    try {
      items = JSON.parse((response.content ?? "[]").replace(/^\`\`\`(?:json)?|\`\`\`$/gm, "").trim());
    } catch {
      return [];
    }
    if (!Array.isArray(items)) return [];

    const out: MemoryEntry[] = [];
    for (const item of items.slice(0, 3)) {
      if (typeof item === "string" && item.trim()) {
        out.push(await this.options.memory.add("lesson", item, "pending"));
      }
    }
    return out;
  }

  async exportDataset(options: { redact?: boolean } = {}): Promise<string> {
    await this.ready;
    const clean = (text: string) => options.redact ? redactSensitive(text) : text;
    return this.turns
      .filter((turn) => turn.rating === 1)
      .map((turn) => JSON.stringify({
        messages: [
          { role: "user", content: clean(turn.user) },
          { role: "assistant", content: clean(turn.reply) },
        ],
      }))
      .join("\n");
  }

  private save(): Promise<void> {
    return this.store.save(JSON.stringify(this.turns))
      .catch((error) => this.options.log?.warn("turns save failed", error));
  }
}
