import { attemptAsync, type Result } from "@juunibi/core";

export interface SceneReply { action: {id:string;text:string;category:string;emotion?:string;duration_seconds?:number;animation_cues?:{ears?:string;tails?:number;gaze?:string}}; phrase:null|{id:string;text:string;category:string};stats:{total:number;used:number;remaining:number;phrases:number;generated:number} }
export interface CloudStatus { configured: boolean; model: string }
export interface UpdateEvent {event_id:string;type:string;timestamp:string;operation_id:string;relative_path:string;status:string;change_type?:string;bytes_done?:number;bytes_total?:number;target_relative_path?:string;message?:string;files?:{path:string;change_type:string;size:number}[]}
export interface UpdateStatus { phase: "idle" | "downloading" | "testing" | "ready" | "error"; percent: number; downloadedFiles: number; totalFiles: number; downloadedBytes: number; totalBytes: number; message: string; error?: string; pendingRemovals?: string[]; removalsConfirmed?: boolean; localVersion: string; latest: null | { sha: string; version: string; description: string; date: string } }
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
  nextScene: () => attemptAsync(() => call<SceneReply>("/api/juunibi/scenes/next",post({}))),
  cloudStatus: () => attemptAsync(() => call<CloudStatus>("/api/cloudru")),
  cloudSave: (apiKey: string) => attemptAsync(() => call<CloudStatus>("/api/cloudru", post({ apiKey }))),
  updateEvents: () => attemptAsync(() => call<UpdateEvent[]>("/api/update/events")),
  updateStatus: () => attemptAsync(() => call<UpdateStatus>("/api/update/status")),
  updateCheck: () => attemptAsync(() => call<UpdateStatus>("/api/update/check", post({}))),
  updateConfirmRemovals: () => attemptAsync(() => call<UpdateStatus>("/api/update/confirm-removals", post({}))),
  updateDownload: () => attemptAsync(() => call<{ok:boolean}>("/api/update/download", post({}))),
  approvals: () => attemptAsync(() => call<ApprovalItem[]>("/api/approvals")),
  decideApproval: (id: string, approve: boolean) => attemptAsync(() => call<{ok:boolean}>(`/api/approvals/${encodeURIComponent(id)}/${approve ? "approve" : "reject"}`, post({}))),
  status: (): Promise<Result<Status>> => attemptAsync(() => call<Status>("/api/status")),
  modules: () => attemptAsync(() => call<{ name: string; deps: string[]; status: string }[]>("/api/modules")),
  chat: (message: string) => attemptAsync(() => call<ChatReply>("/api/chat", post({ message }))),
  feedback: (turnId: string, rating: 1 | -1) => attemptAsync(() => call("/api/feedback", post({ turnId, rating }))),
  reflect: (turnId: string) => attemptAsync(() => call<MemoryItem[]>("/api/reflect", post({ turnId }))),
  addMemory: (text: string, kind: "fact" | "preference" = "fact") => attemptAsync(() => call<MemoryItem>("/api/memory", post({ text, kind }))),
  memory: () => attemptAsync(() => call<MemoryItem[]>("/api/memory")),
  approve: (id: string) => attemptAsync(() => call(`/api/memory/${id}/approve`, post({}))),
  forget: (id: string) => attemptAsync(() => call(`/api/memory/${id}`, { method: "DELETE" })),
};
