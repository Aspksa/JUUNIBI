import { describe, expect, it } from "vitest";
import { runIsolatedHealthChecks } from "./functional-health-v5";
describe("isolated functional health 5.0", () => {
  it("tests memory and synthetic error paths without real storage", async () => {
    const checks = await runIsolatedHealthChecks();
    expect(checks.map(x => x.check)).toEqual([
      "memory.pending-approval-search", "approvals.fail-closed-contract",
      "cloudru.error-classification", "updater.transition-evidence",
    ]);
    expect(checks.every(x => x.status === "PASS")).toBe(true);
    expect(checks[0]!.detail).toContain("Реальное хранилище не изменялось");
    expect(checks[2]!.detail).toContain("синтетические");
  });
});
