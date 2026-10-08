import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Kernel, Logger } from "@juunibi/core";
import { Assistant, CloudRuProvider, Memory, ApprovalGate, type StorageAdapter } from "@juunibi/assistant";
import { createApp } from "./app";
import { ProjectUpdater } from "./updater";
import { SceneEngine } from "./scenes";

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
const settingsFile = path.join(dataDir, "cloudru-settings.json");
const MODEL = "deepseek-ai/DeepSeek-V4-Flash";
let activeModel: string | undefined;
let cloudConfigured = false;
let sceneLlm: CloudRuProvider | undefined;
const scenes = new SceneEngine(root, () => sceneLlm);
await scenes.init();
let assistant: Assistant | undefined;
let approvalGate: ApprovalGate;
async function configureCloud(apiKey: string, baseUrl?: string) {
  const llm = new CloudRuProvider({ apiKey, model: MODEL, ...(baseUrl ? { baseUrl } : {}) });
  sceneLlm = llm;
  const character = JSON.parse(await readFile(path.join(root, "apps", "server", "assets", "JUUNIBI_character_v1.json"), "utf8"));
  const persona = [
    "Ты — JUUNIBI, мифическая двенадцатихвостая лисица, личная помощница и хранительница Дома Лисы.",
    character.personality.core_description,
    "Говори по-русски естественно, тепло и точно. Обращение «Господин» используй умеренно, не в каждом предложении.",
    "Не выдавай художественный образ за реальное сознание или реальные чувства. Не обещай невыполненных действий. Перед публикациями, удалениями и иными существенными действиями проси разрешение.",
    "Сцены действий и реплики из библиотеки отображаются отдельно от твоего содержательного ответа. Не повторяй вступительную самопрезентацию на каждое сообщение."
  ].join("\\n");
  assistant = new Assistant({ persona, llm, memory: new Memory(fileStore(path.join(dataDir, "memory.json"))), turnsStore: fileStore(path.join(dataDir, "turns.json")), approve: (req) => approvalGate.request(req, req.signal), describeModules: () => kernel.describe() });
  activeModel = MODEL;
  cloudConfigured = true;
}
async function saveCloud(apiKey: string) {
  if (!apiKey || apiKey.length > 4096 || /[\r\n]/.test(apiKey)) throw Object.assign(new Error("Некорректный API-ключ"), { status: 400 });
  await mkdir(dataDir, { recursive: true });
  const tmp = settingsFile + ".tmp";
  await writeFile(tmp, JSON.stringify({ apiKey }), { mode: 0o600 });
  await rename(tmp, settingsFile);
  await configureCloud(apiKey, process.env.CLOUDRU_BASE_URL);
}
approvalGate = new ApprovalGate(async (event) => {
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
try {
  const stored = JSON.parse(await readFile(settingsFile, "utf8")) as { apiKey?: string };
  if (stored.apiKey) await configureCloud(stored.apiKey, process.env.CLOUDRU_BASE_URL);
} catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") log.warn("Настройки Cloud.ru не загружены", (e as Error).message); }
if (!cloudConfigured && process.env.CLOUDRU_API_KEY) await configureCloud(process.env.CLOUDRU_API_KEY, process.env.CLOUDRU_BASE_URL);


const hint = "Откройте вкладку «Настройки» и укажите ключ Cloud.ru.";

await kernel.start();

const port = Number(process.env.PORT ?? 4173);
const staticDir = process.env.STATIC_DIR ?? path.join(root, "apps", "web", "dist");
const server = createApp({
  getAssistant: () => assistant,
  cloudStatus: () => ({ configured: cloudConfigured, model: MODEL }),
  saveCloud,
  approvals: approvalGate,
  updater,
  scenes,
  modules: () => kernel.describe(),
  staticDir,
  configured: { model: MODEL, hint },
});
server.listen(port, "127.0.0.1", () => log.info(`http://127.0.0.1:${port}/`));

const shutdown = async () => { clearInterval(updateTimer); approvalGate.denyAll(); server.close(); await kernel.stop(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
