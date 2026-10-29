import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export const SQLITE_PROBE = "import sqlite3; c = sqlite3.connect(':memory:'); c.execute('select 1'); c.close(); print('JUUNIBI_SQLITE_OK')";

export class PythonUnavailableError extends Error {
  status = 503;
  constructor(info) { super(info.reason ?? "Python 3 не найден"); this.name = "PythonUnavailableError"; this.info = info; }
}

export function pythonCandidates(platform = process.platform, options = {}) {
  const env = options.env ?? process.env;
  const root = options.root ?? env.JUUNIBI_ROOT ?? env.npm_config_local_prefix ?? process.cwd();
  const exists = options.exists ?? existsSync;
  const candidates = [];
  if (env.JUUNIBI_PYTHON?.trim()) candidates.push([env.JUUNIBI_PYTHON.trim(), []]);
  const portable = path.resolve(root, ".runtime", "python", platform === "win32" ? "python.exe" : "bin/python3");
  if (exists(portable)) candidates.push([portable, []]);
  candidates.push(...(platform === "win32" ? [["python", []], ["py", ["-3"]], ["python3", []]] : [["python3", []], ["python", []]]));
  return candidates.filter(([command, args], i, all) => all.findIndex(([c, a]) => c === command && String(a) === String(args)) === i);
}

export function missingPythonMessage(platform) {
  const how = platform === "win32"
    ? "Запустите JUUNIBI.bat: он установит переносной Python в .runtime/python без прав администратора. Для первой загрузки нужен интернет; также можно задать JUUNIBI_PYTHON полным путём к рабочему python.exe."
    : platform === "darwin" ? "Установите Python 3 (например, `brew install python`) и перезапустите JUUNIBI."
    : "Установите Python 3 (например, `sudo apt install python3`) и перезапустите JUUNIBI.";
  return "Для графа знаний, истории версий и показателей нужен рабочий Python 3.8 или новее с SQLite, но он не найден или его установка повреждена. " + how;
}

export async function detectPython(probe, platform = process.platform, options = {}) {
  for (const [command, args] of pythonCandidates(platform, options)) {
    try {
      const r = await probe(command, [...args, "--version"]);
      const m = /Python (3)\.(\d+)\.?(\d*)/.exec(r.output);
      if (r.code !== 0 || !m || Number(m[2]) < 8) continue;
      const sqlite = await probe(command, [...args, "-c", SQLITE_PROBE]);
      if (sqlite.code === 0 && sqlite.output.trim() === "JUUNIBI_SQLITE_OK")
        return { ok: true, command, args, version: `3.${m[2]}${m[3] ? "." + m[3] : ""}` };
    } catch { /* Try the next runtime, including after a broken Windows launcher. */ }
  }
  return { ok: false, reason: missingPythonMessage(platform) };
}

export const probePython = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: 4000 });
  let output = "";
  const take = b => { output = (output + b.toString("utf8")).slice(0, 400); };
  child.stdout.on("data", take); child.stderr.on("data", take);
  child.once("error", reject);
  child.once("close", code => resolve({ code, output }));
});

let cached = null;
export async function pythonInfo(probe = probePython, now = Date.now(), options = {}) {
  const key = JSON.stringify(pythonCandidates(process.platform, options));
  if (cached?.key === key && now >= cached.at && now - cached.at < (cached.info.ok ? 600_000 : 30_000)) return cached.info;
  const info = await detectPython(probe, process.platform, options);
  cached = { key, at: now, info };
  return info;
}
export function resetPythonCache() { cached = null; }
