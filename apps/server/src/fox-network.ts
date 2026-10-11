import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
export interface FoxWifiSnapshot {
  supported: boolean; checkedAt: string; interfaces: string; networks: string;
  meshNote: string; error?: string;
}
const MAX = 12000;
/** Windows netsh uses the OS WLAN service. Read-only commands: no profile/password export, no connection changes. */
export async function foxWifiSnapshot(platform = process.platform, runner = exec): Promise<FoxWifiSnapshot> {
  const checkedAt = new Date().toISOString();
  const meshNote = "Соседние BSSID могут относиться к Mesh, но принадлежность узлам и backhaul невозможно подтвердить одним сканированием Windows.";
  if (platform !== "win32") return { supported: false, checkedAt, interfaces: "", networks: "", meshNote, error: "Диагностика адаптера доступна только на Windows." };
  const run = async (args: string[]) => {
    const { stdout } = await runner("netsh", args, { windowsHide: true, timeout: 8000, maxBuffer: 512 * 1024 });
    return String(stdout).slice(0, MAX);
  };
  try {
    const interfaces = await run(["wlan", "show", "interfaces"]);
    const networks = await run(["wlan", "show", "networks", "mode=bssid"]);
    return { supported: true, checkedAt, interfaces, networks, meshNote };
  } catch (error) {
    return { supported: false, checkedAt, interfaces: "", networks: "", meshNote, error: error instanceof Error ? error.message.slice(0, 240) : "Wi-Fi интерфейс недоступен" };
  }
}
