import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Assistant, ApprovalGate } from "@juunibi/assistant";

import type { ProjectUpdater } from "./updater";
import type { SceneEngine } from "./scenes";
import type { BrainCore } from "./brain";
import type { automaticBrainReview } from "./brain-v41-automatic";
import type { PlanOption, PlanLimits } from "./plan-evaluator";
import type { SequenceStep } from "./sequence-simulator";
import type { DecisionBranch, DecisionEvent } from "./decision-tree";
import type { LearningCase } from "./learning-repair-review";
import type { ReasoningClaim, ReasoningEvidence } from "./reasoning-review";
import type { ReasoningExample, ReasoningRevision, RevisionEvidence } from "./reasoning-revision";
import type { FreshnessRequest } from "./revision-freshness";
import type { KnowledgeNode } from "./knowledge-impact";
import type { RecheckPriority } from "./knowledge-recheck";
import type { UnifiedThoughtInput } from "./unified-thought";
import type { RankingOption } from "./experience-ranking";
import type { AutonomousLearning } from "./autonomous-learning";
import type { KnowledgeLedger } from "./knowledge-ledger";
import { checkPublicEvidence } from "./public-evidence";
import { comparePublicEvidence } from "./evidence-comparison";
import type { AssistantSettingsStore } from "./assistant-settings";
import type { Brief, Organizer } from "./organizer";
import type { EvalService } from "./evals";
import { buildQualityReport } from "./quality";
import { repeatedRequests } from "./suggestions";
/** Module supervision (restart, permissions, manifests). Optional: the app also runs without it. */
export interface ModuleControl {
  list(): unknown;
  isActive(name: string): boolean;
  title(name: string): string;
  detail(name: string): Promise<unknown>;
  act(name: string, action: string): Promise<unknown>;
  promptView(): unknown;
  tools(): unknown;
  setToolAllowed(tool: string, allowed: boolean): Promise<void>;
  setAssistantAccess(name: string, allowed: boolean): Promise<unknown>;
  track<T>(name: string, work: () => Promise<T>): Promise<T>;
  manifests: {
    list(): unknown;
    preview(input: unknown): unknown;
    install(input: unknown, sha256: unknown): Promise<unknown>;
    remove(name: string): Promise<void>;
    fetch(url: unknown): Promise<unknown>;
  };
}
export interface AppDeps {
  moduleControl?: ModuleControl;
  /** Owner preferences for the assistant (embeddings, memory proposals, summaries, files, web, quick commands). */
  settings?: AssistantSettingsStore;
  /** Notes, to-dos and reminders. */
  organizer?: Organizer;
  /** Control questions that show whether the assistant got better or worse. */
  evals?: EvalService;
  /** Data for the start-of-day summary. */
  brief?: () => Promise<Brief>;
  /** Long-term memory is available (and editable by the user) even before an API key is configured. */
  memory?: import("@juunibi/assistant").Memory;
  /** undefined while Cloud.ru is not configured; chat then answers 503 with instructions. */
  getAssistant?: () => Assistant | undefined;
  cloudStatus?: () => { configured: boolean; model: string };
  saveCloud?: (apiKey: string) => Promise<void>;
  assistant?: Assistant | undefined;
  approvals?: ApprovalGate;
  updater?: ProjectUpdater;
  scenes?: SceneEngine;
  brain?: BrainCore;
  automaticBrainReview?: (message: string) => ReturnType<typeof automaticBrainReview>;
  learning?: AutonomousLearning;
  knowledge?: KnowledgeLedger;
  modules: () => unknown;
  staticDir?: string;
  configured: { model?: string; hint?: string };
}

const MAX_BODY = 64 * 1024;
const MAX_CHAT_BODY = 700 * 1024; // chat requests may carry attached text files and long history
const MAX_CHAT_MESSAGE = 100_000;
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".map": "application/json",
  ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon",
};

/** Only loopback Host values are accepted: blocks DNS-rebinding against a local server. */
export function hostAllowed(host: string | undefined): boolean {
  if (!host) return false;
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);
}
/** State-changing requests must come from our own origin (CSRF guard). */
export function originAllowed(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true; // non-browser clients (curl) send none
  try { return new URL(origin).host === host; } catch { return false; }
}

