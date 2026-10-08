import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Assistant, ApprovalGate } from "@juunibi/assistant";

import type { ProjectUpdater } from "./updater";
import type { SceneEngine } from "./scenes";
export interface AppDeps {
  /** undefined while Cloud.ru is not configured; chat then answers 503 with instructions. */
  getAssistant?: () => Assistant | undefined;
  cloudStatus?: () => { configured: boolean; model: string };
  saveCloud?: (apiKey: string) => Promise<void>;
  assistant?: Assistant | undefined;
  approvals?: ApprovalGate;
  updater?: ProjectUpdater;
  scenes?: SceneEngine;
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
        if (req.method === "GET" && p === "/api/juunibi/scenes/stats") return send(res, 200, deps.scenes?.stats() ?? { error: "Сцены не подключены" });
        if (req.method === "POST" && p === "/api/juunibi/scenes/next") {
          if (!deps.scenes) return send(res, 503, {error:"Сцены не подключены"});
          return send(res, 200, await deps.scenes.next());
        }
        if (req.method === "GET" && p === "/api/modules") return send(res, 200, deps.modules());
        if (req.method === "GET" && p === "/api/update/events") return send(res, 200, await deps.updater?.events() ?? []);
        if (req.method === "GET" && p === "/api/update/status") return send(res, 200, deps.updater?.status() ?? { error: "Модуль обновления недоступен" });
        if (req.method === "POST" && p === "/api/update/check") {
          if (!deps.updater) return send(res, 503, { error: "Модуль обновления недоступен" });
          return send(res, 200, await deps.updater.check());
        }
        if (req.method === "POST" && p === "/api/update/confirm-removals") {
          if (!deps.updater) return send(res, 503, { error: "Модуль обновления недоступен" });
          try { return send(res, 200, await deps.updater.confirmRemovals()); }
          catch (e) { return send(res, 409, { error: (e as Error).message }); }
        }
        if (req.method === "POST" && p === "/api/update/download") {
          if (!deps.updater) return send(res, 503, { error: "Модуль обновления недоступен" });
          if (deps.updater.status().phase === "downloading" || deps.updater.status().phase === "testing") return send(res, 409, { error: "Обновление уже выполняется" });
          void deps.updater.start();
          return send(res, 202, { ok: true });
        }
        if (!a) return send(res, 503, { error: deps.configured.hint ?? "Помощник не настроен" });

        if (req.method === "GET" && p === "/api/approvals") return send(res, 200, deps.approvals?.list() ?? []);
        if (req.method === "GET" && p === "/api/approvals/history") return send(res, 200, deps.approvals?.history() ?? []);
        const approvalMatch = /^\/api\/approvals\/([\w-]+)\/(approve|reject)$/.exec(p);
        if (req.method === "POST" && approvalMatch) {
          if (!deps.approvals) return send(res, 404, { error: "Подтверждения недоступны" });
          return send(res, deps.approvals.decide(approvalMatch[1]!, approvalMatch[2] === "approve") ? 200 : 404, { ok: true });
        }
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
            const r = await a.ask(msg, session, ctl.signal, { ...(history ? { history } : {}), onEvent: line });
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
          return send(res, 200, await a.ask(msg, session, ctl.signal, history ? { history } : {}));
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
        if (req.method === "POST" && p === "/api/memory") { // the user explicitly asks to remember something
          const b = await readJson(req);
          const text = typeof b.text === "string" ? b.text.trim() : "";
          if (!text || text.length > 2000) return send(res, 400, { error: "Текст пустой или слишком длинный" });
          const kind = b.kind === "preference" || b.kind === "lesson" ? b.kind : "fact";
          return send(res, 200, await a.memory.add(kind, text, "active"));
        }
        if (req.method === "GET" && p === "/api/memory") {
          const s = url.searchParams.get("status");
          return send(res, 200, await a.memory.list(s === "active" || s === "pending" ? s : undefined));
        }
        const m = /^\/api\/memory\/([\w-]+)(\/approve)?$/.exec(p);
        if (m && req.method === "POST" && m[2]) return send(res, 200, { ok: await a.memory.approve(m[1]!) });
        if (m && req.method === "DELETE" && !m[2]) return send(res, 200, { ok: await a.memory.forget(m[1]!) });
        if (req.method === "GET" && p === "/api/dataset") return send(res, 200, await a.exportDataset(), "application/x-ndjson");
        return send(res, 404, { error: "Не найдено" });
      }

      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "Метод не поддерживается" });
      if (!deps.staticDir) return send(res, 404, { error: "Нет статики" });
      const root = path.resolve(deps.staticDir);
      let file = path.resolve(root, "." + decodeURIComponent(p));
      if (file !== root && !file.startsWith(root + path.sep)) return send(res, 403, { error: "Запрещено" });
      if (p.endsWith("/")) file = path.join(file, "index.html");
      let data: Buffer;
      try { data = await readFile(file); } catch { file = path.join(root, "index.html"); data = await readFile(file); }
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "x-content-type-options": "nosniff" });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch (e) {
      const status = (e as { status?: number }).status ?? 500;
      if (!res.headersSent) send(res, status, { error: status === 500 ? "Внутренняя ошибка: " + (e as Error).message : (e as Error).message });
      else res.end();
    }
  });
}
