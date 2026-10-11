/** Detect whether the owner asked for a plan or actual read-only diagnosis.
 * Advisory only: never grants permissions to tools.
 */
export type TaskIntent = "plan" | "execute" | "answer";
export function classifyTaskIntent(text: string): TaskIntent {
  const s = text.toLowerCase();
  const wantsExecution = /(?:проверь|проверить|выполни|выполняй|запусти|протестируй|проведи\s+(?:проверку|диагностику|аудит)|найди\s+ошибки)/u.test(s);
  if (wantsExecution) return "execute";
  if (/(?:составь|напиши|предложи|разработай|дай|покажи)\s+(?:мне\s+)?(?:план|шаги|чеклист)|план\s+(?:из|по)|как\s+проверить/u.test(s)) return "plan";
  return "answer";
}
export function taskExecutionInstructions(text: string): string {
  const intent = classifyTaskIntent(text);
  const base = "В отчёте чётко различай: доступный инструмент, действительно вызванный инструмент и действие, которое нельзя выполнить без разрешения. Статус started доказывает запуск, но не исправность функций. Не приписывай инструменту результат без фактического вызова.";
  if (intent === "plan") return base + " Пользователь просит составить план: изложи проверяемые шаги, не утверждай, что невыполненные проверки сделаны. Не запускай инструменты только ради иллюстрации плана, если это не было отдельно поручено.";
  if (intent === "execute") return base + " Пользователь просит выполнить проверку: делай доступные безопасные чтения и диагностику до формирования отчёта. Не останавливайся для вопроса «продолжать?», если разрешение не требуется. Если инструмент недоступен, честно укажи непроверенный шаг. Запись/изменения выполняй только через существующий механизм разрешений.";
  return base;
}
