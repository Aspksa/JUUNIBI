import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { detectPython, pythonCandidates, pythonInfo, resetPythonCache, SQLITE_PROBE } from "./python-runtime.mjs";

test("portable Python precedes a broken PATH, preserves spaces and does not invoke a shell", async () => {
  const root = path.resolve(tmpdir(), "JUUNIBI тест пробелы");
  const portable = path.join(root, ".runtime", "python", "python.exe");
  const options = { root, env: {}, exists: file => file === portable };
  assert.equal(pythonCandidates("win32", options)[0][0], portable);
  const probed = [];
  const info = await detectPython(async (command, args) => {
    probed.push(command);
    assert.equal(command, portable);
    return { code: 0, output: args.includes(SQLITE_PROBE) ? "JUUNIBI_SQLITE_OK" : "Python 3.14.10" };
  }, "win32", options);
  assert.equal(info.command, portable);
  assert.deepEqual(info.args, []);
  assert.equal(probed.length, 2);
});

test("an explicit runtime is validated and falls back to portable SQLite on failure", async () => {
  const root = path.resolve(tmpdir(), "JUUNIBI");
  const portable = path.join(root, ".runtime", "python", "python.exe");
  const info = await detectPython(async (command, args) => {
    if (command === "broken.exe") return { code: 1, output: "0x80070002" };
    return { code: 0, output: args.includes(SQLITE_PROBE) ? "JUUNIBI_SQLITE_OK" : "Python 3.14.10" };
  }, "win32", { root, env: { JUUNIBI_PYTHON: "broken.exe" }, exists: file => file === portable });
  assert.equal(info.ok, true);
  assert.equal(info.command, portable);
});

test("a newly installed portable runtime invalidates a cached missing result immediately", async () => {
  resetPythonCache();
  let installed = false;
  const options = { root: tmpdir(), env: {}, exists: () => installed };
  const probe = async (command, args) => command.includes(".runtime")
    ? { code: 0, output: args.includes(SQLITE_PROBE) ? "JUUNIBI_SQLITE_OK" : "Python 3.14.10" }
    : { code: 1, output: "missing" };
  assert.equal((await pythonInfo(probe, 1000, options)).ok, false);
  installed = true;
  assert.equal((await pythonInfo(probe, 1001, options)).ok, true);
  resetPythonCache();
});

test("Windows bootstrap rejects a damaged archive and preserves the previous runtime", { skip: process.platform !== "win32" }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "juunibi-bootstrap-"));
  const { mkdir } = await import("node:fs/promises");
  try {
    const dest = path.join(dir, "runtime");
    await mkdir(path.join(dest, "python"), { recursive: true });
    await writeFile(path.join(dest, "python", "owner.txt"), "previous runtime");
    const archive = path.join(dir, "damaged.zip");
    await writeFile(archive, "damaged bytes");
    const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fileURLToPath(new URL("bootstrap-python.ps1", import.meta.url)), "-Dest", dest, "-ArchivePath", archive], { encoding: "utf8", timeout: 30000, windowsHide: true });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /SHA-256 mismatch/);
    assert.deepEqual(await readdir(path.join(dest, "python")), ["owner.txt"]);
    assert.equal((await readdir(dest)).some(file => file.startsWith("python-setup-")), false);
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
