/** Post-generation evidence check. Only marks unsupported claims; it never grants tool access. */
export interface ToolEvidence { name: string; status: "ok" | "error" | "denied"; at?: number }
export function guardToolClaims(reply: string, evidence: ToolEvidence[], request = ""): string {
  const succeeded = new Set(evidence.filter(x => x.status === "ok").map(x => x.name));
  const claimed = [...reply.matchAll(/`(list_modules|computer_status|computer_processes|daily_brief)`\s*(?:✅|—\s*(?:выполнен|проверен)|успешно)/giu)].map(x => x[1]!);
  const unsupported = [...new Set(claimed)].filter(name => !succeeded.has(name));
  const moduleClaims = /все\s+(?:\d+\s+)?моду[а-я]+\s+(?:работают|исправны)/iu.test(reply);
  const warnings: string[] = [];
  if (unsupported.length) warnings.push("Не подтверждено журналом текущего ответа: " + unsupported.map(x => "`" + x + "`").join(", ") + ". Эти вызовы могли относиться к прошлой беседе.");
  if (moduleClaims) warnings.push("Статус started подтверждает запуск модулей, но не доказывает исправность всех функций.");
  const base = warnings.length ? reply + "\n\n**Проверка доказательств:** " + warnings.join(" ") : reply;
  const inspection = /(?:проверь|проверить|выполни|выполнить|диагностик|аудит|проверку)/iu.test(request) && /модул|систем|компьютер|процесс/iu.test(request) && !/(?:составь|напиши|предложи)\s+(?:мне\s+)?план/iu.test(request);
  if (!inspection) return base;
  const categories = [
    { label: "Инвентаризация модулей", tool: "list_modules" },
    { label: "Зависимости модулей", tool: "list_modules" },
    { label: "Диагностика компьютера", tool: "computer_status" },
    { label: "Запущенные процессы", tool: "computer_processes" },
  ];
  const rows = categories.map(({ label, tool }) => {
    const checks = evidence.filter(e => e.name === tool);
    const success = checks.find(e => e.status === "ok");
    const status = success ? "Проверено" : checks.length ? "Ошибка/отказ" : "Не проверено";
    const origin = success ? tool + (success.at ? " · " + new Date(success.at).toISOString() : "") : checks.length ? tool + ": " + checks[checks.length - 1]!.status : "нет вызова в текущем запросе";
    return "| " + label + " | " + status + " | " + origin + " |";
  });
  const note = succeeded.has("list_modules") ? "Проверка зависимостей требует анализа фактического содержимого списка; один успешный вызов не доказывает правильность выводов модели." : "Без свежего list_modules текущий статус модулей и их зависимостей не подтверждён.";
  return base + "\n\n**Протокол текущей диагностики (журнал вызовов):**\n\n| Проверка | Статус | Источник |\n|---|---|---|\n" + rows.join("\n") + "\n\n" + note;
}
