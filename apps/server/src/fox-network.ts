import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
export interface FoxWifiSnapshot {
  supported: boolean; checkedAt: string; interfaces: string; networks: string;
  meshNote: string; error?: string;
}
const MAX = 12000;
/** Never expose a subprocess error's arguments/command line to the UI. */
export function wlanErrorMessage(error: unknown): string {
  const detail = error && typeof error === "object" ? error as { code?: unknown; stderr?: unknown } : {};
  if (detail.code === "ENOENT") return "Команда netsh не найдена в Windows. Проверьте системные файлы и PATH.";
  const stderr = typeof detail.stderr === "string" ? detail.stderr.toLowerCase() : "";
  if (/service|служб|wlan|беспроводн|wireless|interface|интерфейс|adapter|адаптер/.test(stderr))
    return "Не удалось прочитать Wi-Fi: проверьте адаптер, драйвер и службу «Автонастройка WLAN» (WlanSvc).";
  return "Windows не смогла выполнить диагностику Wi-Fi. Если компьютер подключён по кабелю, это ожидаемо при отсутствии Wi-Fi-адаптера. Проверьте драйвер и службу WlanSvc.";
}
/** Windows netsh WLAN inspection: read-only and never reveals saved Wi-Fi passwords. */
export async function foxWifiSnapshot(platform = process.platform, runner = exec): Promise<FoxWifiSnapshot> {
  const checkedAt = new Date().toISOString();
  const meshNote = "Соседние BSSID могут относиться к Mesh, но принадлежность узлам и backhaul невозможно подтвердить одним сканированием Windows.";
  if (platform !== "win32") return { supported: false, checkedAt, interfaces: "", networks: "", meshNote, error: "Диагностика адаптера доступна только на Windows." };
  const run = async (args: string[]) => {
    const { stdout } = await runner("netsh", args, { windowsHide: true, timeout: 8000, maxBuffer: 512 * 1024 });
    return String(stdout).slice(0, MAX);
  };
  let interfaces: string;
  try {
    interfaces = await run(["wlan", "show", "interfaces"]);
  } catch (error) {
    return { supported:false, checkedAt, interfaces:"", networks:"", meshNote, error:wlanErrorMessage(error) };
  }
  if (/there is no wireless interface|нет беспроводн|беспроводные интерфейсы отсутствуют/i.test(interfaces))
    return {supported:false,checkedAt,interfaces,networks:"",meshNote,error:"Windows не обнаружила Wi-Fi-адаптер. Диагностика роутера по кабелю продолжает работать."};
  try {
    const networks=await run(["wlan", "show", "networks", "mode=bssid"]);
    return {supported:true,checkedAt,interfaces,networks,meshNote};
  } catch (error) {
    return {supported:true,checkedAt,interfaces,networks:"",meshNote,error:"Информация об адаптере получена, но сканирование сетей не удалось. "+wlanErrorMessage(error)};
  }
}
