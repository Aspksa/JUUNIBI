/** Bound the process inventory sent to the LLM; original tool results remain in the short-lived cache. */
export function compactDiagnosticOutput(name: string, raw: string): string {
  if (name !== "computer_processes") return raw.slice(0, 4000);
  try {
    const value: unknown = JSON.parse(raw);
    const processes = Array.isArray(value) ? value : value && typeof value === "object" && "processes" in value && Array.isArray(value.processes) ? value.processes : null;
    if (processes) {
      const counts = new Map<string, number>();
      for (const p of processes) {
        const name = p && typeof p === "object" ? String(p.name ?? p.imageName ?? p.processName ?? "unknown") : String(p);
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      return JSON.stringify({ count: processes.length, distinct: counts.size, byName: [...counts].sort((a,b) => b[1]-a[1]).slice(0, 35), note: "Сокращённый список процессов: не подходит для утверждений об отсутствии вредоносного ПО." });
    }
  } catch { /* tool may return plain text */ }
  return raw.slice(0, 1600) + (raw.length > 1600 ? " [перечень сокращён; полный результат сохранён на сервере для повторного отчёта]" : "");
}
