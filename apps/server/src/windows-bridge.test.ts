import { describe, expect, it } from "vitest";
import { computerSnapshot, parseTasklistCsv, listWindowsProcesses } from "./windows-bridge";

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

describe("Windows process inventory", () => {
  it("extracts only safe image names and numeric PIDs", () => {
    const csv = '"chrome.exe","1234","Console","1","22,000 K"\n' +
      '"unsafe/path.exe","44","Console","1","10 K"\n' +
      '"notepad.exe","2345","Console","1","2 K"';
    expect(parseTasklistCsv(csv)).toEqual([{ name: "chrome.exe", pid: 1234 }, { name: "notepad.exe", pid: 2345 }]);
    expect(parseTasklistCsv(csv, 1)).toHaveLength(1);
    expect(parseTasklistCsv('"powershell.exe","0","X","1","10 K"')).toEqual([]);
  });
  it("reports unsupported systems instead of spawning platform commands", async () => {
    if (process.platform !== "win32") expect(await listWindowsProcesses()).toEqual({ supported: false, processes: [], truncated: false });
  });
});