function readJson(req: http.IncomingMessage, limit = MAX_BODY): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooBig = false;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (tooBig) return; // keep draining so the 413 reply can be delivered
      if (size > limit) { tooBig = true; chunks.length = 0; reject(Object.assign(new Error("Слишком большой запрос"), { status: 413 })); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (tooBig) return;
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString() || "{}");
        if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error();
        resolve(v);
      } catch { reject(Object.assign(new Error("Некорректный JSON"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

export function createApp(deps: AppDeps): http.Server {
  const send = (res: http.ServerResponse, status: number, body: unknown, type = "application/json") => {
    res.writeHead(status, {
      "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff", connection: "close",
      "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'",
    });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };

  return http.createServer(async (req, res) => {
    try {
      if (!hostAllowed(req.headers.host)) return send(res, 403, { error: "Недопустимый Host" });
      const url = new URL(req.url ?? "/", "http://localhost");
      const p = url.pathname;

      if (p.startsWith("/api/")) {
        if (req.method !== "GET" && !originAllowed(req.headers.origin, req.headers.host)) return send(res, 403, { error: "Чужой origin" });
        const a = deps.getAssistant?.() ?? deps.assistant;
        if (req.method === "GET" && p === "/api/status") return send(res, 200, { assistant: !!a, ...deps.configured });
        if (req.method === "GET" && p === "/api/cloudru") return send(res, 200, deps.cloudStatus?.() ?? { configured: !!a, model: deps.configured.model });
        if (req.method === "POST" && p === "/api/cloudru") {
          if (!deps.saveCloud) return send(res, 503, { error: "Настройки недоступны" });
          const b = await readJson(req);
          if (typeof b.apiKey !== "string") return send(res, 400, { error: "Введите API-ключ" });
          await deps.saveCloud(b.apiKey.trim());
          return send(res, 200, deps.cloudStatus?.() ?? { configured: true });
        }
        const mc = deps.moduleControl;
        // A stopped module refuses its own endpoints, so stopping it really stops it.
        if (mc) {
          const owner = p.startsWith("/api/juunibi/scenes") ? "scenes"
            : /^\/api\/(brain|learning|knowledge)(\/|$)/.test(p) ? "brain"
            : /^\/api\/update\/(check|download|confirm-removals)$/.test(p) ? "updater" : null;
          if (owner && !mc.isActive(owner)) return send(res, 503, { error: `Модуль «${mc.title(owner)}» остановлен. Запустите его на странице «Модули».` });
        }
        if (mc && p.startsWith("/api/modules/")) {
          const rest = p.slice("/api/modules/".length);
          if (req.method === "GET" && rest === "tools") return send(res, 200, mc.tools());
          if (req.method === "GET" && rest === "assistant-view") { const view = JSON.stringify(mc.promptView()); return send(res, 200, { json: view, chars: view.length }); }
          if (req.method === "GET" && rest === "manifests") return send(res, 200, mc.manifests.list());
          if (req.method === "POST" && rest === "manifests/preview") {
            const b = await readJson(req);
            return send(res, 200, mc.manifests.preview(b.url !== undefined ? await mc.manifests.fetch(b.url) : b.manifest));
          }
          if (req.method === "POST" && rest === "manifests/install") {
            const b = await readJson(req);
            return send(res, 201, await mc.manifests.install(b.manifest, b.sha256));
          }
          const mm = /^manifests\/([a-z][a-z0-9-]{1,40})$/.exec(rest);
          if (req.method === "DELETE" && mm) { await mc.manifests.remove(mm[1]!); return send(res, 200, { ok: true }); }
          if (req.method === "POST" && rest === "tools/policy") {
            const b = await readJson(req);
            if (typeof b.tool !== "string" || typeof b.allowed !== "boolean") return send(res, 400, { error: "Укажите tool и allowed" });
            await mc.setToolAllowed(b.tool, b.allowed);
            return send(res, 200, mc.tools());
          }
          const am = /^([a-z][a-z0-9-]{1,40})\/access$/.exec(rest);
          if (req.method === "POST" && am) {
            const b = await readJson(req);
            if (typeof b.allowed !== "boolean") return send(res, 400, { error: "Укажите allowed" });
            return send(res, 200, await mc.setAssistantAccess(am[1]!, b.allowed));
          }
          const dm = /^([a-z][a-z0-9-]{1,40})$/.exec(rest);
          if (req.method === "GET" && dm) return send(res, 200, await mc.detail(dm[1]!));
          const xm = /^([a-z][a-z0-9-]{1,40})\/(start|stop|restart|enable|disable)$/.exec(rest);
          if (req.method === "POST" && xm) return send(res, 200, await mc.act(xm[1]!, xm[2]!));
          return send(res, 404, { error: "Не найдено" });
        }
        if (req.method === "GET" && p === "/api/juunibi/scenes/stats") return send(res, 200, deps.scenes?.stats() ?? { error: "Сцены не подключены" });
        if (req.method === "POST" && p === "/api/juunibi/scenes/next") {
          if (!deps.scenes) return send(res, 503, {error:"Сцены не подключены"});
          return send(res, 200, mc ? await mc.track("scenes", () => deps.scenes!.next()) : await deps.scenes.next());
        }
        if (req.method === "GET" && p === "/api/modules") return send(res, 200, mc ? mc.list() : deps.modules());
        if (req.method === "GET" && p === "/api/memory/diagnostics") return send(res, 200, (deps.memory ?? a?.memory)?.embeddingDiagnostics() ?? { configured: false, mode: "unavailable" });
        if (req.method === "GET" && p === "/api/knowledge") return send(res, deps.knowledge ? 200 : 503, deps.knowledge?.list() ?? { error: "Память знаний недоступна" });
        if (req.method === "POST" && p === "/api/knowledge/evidence/compare") {
          const b = await readJson(req);
          return send(res, 200, await comparePublicEvidence(b.sources));
        }
        if (req.method === "GET" && p === "/api/knowledge/gaps")
          return send(res, deps.knowledge ? 200 : 503, deps.knowledge?.gaps() ?? { error: "Пробелы недоступны" });
        if (req.method === "GET" && p === "/api/knowledge/suggested-links") return send(res, deps.knowledge ? 200 : 503, deps.knowledge?.suggestedLinks() ?? { error: "Память знаний недоступна" });
        if (req.method === "GET" && p === "/api/knowledge/graph")
          return send(res, deps.knowledge ? 200 : 503, deps.knowledge?.graph() ?? { error: "Граф недоступен" });
        if (req.method === "POST" && p === "/api/knowledge/evidence") {
          const b = await readJson(req);
          const result = await checkPublicEvidence(b.source, b.section, b.quote);
          // Evidence stays separate from the trusted ledger: citation matching isn't factual validation.
          return send(res, 200, { ...result, promotesToMemory: false, requiresHumanReview: true });
        }
        if (req.method === "GET" && p === "/api/knowledge/due") return send(res, deps.knowledge ? 200 : 503, deps.knowledge?.due() ?? { error: "Память знаний недоступна" });
        // Owner-operated API, never callable by the autonomous learning engine.
        if (req.method === "POST" && p === "/api/knowledge/confirm") {
          if (!deps.knowledge) return send(res, 503, { error: "Память знаний недоступна" });
          const b = await readJson(req);
          if (typeof b.claim !== "string" || typeof b.topic !== "string" || typeof b.source !== "string") return send(res, 400, { error: "Укажите тему, утверждение и источник" });
          const item = deps.knowledge.addVerified({ claim: b.claim, topic: b.topic, source: b.source, evidence: "owner-confirmed" });
          await deps.knowledge.flush();
          return send(res, 201, item);
        }
        if (req.method === "POST" && p === "/api/knowledge/review") {
          if (!deps.knowledge) return send(res, 503, { error: "Память знаний недоступна" });
          const b = await readJson(req);
          if (typeof b.id !== "string" || typeof b.correct !== "boolean") return send(res, 400, { error: "Некорректный результат повторения" });
          const item = deps.knowledge.review(b.id, b.correct);
          await deps.knowledge.flush();
          return send(res, 200, item);
        }
        if (req.method === "GET" && p === "/api/learning") return send(res, deps.learning ? 200 : 503, deps.learning?.status() ?? { error: "Обучение недоступно" });
        if (req.method === "POST" && p === "/api/learning/settings") {
          if (!deps.learning) return send(res, 503, { error: "Обучение недоступно" });
          return send(res, 200, await deps.learning.configure(await readJson(req)));
        }
        if (req.method === "POST" && p === "/api/learning/step") {
          if (!deps.learning) return send(res, 503, { error: "Обучение недоступно" });
          return send(res, 200, mc ? await mc.track("brain", () => deps.learning!.tick()) : await deps.learning.tick());
        }
        if (req.method === "POST" && p === "/api/brain/rank-with-experience") {
          if (!deps.brain) return send(res, 503, { error: "Мозг недоступен" });
          const input = await readJson(req);
          return send(res, 200, deps.brain.rankDecisions(input.options as RankingOption[], input.enabled !== false));
        }
        if (req.method === "POST" && p === "/api/brain/review-task-plan") {
          if (!deps.brain) return send(res, 503, { error: "Мозг недоступен" });
          const input = await readJson(req);
          return send(res, 200, deps.brain.previewActivePlan(input.planId as string, input as unknown as Parameters<BrainCore["previewActivePlan"]>[1]));
        }
        if (req.method === "POST" && p === "/api/brain/review-tool-outcome") {
          if (!deps.brain) return send(res, 503, { error: "Мозг недоступен" });
          const input = await readJson(req);
          return send(res, 200, deps.brain.reviewToolOutcome(input as unknown as import("./tool-outcome-review").ToolOutcomeEvidence));
        }
        if (req.method === "POST" && p === "/api/brain/preview-thought-cycle") {
          if (!deps.brain) return send(res, 503, { error: "Мозг недоступен" });
          const input = await readJson(req);
          return send(res, 200, deps.brain.previewThoughtCycle(input as unknown as UnifiedThoughtInput));
        }
        if (req.method === "POST" && p === "/api/brain/preview-knowledge-recheck") {
          if (!deps.brain) return send(res, 503, { error: "Мозг недоступен" });
          const input = await readJson(req);
          return send(res, 200, deps.brain.previewKnowledgeRecheck(input.nodes as KnowledgeNode[], input.changedId as string, input.priorities as RecheckPriority[]));
        }
        if (req.method === "POST" && p === "/api/brain/preview-knowledge-impact") {
          if (!deps.brain) return send(res, 503, { error: "Мозг недоступен" });
          const input = await readJson(req);
          return send(res, 200, deps.brain.previewKnowledgeImpact(input.nodes as KnowledgeNode[], input.changedId as string));
        }
        if (req.method === "POST" && p === "/api/brain/review-revision-freshness") {
          if (!deps.brain) return send(res, 503, { error: "Мозг недоступен" });
          const input = await readJson(req);
          return send(res, 200, deps.brain.reviewRevisionFreshness(input as unknown as FreshnessRequest));
        }
        if (req.method === "GET" && p === "/api/brain/revision-history")
          return send(res, deps.brain ? 200 : 503, deps.brain?.revisionHistory() ?? { error: "Мозг недоступен" });
        if (req.method === "POST" && p === "/api/brain/revision-history") {
          if (!deps.brain) return send(res, 503, { error: "Мозг недоступен" });
          const input = await readJson(req);
          return send(res, 201, deps.brain.proposeRevision({claimId: input.claimId as string, previous: input.previous as boolean, proposed: input.proposed as boolean, reason: input.reason as string}));
        }
        if (req.method === "POST" && p === "/api/brain/resolve-revision") {
          if (!deps.brain) return send(res, 503, { error: "Мозг недоступен" });
          const input = await readJson(req);
          return send(res, 200, deps.brain.resolveRevision(input.id as string, input.outcome as "accepted" | "rejected"));
        }
        if (req.method === "POST" && p === "/api/brain/preview-reasoning-revision") {
          if (!deps.brain) return send(res, 503, { error: "Мозг недоступен" });
          const input = await readJson(req);
          return send(res, 200, deps.brain.previewReasoningRevision(input.examples as ReasoningExample[], input.claim as unknown as ReasoningRevision, input.evidence as RevisionEvidence[]));
        }
        if (req.method === "POST" && p === "/api/brain/review-reasoning") {
          if (!deps.brain) return send(res, 503, { error: "Мозг недоступен" });
          const input = await readJson(req);
          return send(res, 200, deps.brain.reviewOwnReasoning(input.claims as ReasoningClaim[], input.evidence as ReasoningEvidence[]));
        }
        if (req.method === "POST" && p === "/api/brain/review-repairs") {
          if (!deps.brain) return send(res, 503, { error: "Мозг недоступен" });
          const input = await readJson(req);
          return send(res, 200, deps.brain.reviewRepairs(input as unknown as LearningCase));
        }
        if (req.method === "GET" && p === "/api/brain/task-patterns")
          return send(res, deps.brain ? 200 : 503, deps.brain?.taskPatterns() ?? { error: "Мозг недоступен" });
        if (req.method === "GET" && p === "/api/brain/decision-history")
          return send(res, deps.brain ? 200 : 503, deps.brain?.decisionHistory() ?? { error: "Мозг недоступен" });
        if (req.method === "POST" && p === "/api/brain/decision-history") {
          if (!deps.brain) return send(res, 503, { error: "Мозг недоступен" });
          const input = await readJson(req);
          return send(res, 201, deps.brain.recordDecision({ goal: input.goal as string, chosen: input.chosen as string, reason: input.reason as string, predictedSuccess: input.predictedSuccess as boolean, ...(input.taskType === undefined ? {} : { taskType: input.taskType as string }) }));
        }
        if (req.method === "POST" && p === "/api/brain/decision-outcome") {
          if (!deps.brain) return send(res, 503, { error: "Мозг недоступен" });
          const input = await readJson(req);
          return send(res, 200, deps.brain.confirmDecision(input.id as string, input.outcome as "success" | "failure"));
        }
        if (req.method === "POST" && p === "/api/brain/preview-decision-tree") {
          if (!deps.brain) return send(res, 503, { error: "Мозг недоступен" });
          const input = await readJson(req);
          return send(res, 200, deps.brain.previewDecisionTree(input.branches as DecisionBranch[], input.limits as PlanLimits, input.event as DecisionEvent | undefined));
        }
        if (req.method === "POST" && p === "/api/brain/suggest-sequence-repairs") {
          if (!deps.brain) return send(res, 503, { error: "Мозг недоступен" });
          const input = await readJson(req);
          return send(res, 200, deps.brain.suggestRepairs(input.steps as SequenceStep[], input.limits as PlanLimits));
        }
        if (req.method === "POST" && p === "/api/brain/preview-sequence") {
          if (!deps.brain) return send(res, 503, { error: "Мозг недоступен" });
          const input = await readJson(req);
          return send(res, 200, deps.brain.previewSequence(input.steps as SequenceStep[], input.limits as PlanLimits));
        }
        if (req.method === "POST" && p === "/api/brain/compare-plans") {
          if (!deps.brain) return send(res, 503, { error: "Мозг недоступен" });
          const input = await readJson(req);
          return send(res, 200, deps.brain.compareAlternatives(input.options as PlanOption[], input.limits as PlanLimits));
        }
        if (req.method === "GET" && p === "/api/knowledge/memory-review") {
          if (!deps.knowledge) return send(res, 503, { error: "Память недоступна" });
          return send(res, 200, deps.knowledge.analyze((url.searchParams.get("query") ?? "").slice(0, 300)));
        }
        if (req.method === "GET" && p === "/api/brain") return send(res, deps.brain ? 200 : 503, deps.brain?.status() ?? { error: "Мозг недоступен" });
        if (req.method === "POST" && p === "/api/brain/mode") { if (!deps.brain) return send(res, 503, { error: "Мозг недоступен" }); const b = await readJson(req); return send(res, 200, deps.brain.setMode(b.mode)); }
        if (req.method === "POST" && p === "/api/brain/plan-compare-34") {
          if (!deps.brain) return send(res,503,{error:"Мозг недоступен"});
          const body=await readJson(req);
          return send(res,200,deps.brain.compare34StagePlans(body.plan as import("./plan-25-audit").DraftPlan,body.alternatives as import("./plan-25-audit").DraftPlan[]));
        }
        if (req.method === "POST" && p === "/api/brain/plan-repair") {
          if (!deps.brain) return send(res,503,{error:"Мозг недоступен"});
          const draft=await readJson(req);
          return send(res,200,deps.brain.repairDraftPlan(draft as unknown as import("./plan-25-audit").DraftPlan));
        }
        if (req.method === "POST" && p === "/api/brain/plan-audit-25") {
          if (!deps.brain) return send(res,503,{error:"Мозг недоступен"});
          const draft=await readJson(req);
          return send(res,200,deps.brain.audit25StagePlan(draft as unknown as import("./plan-25-audit").DraftPlan));
        }
        if (req.method === "POST" && p === "/api/brain/plans") { if (!deps.brain) return send(res, 503, { error: "Мозг недоступен" }); const b = await readJson(req); return send(res, 201, deps.brain.plan(b.goal, b.steps)); }
        if (req.method === "GET" && p === "/api/brain/experience-learning") return send(res, deps.brain ? 200 : 503, deps.brain?.experienceLearningReport() ?? { error: "Мозг недоступен" });
        if (req.method === "GET" && p === "/api/brain/recovery-strategies") {
          if (!deps.brain) return send(res,503,{error:"Мозг недоступен"});
          const tool=url.searchParams.get("tool") ?? "";
          return send(res,200,deps.brain.recoveryStrategyRanking(tool));
        }
        if (req.method === "GET" && p === "/api/brain/recovery-trials") return send(res, deps.brain ? 200 : 503, deps.brain?.recoveryTrialReport() ?? {error:"Мозг недоступен"});
        if (req.method === "POST" && p === "/api/brain/recovery-trials") {
          if (!deps.brain) return send(res,503,{error:"Мозг недоступен"});
          const input=await readJson(req);
          return send(res,201,deps.brain.startRecoveryTrial(input as {tool:string;strategy:string;ownerConfirmed:boolean}));
        }
        if (req.method === "GET" && p === "/api/brain/tool-recovery") return send(res, deps.brain ? 200 : 503, deps.brain?.toolRecoveryReport() ?? { error: "Мозг недоступен" });
        if (req.method === "GET" && p === "/api/brain/tool-failure-patterns") return send(res, deps.brain ? 200 : 503, deps.brain?.toolFailurePatterns() ?? { error: "Мозг недоступен" });
        if (req.method === "GET" && p === "/api/brain/tool-outcomes") return send(res, deps.brain ? 200 : 503, deps.brain?.toolOutcomeHistory() ?? { error: "Мозг недоступен" });
        if (req.method === "GET" && p === "/api/brain/history") return send(res, deps.brain ? 200 : 503, deps.brain?.history() ?? { error: "Мозг недоступен" });
        if (req.method === "POST" && p === "/api/brain/execute-sequence") {
          if (!deps.brain) return send(res, 503, { error: "Мозг недоступен" });
          const b = await readJson(req);
          if (typeof b.planId !== "string") return send(res, 400, { error: "Укажите план" });
          const mem = deps.memory ?? deps.getAssistant?.()?.memory;
          const result = await deps.brain.executeSequence(b.planId, b.actions,
            () => deps.modules(), async query => mem ? (await mem.search(query, 8)).map(x => x.text) : []);
          return send(res, 200, result);
        }
        if (req.method === "POST" && p === "/api/brain/execute-read") {
          if (!deps.brain) return send(res, 503, { error: "Мозг недоступен" });
          const b = await readJson(req);
          if (typeof b.planId !== "string" || typeof b.stepId !== "string") return send(res, 400, { error: "Некорректные идентификаторы" });
          const mem = deps.memory ?? deps.getAssistant?.()?.memory;
          return send(res, 200, await deps.brain.executeReadStep(b.planId, b.stepId, b.action,
            () => deps.modules(), async (query) => mem ? (await mem.search(query, 8)).map(item => item.text) : []));
        }
        if (req.method === "GET" && p === "/api/update/events") return send(res, 200, await deps.updater?.events() ?? []);
        if (req.method === "GET" && p === "/api/update/status") return send(res, 200, deps.updater?.status() ?? { error: "Модуль обновления недоступен" });
        if (req.method === "POST" && p === "/api/update/check") {
          if (!deps.updater) return send(res, 503, { error: "Модуль обновления недоступен" });
          return send(res, 200, mc ? await mc.track("updater", () => deps.updater!.check()) : await deps.updater.check());
        }
        if (req.method === "POST" && p === "/api/update/confirm-removals") {
          if (!deps.updater) return send(res, 503, { error: "Модуль обновления недоступен" });
          try { return send(res, 200, await deps.updater.confirmRemovals()); }
          catch (e) { return send(res, 409, { error: (e as Error).message }); }
        }
        if (req.method === "POST" && p === "/api/update/download") {
          if (!deps.updater) return send(res, 503, { error: "Модуль обновления недоступен" });
          // isBusy() and start() run in the same tick, so concurrent callers get a clean 409 instead of an unhandled rejection.
          if (deps.updater.isBusy()) return send(res, 409, { error: "Обновление уже выполняется" });
          deps.updater.start().catch(() => {});
          return send(res, 202, { ok: true });
        }
        if (deps.organizer && p.startsWith("/api/organizer")) {
          const o = deps.organizer;
          if (req.method === "GET" && p === "/api/organizer") return send(res, 200, { notes: o.listNotes(), reminders: o.listReminders() });
          if (req.method === "POST" && p === "/api/organizer/notes") { const b = await readJson(req); return send(res, 201, await o.addNote(b.kind ?? "note", b.text)); }
          if (req.method === "POST" && p === "/api/organizer/reminders") { const b = await readJson(req); return send(res, 201, await o.addReminder(b.text, b.at)); }
          const om = /^\/api\/organizer\/(notes|reminders)\/([\w-]+)(?:\/(done|dismiss))?$/.exec(p);
          if (om) {
            const [, kind, id, action] = om;
            if (req.method === "DELETE" && !action) { if (kind === "notes") await o.removeNote(id!); else await o.removeReminder(id!); return send(res, 200, { ok: true }); }
            if (req.method === "POST" && kind === "notes" && action === "done") { const b = await readJson(req); if (typeof b.done !== "boolean") return send(res, 400, { error: "Укажите done: true или false" }); return send(res, 200, await o.setDone(id!, b.done)); }
            if (req.method === "POST" && kind === "reminders" && action === "dismiss") return send(res, 200, await o.dismissReminder(id!));
          }
          return send(res, 404, { error: "Не найдено" });
        }
        if (deps.brief && req.method === "GET" && p === "/api/brief") return send(res, 200, await deps.brief());
        if (deps.settings && p === "/api/assistant/settings") {
          if (req.method === "GET") return send(res, 200, deps.settings.get());
          if (req.method === "POST") return send(res, 200, await deps.settings.update(await readJson(req)));
        }
        const mem = deps.memory ?? a?.memory;
        if (mem) {
        if (req.method === "POST" && p === "/api/assistant/embedding-test") return send(res, 200, await mem.probeEmbedding());
        if (req.method === "GET" && p === "/api/memory/export") return send(res, 200, await mem.exportData());
        if (req.method === "POST" && p === "/api/memory/import") return send(res, 200, await mem.importData(await readJson(req, 512 * 1024)));
        const mp = /^\/api\/memory\/([\w-]+)\/(pin|expiry)$/.exec(p);
        if (mp && req.method === "POST") {
          const b = await readJson(req);
          if (mp[2] === "pin") {
            if (typeof b.pinned !== "boolean") return send(res, 400, { error: "Укажите pinned: true или false" });
            return send(res, 200, { ok: await mem.setPinned(mp[1]!, b.pinned) });
          }
          const until = b.until === null ? null : typeof b.until === "number" ? b.until : undefined;
          if (until === undefined || (until !== null && (!Number.isFinite(until) || until <= Date.now()))) return send(res, 400, { error: "Срок должен быть датой в будущем или null" });
          return send(res, 200, { ok: await mem.setExpiry(mp[1]!, until) });
        }
        if (req.method === "POST" && p === "/api/memory") { // the user explicitly asks to remember something
          const b = await readJson(req);
          const text = typeof b.text === "string" ? b.text.trim() : "";
          if (!text || text.length > 2000) return send(res, 400, { error: "Текст пустой или слишком длинный" });
          const kind = b.kind === "preference" || b.kind === "lesson" ? b.kind : "fact";
          return send(res, 200, await mem.add(kind, text, "active"));
        }
        if (req.method === "GET" && p === "/api/memory") {
          const s = url.searchParams.get("status");
          return send(res, 200, await mem.list(s === "active" || s === "pending" ? s : undefined));
        }
        const m = /^\/api\/memory\/([\w-]+)(\/approve)?$/.exec(p);
        if (m && req.method === "POST" && m[2]) return send(res, 200, { ok: await mem.approve(m[1]!) });
        if (m && req.method === "DELETE" && !m[2]) return send(res, 200, { ok: await mem.forget(m[1]!) });
        }
        if (!a) return send(res, 503, { error: deps.configured.hint ?? "Помощник не настроен" });

        if (req.method === "GET" && p === "/api/approvals") return send(res, 200, deps.approvals?.list() ?? []);
        if (req.method === "GET" && p === "/api/approvals/history") return send(res, 200, deps.approvals?.history() ?? []);
        const approvalMatch = /^\/api\/approvals\/([\w-]+)\/(approve|reject)$/.exec(p);
        if (req.method === "POST" && approvalMatch) {
          if (!deps.approvals) return send(res, 404, { error: "Подтверждения недоступны" });
          return send(res, deps.approvals.decide(approvalMatch[1]!, approvalMatch[2] === "approve") ? 200 : 404, { ok: true });
        }
        const brainOn = deps.brain && (!mc || mc.isActive("brain")) ? deps.brain : undefined;
        if (req.method === "POST" && p === "/api/chat/stream") {
          const b = await readJson(req, MAX_CHAT_BODY);
          const msg = typeof b.message === "string" ? b.message.trim() : "";
          if (!msg || msg.length > MAX_CHAT_MESSAGE) return send(res, 400, { error: "Сообщение пустое или слишком длинное" });
          const session = typeof b.session === "string" ? b.session.slice(0, 64) : "default";
          const history = Array.isArray(b.history) ? (b.history as { role: "user" | "assistant"; content: string }[]) : undefined;
          const ctl = new AbortController();
          res.on("close", () => { if (!res.writableEnded) ctl.abort(); });
          res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "x-accel-buffering": "no" });
          const line = (o: unknown) => { if (!res.writableEnded && !res.destroyed) res.write(JSON.stringify(o) + "\n"); };
          try {
            const review = brainOn && deps.automaticBrainReview ? deps.automaticBrainReview(msg) : undefined;
            if (brainOn) line({ type: "brain_review", review: review?.cycle ?? brainOn.classifyTask(msg) });
            const r = await a.ask(msg, session, ctl.signal, { ...(history ? { history } : {}), onEvent: line, ...(brainOn ? { brainGuidance: review?.guidance ?? brainOn.classifyTask(msg) } : {}) });
            line({ type: "done", turnId: r.turnId, reply: r.reply, tools: r.tools, memory: r.memory });
          } catch (e) { line({ type: "error", message: ctl.signal.aborted ? "Остановлено" : (e as Error).message }); }
          return void res.end();
        }
        if (req.method === "POST" && p === "/api/chat") {
          const b = await readJson(req, MAX_CHAT_BODY);
          const msg = typeof b.message === "string" ? b.message.trim() : "";
          if (!msg || msg.length > MAX_CHAT_MESSAGE) return send(res, 400, { error: "Сообщение пустое или слишком длинное" });
          const session = typeof b.session === "string" ? b.session.slice(0, 64) : "default";
          const ctl = new AbortController();
          res.on("close", () => { if (!res.writableEnded) ctl.abort(); });
          const history = Array.isArray(b.history) ? (b.history as { role: "user" | "assistant"; content: string }[]) : undefined;
          const review = brainOn && deps.automaticBrainReview ? deps.automaticBrainReview(msg) : undefined;
          const reply = await a.ask(msg, session, ctl.signal, { ...(history ? { history } : {}), ...(brainOn ? { brainGuidance: review?.guidance ?? brainOn.classifyTask(msg) } : {}) });
          return send(res, 200, brainOn ? { ...reply, brainReview: review?.cycle ?? brainOn.classifyTask(msg) } : reply);
        }
        if (req.method === "POST" && p === "/api/feedback") {
          const b = await readJson(req);
          if ((b.rating !== 1 && b.rating !== -1) || typeof b.turnId !== "string") return send(res, 400, { error: "turnId и rating (1|-1)" });
          return send(res, 200, { ok: await a.feedback(b.turnId, b.rating) });
        }
        if (req.method === "POST" && p === "/api/reflect") {
          const b = await readJson(req);
          if (typeof b.turnId !== "string") return send(res, 400, { error: "turnId" });
          return send(res, 200, await a.reflect(b.turnId));
        }
        if (req.method === "GET" && p === "/api/dataset") return send(res, 200, await a.exportDataset({ redact: url.searchParams.get("raw") !== "1" }), "application/x-ndjson");
        if (req.method === "GET" && p === "/api/assistant/suggestions") return send(res, 200, repeatedRequests(a.turnsSnapshot(), deps.settings?.get().quickCommands ?? []));
        if (req.method === "GET" && p === "/api/assistant/quality") return send(res, 200, buildQualityReport(a.turnsSnapshot()));
        if (deps.evals && p === "/api/assistant/eval") {
          if (req.method === "GET") return send(res, 200, deps.evals.status());
          if (req.method === "POST") return deps.evals.start() ? send(res, 202, deps.evals.status()) : send(res, 409, { error: "Проверка уже идёт" });
        }
        return send(res, 404, { error: "Не найдено" });
      }

      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "Метод не поддерживается" });
      if (!deps.staticDir) return send(res, 404, { error: "Нет статики" });
      const root = path.resolve(deps.staticDir);
      let decoded: string;
      try { decoded = decodeURIComponent(p); } catch { return send(res, 400, { error: "Некорректный адрес" }); }
      if (decoded.includes("\0")) return send(res, 400, { error: "Некорректный адрес" });
      let file = path.resolve(root, "." + decoded);
      if (file !== root && !file.startsWith(root + path.sep)) return send(res, 403, { error: "Запрещено" });
      if (p.endsWith("/")) file = path.join(file, "index.html");
      let data: Buffer;
      try { data = await readFile(file); } catch { file = path.join(root, "index.html"); data = await readFile(file); }
      res.writeHead(200, {
        "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'", "referrer-policy": "no-referrer",
      });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch (e) {
      const status = (e as { status?: number }).status ?? 500;
      if (!res.headersSent) send(res, status, { error: status === 500 ? "Внутренняя ошибка: " + (e as Error).message : (e as Error).message });
      else res.end();
    }
  });
}
