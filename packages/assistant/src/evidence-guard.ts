/** Post-generation evidence check. Only marks unsupported claims; it never grants tool access. */
export interface ToolEvidence { name: string; status: "ok" | "error" | "denied"; at?: number; source?: "cache" }
export function guardToolClaims(reply: string, evidence: ToolEvidence[], request = ""): string {
  const succeeded = new Set(evidence.filter(x => x.status === "ok").map(x => x.name));
  const claimed = [...reply.matchAll(/`(list_modules|computer_status|computer_processes|daily_brief)`\s*(?:✅|—\s*(?:выполнен|проверен)|успешно)/giu)].map(x => x[1]!);
  const unsupported = [...new Set(claimed)].filter(name => !succeeded.has(name));
  const moduleClaims = /все\s+(?:\d+\s+)?моду[а-я]+\s+(?:работают|исправны)/iu.test(reply);
  const warnings: string[] = [];
  if (unsupported.length) warnings.push("Не подтверждено журналом текущего ответа: " + unsupported.map(x => "`" + x + "`").join(", ") + ". Эти вызовы могли относиться к прошлой беседе.");
  if (moduleClaims) warnings.push("Статус started подтверждает запуск модулей, но не доказывает исправность всех функций.");
  const allNames = [...new Set(evidence.map(e => e.name))];
  const deniesOtherTools = /(?:только|исключительно)\s+[`«"]?functional_health_check|(?:другие|остальные)\s+инструменты[^.\\n]{0,100}не\s+вызывал/iu.test(reply);
  if (deniesOtherTools && allNames.some(n => n !== "functional_health_check")) {
    warnings.push("В отчёте ошибочно утверждается, что другие инструменты не вызывались. Реальный журнал содержит: " + allNames.join(", ") + ".");
  }
  const base = warnings.length ? reply + "\n\n**Проверка доказательств:** " + warnings.join(" ") : reply;
  const ledger = evidence.length ? "\n\n**Полный журнал инструментов текущего запроса:**\n\n| Инструмент | Результат | Время UTC | Происхождение |\n|---|---|---|---|\n" + evidence.map(e => "| " + e.name + " | " + e.status + " | " + (e.at ? new Date(e.at).toISOString() : "—") + " | " + (e.source === "cache" ? "сохранённые данные" : "текущий вызов") + " |").join("\n") : "";
  const appendLedger = (content: string) => content + ledger;
  // A single functional health request must not be audited as a four-tool system inspection.
  if (/functional_health_check/iu.test(request) || (/функциональн/iu.test(request) && /(?:здоров|диагностик|провер)/iu.test(request))) {
    const checks = evidence.filter(e => e.name === "functional_health_check");
    const ok = checks.find(e => e.status === "ok");
    const status = ok ? "Выполнен" : checks.length ? "Ошибка/отказ" : "Не проверено";
    const source = ok ? "functional_health_check" + (ok.at ? " · " + new Date(ok.at).toISOString() : "") : checks.length ? "functional_health_check: " + checks[checks.length - 1]!.status : "нет вызова";
    return appendLedger(base + "\n\n**Протокол функциональной диагностики (журнал вызовов):**\n\n| Инструмент | Статус вызова | Источник |\n|---|---|---|\n| functional_health_check | " + status + " | " + source + " |\n\nУспешный вызов инструмента не означает PASS каждого внутреннего теста: смотрите результаты семи проверок.");
  }
  const inspection = /(?:проверь|проверить|выполни|выполнить|диагностик|аудит|проверку)/iu.test(request) && /модул|систем|компьютер|процесс/iu.test(request) && !/(?:составь|напиши|предложи)\s+(?:мне\s+)?план/iu.test(request);
  if (!inspection) return appendLedger(base);
  const categories = [
    { label: "Инвентаризация модулей", tool: "list_modules" },
    { label: "Зависимости модулей", tool: "list_modules" },
    { label: "Диагностика компьютера", tool: "computer_status" },
    { label: "Запущенные процессы", tool: "computer_processes" },
  ];
  const rows = categories.map(({ label, tool }) => {
    const checks = evidence.filter(e => e.name === tool);
    const success = checks.find(e => e.status === "ok");
    const status = success?.source === "cache" ? "Повторный отчёт (сохранённые данные)" : success ? "Проверено" : checks.length ? "Ошибка/отказ" : "Не проверено";
    const origin = success ? (success.source === "cache" ? "сохранённый результат " : "") + tool + (success.at ? " · " + new Date(success.at).toISOString() : "") : checks.length ? tool + ": " + checks[checks.length - 1]!.status : "нет вызова в текущем запросе";
    return "| " + label + " | " + status + " | " + origin + " |";
  });
  const note = evidence.some(e => e.source === "cache") ? "Повторный отчёт построен по сохранённым результатам предыдущей попытки. Новые вызовы инструментов для повторно использованных данных не производились." : succeeded.has("list_modules") ? "Проверка зависимостей требует анализа фактического содержимого списка; один успешный вызов не доказывает правильность выводов модели." : "Без свежего list_modules текущий статус модулей и их зависимостей не подтверждён.";
  return appendLedger(base + "\n\n**Протокол текущей диагностики (журнал вызовов):**\n\n| Проверка | Статус | Источник |\n|---|---|---|\n" + rows.join("\n") + "\n\n" + note);
}
