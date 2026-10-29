import { spawn } from "node:child_process";
import { pythonInfo, PythonUnavailableError, type PythonInfo } from "../../../scripts/python-runtime.mjs";
export { detectPython, missingPythonMessage, pythonCandidates, pythonInfo, resetPythonCache, PythonUnavailableError, SQLITE_PROBE } from "../../../scripts/python-runtime.mjs";
export type { PythonInfo, Probe } from "../../../scripts/python-runtime.mjs";

/** Runs `script database` with a JSON payload on stdin and returns the JSON it prints. */
export async function runPythonJson<T>(script: string, database: string, payload: unknown, info?: PythonInfo): Promise<T> {
  const py = info ?? await pythonInfo();
  if (!py.ok || !py.command) throw new PythonUnavailableError(py);
  return new Promise<T>((resolve, reject) => {
    const child = spawn(py.command!, [...(py.args ?? []), "-X", "utf8", script, database], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
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
