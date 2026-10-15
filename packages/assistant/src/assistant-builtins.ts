import { Memory } from "./memory";
import { ToolRegistry } from "./tools";

export interface AssistantBuiltinOptions {
  tools: ToolRegistry;
  memory: Memory;
  describeModules?: () => unknown;
}

/** Register the small trusted builtin tool surface owned by the assistant package. */
export function registerAssistantBuiltins(options: AssistantBuiltinOptions): void {
  const { tools, memory } = options;
  tools.register({
    name: "list_modules",
    risk: "read",
    description: "Список модулей проекта JUUNIBI и их состояние.",
    parameters: { type: "object", properties: {} },
    run: () => options.describeModules?.() ?? [],
  });
  tools.register({
    name: "search_memory",
    risk: "read",
    description: "Поиск по долгой памяти ассистента.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    run: async (args) =>
      (await memory.searchHybrid(String(args.query), 8)).map((entry) => ({
        id: entry.id,
        text: entry.text,
      })),
  });
  tools.register({
    name: "propose_memory_revision",
    risk: "read",
    description: "Предложить исправление старого факта, ожидающее подтверждения пользователя.",
    parameters: {
      type: "object",
      properties: {
        oldId: { type: "string" },
        newText: { type: "string" },
      },
      required: ["oldId", "newText"],
    },
    run: async (args) => {
      const result = await memory.proposeRevision(String(args.oldId), String(args.newText));
      return result ? "Ожидает подтверждения: " + result.id : "Не создано";
    },
  });
  tools.register({
    name: "remember",
    risk: "read",
    description: "Предложить запомнить факт/предпочтение. Запись станет активной только после подтверждения пользователя.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string" },
        kind: { type: "string", enum: ["fact", "preference", "lesson"] },
      },
      required: ["text"],
    },
    run: async (args) => {
      const kind = args.kind === "preference" || args.kind === "lesson" ? args.kind : "fact";
      await memory.add(kind, String(args.text), "pending");
      return "Предложено; ждёт подтверждения пользователя.";
    },
  });
}
