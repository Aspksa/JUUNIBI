export type HealthStatus = "PASS" | "FAIL" | "SKIPPED";
export interface HealthCheck { module: string; status: HealthStatus; durationMs: number; detail: string; at: string }
export interface HealthProbe { module: string; check: () => unknown | Promise<unknown> }
const safeError = (e: unknown) => e instanceof Error ? e.message.slice(0, 240) : String(e).slice(0, 240);
/** Each probe is strictly read-only. No writes, restarts, networking or approvals are attempted. */
export async function functionalHealthCheck(probes: HealthProbe[], now = () => Date.now()): Promise<HealthCheck[]> {
  const results: HealthCheck[] = [];
  for (const p of probes) {
    const start = now();
    try {
      const value = await p.check();
      const outcome = value as { status?: HealthStatus; detail?: string } | undefined;
      const status: HealthStatus = outcome?.status === "FAIL" || outcome?.status === "SKIPPED" ? outcome.status : "PASS";
      results.push({ module: p.module, status, durationMs: Math.max(0, now() - start), detail: typeof outcome?.detail === "string" ? outcome.detail.slice(0, 240) : "Проверка чтения успешно завершена", at: new Date(now()).toISOString() });
    } catch (e) {
      results.push({ module: p.module, status: "FAIL", durationMs: Math.max(0, now() - start), detail: safeError(e), at: new Date(now()).toISOString() });
    }
  }
  return results;
}
