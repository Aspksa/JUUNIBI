import type { LlmProvider, Message } from "./llm";
import { guardToolClaims, type ToolEvidence } from "./evidence-guard";
import { ToolExecutor, type ToolStatus } from "./tool-executor";
import { ToolRegistry, type Risk } from "./tools";

export type AgentLoopEvent =
  | { type: "delta"; text: string }
  | { type: "thinking" }
  | { type: "tool"; phase: "start"; id: string; name: string; args: string }
  | { type: "tool"; phase: "end"; id: string; name: string; status: ToolStatus; ms: number };

export interface AgentLoopLog {
  info(message: string): void;
  warn(message: string, error?: unknown): void;
}

export interface AgentLoopOptions {
  llm: LlmProvider;
  tools: ToolRegistry;
  executor: ToolExecutor;
  log?: AgentLoopLog;
  onToolOutcome?: (event: { tool: string; status: ToolStatus; risk: Risk; elapsedMs: number }) => void;
}

export interface AgentLoopRunOptions {
  messages: Message[];
  request: string;
  signal?: AbortSignal;
  onEvent?: (event: AgentLoopEvent) => void;
  readOnly?: boolean;
  maxSteps?: number;
  timeoutMs: number;
  retries: number;
  toolAllowed?: (name: string) => boolean;
  initialUsed?: readonly string[];
  initialEvidence?: readonly ToolEvidence[];
  logPerformance?: boolean;
}

export interface AgentLoopResult {
  reply: string;
  used: string[];
  evidence: ToolEvidence[];
  calls: number;
  model?: string;
  elapsedMs: number;
  firstTextMs?: number;
}

/**
 * Bounded model/tool loop. It owns no conversation, memory or approval state:
 * all tool execution still passes through the injected ToolExecutor.
 */
export class AgentLoop {
  constructor(private readonly options: AgentLoopOptions) {}

  async run(input: AgentLoopRunOptions): Promise<AgentLoopResult> {
    const used = [...(input.initialUsed ?? [])];
    const evidence = [...(input.initialEvidence ?? [])];
    const startedAt = Date.now();
    let firstTextAt = 0;
    let calls = 0;
    let model: string | undefined;
    let reply: string | null = null;
    const said: string[] = [];
    const allowed = input.toolAllowed ?? (() => true);

    for (let step = 0; step < (input.maxSteps ?? 6); step++) {
      let thinking = false;
      calls++;
      const response = await this.options.llm.chat(input.messages, {
        tools: this.options.tools.specs().filter((tool) => allowed(tool.name)),
        ...(input.signal ? { signal: input.signal } : {}),
        timeoutMs: input.timeoutMs,
        retries: input.retries,
        ...(input.onEvent ? {
          onText: (text: string) => {
            firstTextAt ||= Date.now();
            input.onEvent!({ type: "delta", text });
          },
          onReasoning: () => {
            if (!thinking) {
              thinking = true;
              input.onEvent!({ type: "thinking" });
            }
          },
        } : {}),
      });

      model = response.model ?? model;
      if (response.content) firstTextAt ||= Date.now();

      if (!response.toolCalls.length) {
        reply = [...said, response.content ?? ""]
          .map((part) => part.trim())
          .filter(Boolean)
          .join("\n\n");
        break;
      }

      if (response.content?.trim()) said.push(response.content);
      input.messages.push({
        role: "assistant",
        content: response.content,
        tool_calls: response.toolCalls,
      });

      for (const call of response.toolCalls) {
        used.push(call.name);
        input.onEvent?.({
          type: "tool",
          phase: "start",
          id: call.id,
          name: call.name,
          args: call.arguments.slice(0, 300),
        });

        const toolStarted = Date.now();
        const result = await this.options.executor.run(
          call.name,
          call.arguments,
          input.signal,
          input.readOnly ?? false,
        );
        const elapsedMs = Date.now() - toolStarted;
        evidence.push({ name: call.name, status: result.status, at: Date.now() });

        try {
          this.options.onToolOutcome?.({
            tool: call.name,
            status: result.status,
            risk: this.options.tools.get(call.name)?.risk ?? "read",
            elapsedMs,
          });
        } catch (error) {
          this.options.log?.warn("tool observer failed", error);
        }

        input.onEvent?.({
          type: "tool",
          phase: "end",
          id: call.id,
          name: call.name,
          status: result.status,
          ms: elapsedMs,
        });
        input.messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: result.text,
        });
      }
    }

    reply ??= "Не удалось завершить задачу за отведённое число шагов.";
    reply = guardToolClaims(reply, evidence, input.request);

    const elapsedMs = Date.now() - startedAt;
    const firstTextMs = firstTextAt ? firstTextAt - startedAt : undefined;
    if (input.logPerformance) {
      const sec = (ms: number) => (ms / 1000).toFixed(1);
      this.options.log?.info(
        `ответ за ${sec(elapsedMs)} с: первый текст через ${firstTextMs !== undefined ? sec(firstTextMs) + " с" : "—"}, ` +
        `запросов к модели ${calls}${used.length ? ", инструменты: " + used.join(", ") : ""}${model ? ", запасная модель " + model : ""}`,
      );
    }

    return {
      reply,
      used,
      evidence,
      calls,
      ...(model ? { model } : {}),
      elapsedMs,
      ...(firstTextMs !== undefined ? { firstTextMs } : {}),
    };
  }
}
