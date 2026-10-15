import { reviewDangerousTool } from "./action-review";
import { validateToolArgs } from "./security";
import type { Risk } from "./tools";
import { ToolRegistry } from "./tools";

export type ToolStatus = "ok" | "error" | "denied";

export interface ApprovalRequest {
  tool: string;
  args: Record<string, unknown>;
  risk: Risk;
  signal?: AbortSignal;
}

export interface ToolExecutionLog {
  info(message: string): void;
  warn(message: string, error?: unknown): void;
}

export interface ToolExecutorOptions {
  tools: ToolRegistry;
  approve?: (req: ApprovalRequest) => Promise<boolean> | boolean;
  /** Owner policy can only narrow access to already registered tools. */
  toolPolicy?: (tool: string) => boolean;
  log?: ToolExecutionLog;
  maxOutput?: number;
}

const DEFAULT_MAX_OUTPUT = 8000;

/**
 * Single fail-closed path for all assistant tool execution.
 * Order is intentional: parse -> schema -> owner policy -> danger preflight -> read-only gate -> approval -> run.
 */
export class ToolExecutor {
  constructor(private readonly options: ToolExecutorOptions) {}

  async run(name: string, rawArgs: string, signal?: AbortSignal, readOnly = false): Promise<{ text: string; status: ToolStatus }> {
    const error = (text: string) => ({ text, status: "error" as const });
    const tool = this.options.tools.get(name);
    if (!tool) return error(`Ошибка: инструмента "${name}" нет.`);

    let args: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(rawArgs || "{}");
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
      args = parsed as Record<string, unknown>;
    } catch {
      return error("Ошибка: аргументы должны быть JSON-объектом.");
    }

    const invalid = validateToolArgs(tool.parameters, args);
    if (invalid) return error(`Ошибка: ${invalid.charAt(0).toLowerCase() + invalid.slice(1)}.`);

    if (this.options.toolPolicy?.(name) === false) {
      return { text: "Отказано: инструмент отключён владельцем в разделе «Модули».", status: "denied" };
    }

    const preflight = reviewDangerousTool(tool);
    if (!preflight.valid) {
      this.options.log?.warn(`tool ${name} denied by structured preflight: ${preflight.blockers.join("; ")}`);
      return { text: "Отказано: " + preflight.blockers.join("; "), status: "denied" };
    }

    if (readOnly && tool.risk !== "read") {
      return { text: "Отказано: проверка качества не выполняет действий.", status: "denied" };
    }

    if (tool.risk !== "read") {
      const approved = this.options.approve
        ? await this.options.approve({ tool: name, args, risk: tool.risk, ...(signal ? { signal } : {}) })
        : false;
      this.options.log?.info(`tool ${name} (${tool.risk}) ${approved ? "approved" : "denied"}`);
      if (!approved) {
        return { text: "Отказано: действие не одобрено супервайзером/пользователем.", status: "denied" };
      }
    }

    try {
      const out = await tool.run(args);
      const text = typeof out === "string" ? out : JSON.stringify(out) ?? "null";
      const maxOutput = this.options.maxOutput ?? DEFAULT_MAX_OUTPUT;
      return { text: text.length > maxOutput ? text.slice(0, maxOutput) + "…[обрезано]" : text, status: "ok" };
    } catch (cause) {
      this.options.log?.warn(`tool ${name} failed`, cause);
      return error(`Ошибка инструмента: ${(cause as Error).message}`);
    }
  }
}
