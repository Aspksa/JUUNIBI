import { describe, expect, it } from "vitest";
import { functionalHealthCheck } from "./functional-health";

describe("functional health", () => {
  it("reports PASS FAIL SKIPPED independently without mutating state", async () => {
    const result = await functionalHealthCheck([
      { module: "brain", check: () => ({ detail: "ok" }) },
      { module: "memory", check: () => { throw new Error("read failed"); } },
      { module: "mobile", check: () => ({ status: "SKIPPED", detail: "Wi-Fi off" }) },
    ], () => 1000);
    expect(result.map(x => x.status)).toEqual(["PASS", "FAIL", "SKIPPED"]);
    expect(result[1]!.detail).toContain("read failed");
    expect(result[2]!.detail).toContain("Wi-Fi off");
    expect(result.every(x => x.durationMs === 0)).toBe(true);
  });
  it("passes through completed asynchronous read checks", async () => {
    const result = await functionalHealthCheck([{ module: "memory", check: async () => ({ detail: "available" }) }]);
    expect(result[0]!.status).toBe("PASS");
  });
});
