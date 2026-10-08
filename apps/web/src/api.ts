import { attemptAsync, type Result } from "@juunibi/core";

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
  status: (): Promise<Result<Status>> => attemptAsync(() => call<Status>("/api/status")),
  modules: () => attemptAsync(() => call<{ name: string; deps: string[]; status: string }[]>("/api/modules")),
  chat: (message: string) => attemptAsync(() => call<ChatReply>("/api/chat", post({ message }))),
  feedback: (turnId: string, rating: 1 | -1) => attemptAsync(() => call("/api/feedback", post({ turnId, rating }))),
  reflect: (turnId: string) => attemptAsync(() => call<MemoryItem[]>("/api/reflect", post({ turnId }))),
  memory: () => attemptAsync(() => call<MemoryItem[]>("/api/memory")),
  approve: (id: string) => attemptAsync(() => call(`/api/memory/${id}/approve`, post({}))),
  forget: (id: string) => attemptAsync(() => call(`/api/memory/${id}`, { method: "DELETE" })),
};
