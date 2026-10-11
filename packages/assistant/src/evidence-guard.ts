/** Post-generation evidence check. Only marks unsupported claims; it never grants tool access. */
export interface ToolEvidence { name: string; status: "ok" | "error" | "denied" }
export function guardToolClaims(reply: string, evidence: ToolEvidence[]): string {
  const succeeded = new Set(evidence.filter(x => x.status === "ok").map(x => x.name));
  const claimed = [...reply.matchAll(/`(list_modules|computer_status|computer_processes|daily_brief)`s*(?:✅|—s*(?:выполнен|проверен)|успешно)/giu)].map(x => x[1]!);
  const unsupported = [...new Set(claimed)].filter(name => !succeeded.has(name));
  const moduleClaims = /(?:всеs+(?:7s+)?модул[ьяеи]+s+(?:работают|исправны)|всеs+d+s+модул[ьяеи]+s+(?:работают|исправны))/iu.test(reply);
  const warnings: string[] = [];
  if (unsupported.length) warnings.push("Не подтверждено журналом текущего ответа: " + unsupported.map(x => "`" + x + "`").join(", ") + ". Эти вызовы могли относиться к прошлой беседе.");
  if (moduleClaims) warnings.push("Статус started подтверждает запуск модулей, но не доказывает исправность всех функций.");
  return warnings.length ? reply + "\n\n**Проверка доказательств:** " + warnings.join(" ") : reply;
}
