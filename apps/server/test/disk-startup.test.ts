import { describe, expect, it } from "vitest";
import { build } from "esbuild";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = fileURLToPath(new URL("../../../", import.meta.url));
describe("Disk startup recovery", () => {
  it("starts the real server with a corrupt Disk index while preserving it and its objects", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "juunibi-startup-"));
    const probe = createServer(); probe.listen(0, "127.0.0.1"); await once(probe, "listening");
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>(resolve => probe.close(() => resolve()));
    let child: ReturnType<typeof spawn> | undefined;
    try {
      const outfile = path.join(root, "apps", "server", "dist", "server.mjs");
      await build({ absWorkingDir: project, entryPoints: ["apps/server/src/main.ts"], bundle: true, platform: "node", format: "esm", target: "node20", outfile,
        banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
      await cp(path.join(project, "apps", "server", "assets"), path.join(root, "apps", "server", "assets"), { recursive: true });
      const disk = path.join(root, "data", "disk"); await mkdir(path.join(disk, "objects"), { recursive: true });
      await writeFile(path.join(disk, "index.json"), "{broken");
      await writeFile(path.join(disk, "objects", "preserved"), "original bytes");
      child = spawn(process.execPath, [outfile], { cwd: root, env: { ...process.env, PORT: String(port), CLOUDRU_API_KEY: "" }, stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Server did not start: " + output)), 10_000);
        child!.stdout!.on("data", chunk => { output += chunk.toString(); if (output.includes(`http://127.0.0.1:${port}/`)) { clearTimeout(timer); resolve(); } });
        child!.stderr!.on("data", chunk => { output += chunk.toString(); });
        child!.once("error", error => { clearTimeout(timer); reject(error); });
        child!.once("exit", code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${output}`)); });
      });
      const response = await fetch(`http://127.0.0.1:${port}/api/status`); expect(response.status).toBe(200);
      const catalog = await fetch(`http://127.0.0.1:${port}/api/disk`); expect(catalog.status).toBe(200);
      expect((await catalog.json() as { files: unknown[] }).files).toEqual([]);
      const preserved = (await readdir(disk)).find(name => name.startsWith("index.json.corrupt-")); expect(preserved).toBeDefined();
      expect(await readFile(path.join(disk, preserved!), "utf8")).toBe("{broken");
      expect(await readFile(path.join(disk, "objects", "preserved"), "utf8")).toBe("original bytes");
      expect(output).toContain("Диск");
    } finally {
      if (child && child.exitCode === null) { const stopped = once(child, "exit"); child.kill(); await stopped; }
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);
});
