import { spawn } from "node:child_process";

/** SQLite histories and the Brain graph share a verified Python 3 runtime. */
export interface PythonInfo { ok: boolean; command?: string; args?: string[]; version?: string; reason?: string }
export type Probe = (command: string, args: string[]) => Promise<{ code: number | null; output: string }>;

export class PythonUnavailableError extends Error {
  readonly status = 503;
  constructor(readonly info: PythonInfo) { super(info.reason ?? "Python 3 не найден"); this.name = "PythonUnavailableError"; }
}
const MIN_MINOR = 8;
export const SQLITE_PROBE = "import sqlite3; c = sqlite3.connect(':memory:'); c.execute('select 1'); c.close(); print('JUUNIBI_SQLITE_OK')";

export const pythonCandidates = (platform: NodeJS.Platform): [string, string[]][] =>
  platform === "win32" ? [["python", []], ["py", ["-3"]], ["python3", []]] : [["python3", []], ["python", []]];

export function missingPythonMessage(platform: NodeJS.Platform): string {
  const how = platform === "win32"
    ? "Установите Python 3 с python.org (отметьте «Add python.exe to PATH») или из Microsoft Store и перезапустите JUUNIBI."
    : platform === "darwin" ? "Установите Python 3 (например, `brew install python`) и перезапустите JUUNIBI."
    : "Установите Python 3 (например, `sudo apt install python3`) и перезапустите JUUNIBI.";
  return "Для графа знаний, истории версий и показателей нужен рабочий Python 3.8 или новее с SQLite, но он не найден или его установка повреждена. " + how + " Пока всё остальное работает, а история хранится только в браузере.";
}

/** Tries the usual launchers in order. The Windows Store stub prints a hint instead of a version, so it never counts as Python. */
export async function detectPython(probe: Probe, platform: NodeJS.Platform = process.platform): Promise<PythonInfo> {
  for (const [command, args] of pythonCandidates(platform)) {
    try {
      const r = await probe(command, [...args, "--version"]);
      const m = /Python (3)\.(\d+)\.?(\d*)/.exec(r.output);
      if (r.code !== 0 || !m || Number(m[2]) < MIN_MINOR) continue;
      // A launcher may print a version while pointing at a removed installation.
      // Verify execution and sqlite3 before caching it; then try the next launcher on failure.
      const sqlite = await probe(command, [...args, "-c", SQLITE_PROBE]);
      if (sqlite.code === 0 && sqlite.output.trim() === "JUUNIBI_SQLITE_OK")
        return { ok: true, command, args, version: `3.${m[2]}${m[3] ? "." + m[3] : ""}` };
    } catch { /* not installed under this name */ }
  }
  return { ok: false, reason: missingPythonMessage(platform) };
}

const realProbe: Probe = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: 4000 });
  let output = "";
  const take = (b: Buffer) => { output = (output + b.toString("utf8")).slice(0, 400); };
  child.stdout.on("data", take); child.stderr.on("data", take);
  child.once("error", reject);
  child.once("close", (code) => resolve({ code, output }));
});

let cached: { at: number; info: PythonInfo } | null = null;
/** Cached: a found Python is trusted for ten minutes, a missing one is re-checked after half a minute (the person may just have installed it). */
export async function pythonInfo(probe: Probe = realProbe, now = Date.now()): Promise<PythonInfo> {
  if (cached && now - cached.at < (cached.info.ok ? 600_000 : 30_000)) return cached.info;
  const info = await detectPython(probe);
  cached = { at: now, info };
  return info;
}
export function resetPythonCache() { cached = null; }

/** Runs `script database` with a JSON payload on stdin and returns the JSON it prints. */
export async function runPythonJson<T>(script: string, database: string, payload: unknown, info?: PythonInfo): Promise<T> {
  const py = info ?? await pythonInfo();
  if (!py.ok || !py.command) throw new PythonUnavailableError(py);
  return new Promise<T>((resolve, reject) => {
    const child = spawn(py.command!, [...(py.args ?? []), script, database], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let output = "", error = "";
    child.stdout.setEncoding("utf8").on("data", (s: string) => { output += s; if (output.length > 2_000_000) child.kill(); });
    child.stderr.setEncoding("utf8").on("data", (s: string) => { error += s; if (error.length > 4000) child.kill(); });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) { reject(new Error(error.slice(0, 200) || "Python-скрипт завершился с ошибкой")); return; }
      try { resolve(JSON.parse(output) as T); } catch { reject(new Error("Некорректный ответ Python-скрипта")); }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(payload));
  });
}
