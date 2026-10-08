import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Kernel, Logger } from "@juunibi/core";
import { Assistant, CloudRuProvider, Memory, assistantPlugin, ApprovalGate, type StorageAdapter } from "@juunibi/assistant";
import { createApp } from "./app";
import { ProjectUpdater } from "./updater";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Tiny .env reader (no dependency). Real environment variables win. */
function loadEnv(file: string) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trimStart().startsWith("#") && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, "$2");
  }
}
loadEnv(path.join(root, ".env"));

/** JSON file with atomic replace, so a crash never leaves half-written memory. */
function fileStore(file: string): StorageAdapter {
  return {
    async load() { try { return await readFile(file, "utf8"); } catch { return null; } },
    async save(data) {
      await mkdir(path.dirname(file), { recursive: true });
      const tmp = file + ".tmp";
      await writeFile(tmp, data);
      await rename(tmp, file);
    },
  };
}

const log = new Logger("server", "info");
const kernel = new Kernel(log);
const dataDir = path.join(root, "data");
const updater = new ProjectUpdater(root);
const updateTimer = setInterval(() => { void updater.check().catch((e) => log.warn("Не удалось проверить обновления", e)); }, 15 * 60_000);
void updater.check().catch((e) => log.warn("Не удалось проверить обновления", e));
const { CLOUDRU_API_KEY: apiKey, CLOUDRU_MODEL: model, CLOUDRU_BASE_URL: baseUrl } = process.env;

let assistant: Assistant | undefined;
const approvalGate = new ApprovalGate(async (event) => {
  await mkdir(dataDir, { recursive: true });
  await auditWrite(event);
});
let auditQueue = Promise.resolve();
function auditWrite(event: unknown): Promise<void> {
  const line = JSON.stringify(event) + "\n";
  auditQueue = auditQueue.then(async () => {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(path.join(dataDir, "agent-audit.jsonl"), line, { mode: 0o600 });
  });
  return auditQueue;
}
let hint: string | undefined;
if (apiKey && model) {
  const llm = new CloudRuProvider({ apiKey, model, ...(baseUrl ? { baseUrl } : {}) });
  kernel.register(
    assistantPlugin(
      { llm, memory: new Memory(fileStore(path.join(dataDir, "memory.json"))), turnsStore: fileStore(path.join(dataDir, "turns.json")), approve: (req) => approvalGate.request(req, req.signal) },
      () => kernel.describe(),
      (a) => (assistant = a),
    ),
  );
} else {
  hint = "Скопируйте .env.example в .env и укажите CLOUDRU_API_KEY и CLOUDRU_MODEL, затем перезапустите.";
  log.warn(hint);
}

await kernel.start();

const port = Number(process.env.PORT ?? 4173);
const staticDir = process.env.STATIC_DIR ?? path.join(root, "apps", "web", "dist");
const server = createApp({
  assistant,
  approvals: approvalGate,
  updater,
  modules: () => kernel.describe(),
  staticDir,
  configured: { ...(model ? { model } : {}), ...(hint ? { hint } : {}) },
});
server.listen(port, "127.0.0.1", () => log.info(`http://127.0.0.1:${port}/`));

const shutdown = async () => { clearInterval(updateTimer); approvalGate.denyAll(); server.close(); await kernel.stop(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
