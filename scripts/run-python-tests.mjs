import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pythonInfo } from "./python-runtime.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const py = await pythonInfo(undefined, Date.now(), { root: process.env.JUUNIBI_ROOT ?? root });
if (!py.ok) { console.error(py.reason); process.exitCode = 1; }
else {
  for (const file of ["archive-sqlite.test.py", "fox-commotion-sqlite.test.py"]) {
    const r = spawnSync(py.command, [...py.args, "-X", "utf8", fileURLToPath(new URL(file, import.meta.url))], { cwd: root, stdio: "inherit", windowsHide: true });
    if (r.status !== 0) { console.error(r.error?.message ?? `Python: ${file}, код ${r.status}`); process.exitCode = 1; break; }
  }
}
