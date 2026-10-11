import { describe, expect, it } from "vitest";
import { computerSnapshot } from "./windows-bridge";

describe("local computer bridge", () => {
  it("returns bounded, non-sensitive diagnostics without external actions", () => {
    const data = computerSnapshot();
    expect(data).toMatchObject({ safety: "read-only; no commands executed" });
    expect(typeof data.platform).toBe("string");
    expect(data.cpu.logicalCores).toBeGreaterThanOrEqual(1);
    expect(data.memory.totalBytes).toBeGreaterThan(0);
    expect(data.memory.usedPercent).toBeGreaterThanOrEqual(0);
    expect(data.memory.usedPercent).toBeLessThanOrEqual(100);
    expect(Object.keys(data).sort()).toEqual(["architecture", "cpu", "memory", "platform", "release", "safety", "uptimeSeconds"]);
    expect(JSON.stringify(data)).not.toMatch(/user(name)?|home(dir)?|hostname|ipaddress|macaddress|serialnumber/i);
  });
});
