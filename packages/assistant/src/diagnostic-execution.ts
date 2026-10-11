/** Deterministic, read-only diagnostic intent. Never derives a permission from model output. */
export const DIAGNOSTIC_TOOLS = ["list_modules", "computer_status", "computer_processes"] as const;
export function needsModuleDiagnosticExecution(request: string, history: readonly { role: string; content: string }[] = []): boolean {
  const s = request.toLowerCase();
  const planOnly = /(?:составь|напиши|предложи|разработай)\s+(?:мне\s+)?план/u.test(s);
  if (planOnly) return false;
  const execute = /(?:выполни|выполняй|проверь|проведи\s+диагностику|запусти\s+проверку)/u.test(s);
  if (!execute) return false;
  if (/модул|juunibi|компьютер|все\s+(?:пять|5)\s+шагов|все\s+шаги/u.test(s) && /модул|juunibi|компьютер/u.test(s)) return true;
  if (!/все\s+шаги|ещ[её]\s+раз/u.test(s)) return false;
  return history.slice(-10).some(m => /модул|juunibi/u.test(m.content) && /провер|диагностик/u.test(m.content));
}
