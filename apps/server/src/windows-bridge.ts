import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

/** Local computer snapshot. No shell, subprocesses, paths, secrets or network calls. */
export function computerSnapshot() {
  const total = os.totalmem();
  const free = os.freemem();
  const cpus = os.cpus();
  return {
    platform: os.platform(),
    release: os.release(),
    architecture: os.arch(),
    cpu: { logicalCores: cpus.length, model: cpus[0]?.model?.slice(0, 100) ?? "unknown" },
    memory: { totalBytes: total, freeBytes: free, usedPercent: total > 0 ? Math.round(100 * (total - free) / total) : 0 },
    uptimeSeconds: Math.floor(os.uptime()),
    safety: "read-only; no commands executed" as const
  };
}

const execFileAsync = promisify(execFile);

/** Parse only tasklist's image and PID columns. Ignore titles, users, command lines and paths. */
export function parseTasklistCsv(csv: string, limit = 60) {
  const items: { name: string; pid: number }[] = [];
  for (const line of csv.split(/\\r?\\n/)) {
    const match = /^"([^"\\r\\n]{1,128})","(\\d{1,10})",/.exec(line.trim());
    if (!match) continue;
    const name = match[1]!;
    const pid = Number(match[2]);
    if (!/^[a-zA-Z0-9_.() -]{1,128}\\.exe$/i.test(name) || !Number.isSafeInteger(pid) || pid <= 0) continue;
    items.push({ name, pid });
    if (items.length >= Math.max(1, Math.min(100, limit))) break;
  }
  return items;
}

/** Only a fixed Windows executable with fixed arguments, never model supplied commands. */
export async function listWindowsProcesses() {
  if (process.platform !== "win32") return { supported: false as const, processes: [], truncated: false };
  const { stdout } = await execFileAsync("tasklist.exe", ["/fo", "csv", "/nh"], {
    windowsHide: true, timeout: 4000, maxBuffer: 512_000, encoding: "utf8"
  });
  const processes = parseTasklistCsv(stdout, 60);
  return { supported: true as const, processes, truncated: stdout.split(/\\r?\\n/).length > processes.length };
}
