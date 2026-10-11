import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

/** Optional Python Deep Agents subprocess, disabled unless explicitly enabled. */
export async function runDeepAgents(prompt: string): Promise<string> {
  if (process.env.JUUNIBI_DEEPAGENTS_ENABLED !== "1") throw Object.assign(new Error("Deep Agents is disabled"), { status: 503 });
  if (!prompt.trim() || prompt.length > 4000) throw Object.assign(new Error("Task must be 1-4000 characters"), { status: 400 });
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const script = path.join(projectRoot, "scripts", "deepagents_bridge.py");
  const python = process.env.JUUNIBI_DEEPAGENTS_PYTHON || (process.platform === "win32" ? path.join(projectRoot, ".venv-deepagents", "Scripts", "python.exe") : path.join(projectRoot, ".venv-deepagents", "bin", "python"));
  return new Promise<string>((resolve, reject) => {
    const child = spawn(python, [script, prompt], { cwd: projectRoot, windowsHide: true, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let size = 0;
    let finished = false;
    const end = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      if (error) reject(error); else resolve(output.trim());
    };
    const timeout = setTimeout(() => { child.kill(); end(Object.assign(new Error("Deep Agents timed out"), { status: 504 })); }, 120000);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 256 * 1024) { child.kill(); end(Object.assign(new Error("Deep Agents output too large"), { status: 502 })); return; }
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", () => { /* provider stderr may include secrets: intentionally discard */ });
    child.on("error", () => end(Object.assign(new Error("Deep Agents Python executable not found"), { status: 503 })));
    child.on("close", (code) => end(code === 0 ? undefined : Object.assign(new Error("Deep Agents subprocess failed"), { status: 502 })));
  });
}
