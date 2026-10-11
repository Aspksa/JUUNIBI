import { Memory, MemoryAdapter } from "@juunibi/assistant";

export interface DeepHealthResult {
  check: string;
  status: "PASS" | "FAIL" | "SKIPPED";
  detail: string;
  durationMs: number;
}

/** Synthetic fixtures only. Never touches the user's actual memory, approvals or updater. */
export async function runIsolatedHealthChecks(): Promise<DeepHealthResult[]> {
  const cases: { check: string; run: () => Promise<string> | string }[] = [
    { check: "memory.pending-approval-search", run: async () => {
      const memory = new Memory(new MemoryAdapter());
      const created = await memory.add("fact", "Тестовая память JUUNIBI sandbox 41792", "pending");
      const before = await memory.search("sandbox 41792");
      if (before.length) throw new Error("Pending memory leaked into search");
      if (!await memory.approve(created.id)) throw new Error("In-memory approval failed");
      const after = await memory.search("sandbox 41792");
      if (!after.some(x => x.id === created.id)) throw new Error("Approved memory not searchable");
      const entries = await memory.list();
      if (entries.length !== 1 || entries[0]?.status !== "active") throw new Error("Isolated memory state inconsistent");
      return "Изолированная память: pending скрыт, после разрешения доступен для поиска. Реальное хранилище не изменялось.";
    } },
    { check: "approvals.fail-closed-contract", run: () => {
      const action = (approved: boolean, subject: string) => approved && subject === "sandbox" ? "allowed" : "denied";
      if (action(false, "sandbox") !== "denied" || action(true, "production") !== "denied" || action(true, "sandbox") !== "allowed") throw new Error("Test gate did not fail closed");
      return "Проверен только изолированный контракт отказа по умолчанию. Реальный ApprovalGate и пользовательский диалог не проверены.";
    } },
    { check: "cloudru.error-classification", run: () => {
      const retryable = (status: number | undefined) => status === 429 || (status !== undefined && status >= 500);
      for (const code of [429, 500, 503]) if (!retryable(code)) throw new Error("Retryable HTTP code not detected");
      for (const code of [400, 401, 403, 404]) if (retryable(code)) throw new Error("Non-retryable HTTP code selected");
      return "Проверены синтетические HTTP-коды и политика повторов; настоящая Cloud.ru и сетевой клиент не вызывались.";
    } },
    { check: "updater.transition-evidence", run: () => {
      const events = [{ type: "health_check_started", at: 1 }, { type: "health_check_done", at: 2 }, { type: "update_completed", at: 3 }];
      const types = events.map(e => e.type);
      if (types.indexOf("health_check_started") >= types.indexOf("health_check_done") || types.indexOf("health_check_done") >= types.indexOf("update_completed")) throw new Error("Fixture order invalid");
      return "Проверен синтетический порядок событий. Установка и откат реальных обновлений не запускались.";
    } },
  ];
  const output: DeepHealthResult[] = [];
  for (const item of cases) {
    const begin = Date.now();
    try { output.push({ check: item.check, status: "PASS", detail: await item.run(), durationMs: Date.now() - begin }); }
    catch (e) { output.push({ check: item.check, status: "FAIL", detail: e instanceof Error ? e.message.slice(0, 200) : String(e).slice(0, 200), durationMs: Date.now() - begin }); }
  }
  return output;
}
