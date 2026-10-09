import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Kernel, Logger } from "@juunibi/core";
import { Assistant, CloudRuProvider, CloudEmbeddingProvider, Memory, ApprovalGate, type StorageAdapter } from "@juunibi/assistant";
import { createApp } from "./app";
import { ProjectUpdater } from "./updater";
import { SceneEngine } from "./scenes";
import { BrainCore } from "./brain";
import { AutonomousLearning } from "./autonomous-learning";
import { KnowledgeLedger } from "./knowledge-ledger";
import { durableMemoryStore } from "./durable-memory-store";

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
const brain = new BrainCore(() => cloudConfigured, fileStore(path.join(dataDir, "brain.json")));
const updateTimer = setInterval(() => { void updater.check().catch((e) => log.warn("Не удалось проверить обновления", e)); }, 15 * 60_000);
void updater.check().catch((e) => log.warn("Не удалось проверить обновления", e));
const settingsFile = path.join(dataDir, "cloudru-settings.json");
const MODEL = "deepseek-ai/DeepSeek-V4-Flash";
let activeModel: string | undefined;
let cloudConfigured = false;
let sceneLlm: CloudRuProvider | undefined;
const knowledge = new KnowledgeLedger(path.join(dataDir, "verified-knowledge.json"));
let learningKey: string | undefined;
const learning = new AutonomousLearning(path.join(dataDir, "autonomous-learning.json"), async (question, maxTokens) => {
  if (!learningKey) throw new Error("Cloud.ru не настроен");
  const base = (process.env.CLOUDRU_BASE_URL ?? "https://foundation-models.api.cloud.ru/v1").replace(/\/$/, "");
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), 25000);
  try {
    const response = await fetch(base + "/chat/completions", {
      method: "POST", signal: ctl.signal,
      headers: { "Authorization": "Bearer " + learningKey, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: question }],
        max_tokens: maxTokens, temperature: 0.3 }),
    });
    if (!response.ok) throw new Error("Cloud.ru status " + response.status);
    const json = await response.json() as { choices?: { message?: { content?: string } }[]; usage?: { total_tokens?: number } };
    return { text: json.choices?.[0]?.message?.content ?? "", tokens: json.usage?.total_tokens ?? 1500 };
  } finally { clearTimeout(timeout); }
}, () => moduleList().map(m => m.name), async fact => {
  knowledge.addVerified({ topic: "математика", ...fact, evidence: "deterministic-test" });
  await knowledge.flush();
}, () => knowledge.gaps());
const scenes = new SceneEngine(root, () => sceneLlm);
await scenes.init();
await brain.load();
await learning.load();
await knowledge.load();
interface ModuleInfo { name: string; title: string; deps: string[]; status: "started" | "pending" | "failed"; note: string }
/** Real server components with their live state — shown on the Modules page and given to the assistant. */
function moduleList(): ModuleInfo[] {
  const sc = scenes.stats();
  const up = updater.status();
  return [
    { name: "brain", title: "Мозг JUUNIBI", deps: ["memory", "assistant", "approvals"], status: "started", note: `Режим: ${brain.status().mode} · планов: ${brain.status().plans.length} · выполнение действий через подтверждения` },
    { name: "memory", title: "Память", deps: [], status: "started", note: "Долгая память помощницы: data/memory.json" },
    { name: "assistant", title: "Помощница", deps: ["memory"], status: cloudConfigured ? "started" : "pending", note: cloudConfigured ? `Модель ${activeModel ?? MODEL} (Cloud.ru)` : "Нужен ключ Cloud.ru — добавьте его в настройках" },
    { name: "approvals", title: "Подтверждение действий", deps: ["assistant"], status: "started", note: "Опасные действия выполняются только с вашего разрешения; журнал в data/agent-audit.jsonl" },
    { name: "scenes", title: "Сцены и реплики", deps: [], status: sc.total > 0 ? "started" : "failed", note: `${sc.total} действий, ${sc.phrases} реплик, использовано ${sc.used}` },
    { name: "updater", title: "Обновление проекта", deps: [], status: up.phase === "error" ? "failed" : "started", note: up.phase === "error" ? (up.error ?? "Ошибка обновления") : `Источник github.com/Aspksa/JUUNIBI · этап: ${up.phase}` },
    ...kernel.describe().map((m) => ({ name: m.name, title: m.name, deps: m.deps, status: m.status, note: "" })),
  ];
}
const memory = new Memory(durableMemoryStore(path.join(dataDir, "memory.json")));
// Reuse the configured chat credential; embeddings use a separate model, never the chat model.
const embeddingModel = process.env.CLOUDRU_EMBEDDING_MODEL;
let assistant: Assistant | undefined;
let approvalGate: ApprovalGate;
async function configureCloud(apiKey: string, baseUrl?: string) {
  const llm = new CloudRuProvider({ apiKey, model: MODEL, ...(baseUrl ? { baseUrl } : {}) });
  sceneLlm = llm;
  learningKey = apiKey;
  const embeddingBaseUrl = process.env.CLOUDRU_EMBEDDING_BASE_URL ?? baseUrl;
  if (embeddingModel) memory.setEmbeddingProvider(new CloudEmbeddingProvider({ apiKey, model: embeddingModel, ...(embeddingBaseUrl ? { baseUrl: embeddingBaseUrl } : {}) }));
  const character = JSON.parse(await readFile(path.join(root, "apps", "server", "assets", "JUUNIBI_character_v1.json"), "utf8"));
  const persona = [
    "Ты — JUUNIBI, мифическая двенадцатихвостая лисица, личная помощница и хранительница Дома Лисы.",
    character.personality.core_description,
    "Говори по-русски естественно, тепло и точно. Обращение «Господин» используй умеренно, не в каждом предложении.",
    "Не выдавай художественный образ за реальное сознание или реальные чувства. Не обещай невыполненных действий. Перед публикациями, удалениями и иными существенными действиями проси разрешение.",
    "Сцены действий и реплики из библиотеки отображаются отдельно от твоего содержательного ответа. Не повторяй вступительную самопрезентацию на каждое сообщение."
  ].join("\\n");
  assistant = new Assistant({ persona, llm, memory, turnsStore: fileStore(path.join(dataDir, "turns.json")), onToolOutcome: event => brain.observeToolOutcome(event), approve: (req) => approvalGate.request(req, req.signal), describeModules: () => moduleList(), describeBrain: () => ({ mode: brain.status().mode, plans: brain.status().plans.slice(0, 5) }) });
  assistant.tools.register({
    name: "brain_get_plans", risk: "read", description: "Прочитать планы задач.",
    parameters: { type: "object", properties: {} },
    run: () => brain.status().plans,
  });
  assistant.tools.register({
    name: "brain_create_plan", risk: "write", description: "Создать план после разрешения пользователя. Создание плана не исполняет шаги.",
    parameters: { type: "object", properties: { goal: { type: "string" }, steps: { type: "array", items: { type: "string" } } }, required: ["goal", "steps"] },
    run: (args) => brain.plan(args.goal, args.steps),
  });
  assistant.tools.register({
    name: "brain_run_safe_plan",
    risk: "write",
    description: "Создать план и автоматически выполнить его разрешённые шаги чтения после одного подтверждения пользователя. Разрешены только list_modules и search_memory.",
    parameters: { type: "object", properties: {
      goal: { type: "string" },
      steps: { type: "array", items: { type: "string" } },
      actions: { type: "array", items: { type: "string", enum: ["list_modules", "search_memory"] } },
    }, required: ["goal", "steps", "actions"] },
    run: async (args) => {
      if (!Array.isArray(args.steps) || !Array.isArray(args.actions) || args.steps.length !== args.actions.length ||
        !args.actions.every(a => a === "list_modules" || a === "search_memory")) throw new Error("Недопустимые действия");
      const plan = brain.plan(args.goal, args.steps);
      await brain.flush();
      return brain.executeSequence(plan.id, args.actions, () => moduleList(),
        async query => (await memory.search(query, 8)).map(item => item.text));
    },
  });
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


const hint = "Откройте раздел «Настройки» и укажите ключ Cloud.ru.";

await kernel.start();

const port = Number(process.env.PORT ?? 4173);
const staticDir = process.env.STATIC_DIR ?? path.join(root, "apps", "web", "dist");
const server = createApp({
  getAssistant: () => assistant,
  cloudStatus: () => ({ configured: cloudConfigured, model: MODEL }),
  saveCloud,
  memory,
  approvals: approvalGate,
  updater,
  brain,
  learning,
  knowledge,
  scenes,
  modules: () => moduleList(),
  staticDir,
  configured: { model: MODEL, hint },
});
server.listen(port, "127.0.0.1", () => log.info(`http://127.0.0.1:${port}/`));

const learningTimer = setInterval(() => { if (cloudConfigured) void learning.tick(); }, 10 * 60_000);
const shutdown = async () => { clearInterval(learningTimer); clearInterval(updateTimer); approvalGate.denyAll(); server.close(); await kernel.stop(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
