import { attemptAsync, type Result } from "@juunibi/core";

export interface UpdateStatus { phase: "idle" | "downloading" | "testing" | "ready" | "error"; percent: number; downloadedFiles: number; totalFiles: number; downloadedBytes: number; totalBytes: number; message: string; error?: string; localVersion: string; latest: null | { sha: string; version: string; description: string; date: string } }
export interface ApprovalItem { id: string; tool: string; risk: "read" | "write" | "danger"; args: Record<string, unknown>; expiresAt: number }
export interface ChatReply { turnId: string; reply: string; tools: string[]; memory: string[] }
export interface MemoryItem { id: string; kind: string; text: string; status: "active" | "pending"; score: number }
export interface Status { assistant: boolean; model?: string; hint?: string }

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Ошибка ${res.status}`);
  return body as T;
}
const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export const api = {
  updateStatus: () => attemptAsync(() => call<UpdateStatus>("/api/update/status")),
  updateCheck: () => attemptAsync(() => call<UpdateStatus>("/api/update/check", post({}))),
  updateDownload: () => attemptAsync(() => call<{ok:boolean}>("/api/update/download", post({}))),
  approvals: () => attemptAsync(() => call<ApprovalItem[]>("/api/approvals")),
  decideApproval: (id: string, approve: boolean) => attemptAsync(() => call<{ok:boolean}>(`/api/approvals/${encodeURIComponent(id)}/${approve ? "approve" : "reject"}`, post({}))),
  status: (): Promise<Result<Status>> => attemptAsync(() => call<Status>("/api/status")),
  modules: () => attemptAsync(() => call<{ name: string; deps: string[]; status: string }[]>("/api/modules")),
  chat: (message: string) => attemptAsync(() => call<ChatReply>("/api/chat", post({ message }))),
  feedback: (turnId: string, rating: 1 | -1) => attemptAsync(() => call("/api/feedback", post({ turnId, rating }))),
  reflect: (turnId: string) => attemptAsync(() => call<MemoryItem[]>("/api/reflect", post({ turnId }))),
  memory: () => attemptAsync(() => call<MemoryItem[]>("/api/memory")),
  approve: (id: string) => attemptAsync(() => call(`/api/memory/${id}/approve`, post({}))),
  forget: (id: string) => attemptAsync(() => call(`/api/memory/${id}`, { method: "DELETE" })),
};
