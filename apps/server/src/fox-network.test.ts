import { describe, expect, it } from "vitest";
import { foxWifiSnapshot } from "./fox-network";
describe("Fox Network read-only scanner", () => {
  it("does not invoke netsh on unsupported platforms", async () => {
    const result = await foxWifiSnapshot("linux", async () => { throw new Error("must not run"); });
    expect(result.supported).toBe(false);
  });
  it("calls only the read-only Windows WLAN commands", async () => {
    const calls: string[] = [];
    const runner = async (file: string, args: string[]) => {
      calls.push(file + " " + args.join(" "));
      return { stdout: "SSID : FoxNet\nSignal : 82%\nChannel : 36" };
    };
    const result = await foxWifiSnapshot("win32", runner as any);
    expect(result.supported).toBe(true);
    expect(calls).toEqual(["netsh wlan show interfaces", "netsh wlan show networks mode=bssid"]);
    expect(result.interfaces).toContain("FoxNet");
  });
  it("fails safely when Windows WLAN is unavailable", async () => {
    const result = await foxWifiSnapshot("win32", (async () => { throw new Error("no WLAN"); }) as any);
    expect(result.supported).toBe(false);
    expect(result.error).toContain("no WLAN");
  });
});
