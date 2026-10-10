import { attemptAsync, type Result } from "@juunibi/core";

export interface SceneReply { action: {id:string;text:string;category:string;emotion?:string;duration_seconds?:number;animation_cues?:{ears?:string;tails?:number;gaze?:string}}; phrase:null|{id:string;text:string;category:string};stats:{total:number;used:number;remaining:number;phrases:number;generated:number} }
export interface CloudStatus { configured: boolean; model: string }
export interface BrainPlan { id:string; goal:string; createdAt:string; status:"planned"|"running"|"completed"|"failed"; steps:{id:string;title:string;status:"pending"|"active"|"done"|"failed"}[] }
export interface BrainStatus { mode:"chat"|"analysis"|"agent"|"creative"; assistantReady:boolean; capabilities:string[]; plans:BrainPlan[] }
export interface UpdateEvent {event_id:string;type:string;timestamp:string;operation_id:string;relative_path:string;status:string;change_type?:string;bytes_done?:number;bytes_total?:number;target_relative_path?:string;message?:string;files?:{path:string;change_type:string;size:number}[]}
export type UpdateCi = "success" | "pending" | "failure" | "none" | "unknown";
export interface UpdateChangeNote { sha: string; title: string; pr?: number }
export interface UpdateCheckStep { id: "install" | "typecheck" | "test" | "build"; title: string; status: "todo" | "active" | "done" | "error" }
export interface UpdateConfig { channel: "fresh" | "stable"; autoCheck: "off" | "hourly" | "daily" }
export interface UpdateStatus {
  phase: "idle" | "downloading" | "testing" | "ready" | "error"; percent: number; downloadedFiles: number; totalFiles: number; downloadedBytes: number; totalBytes: number; message: string; error?: string; pendingRemovals?: string[]; removalsConfirmed?: boolean; localVersion: string;
  latest: null | { sha: string; version: string; description: string; date: string; channel?: "fresh" | "stable"; tag?: string; ci?: UpdateCi; changes?: UpdateChangeNote[]; changesTotal?: number };
  reusedFiles?: number; treeBytes?: number; checks?: UpdateCheckStep[]; logTail?: string;
  config?: UpdateConfig; rollbackPending?: boolean;
  /** Why the newest version cannot be installed yet (CI not green); null/absent = it can. */
  blocked?: string | null;
  /** Work that a restart would interrupt. */
  activity?: string[];
}
export interface UpdateHistoryItem { id: string; at: string; kind: "install" | "rollback" | "failed" | "startup_failed"; from: string; to: string; backup?: string; rollbackOf?: string; message?: string; files?: number }
export interface UpdateHistory { items: UpdateHistoryItem[]; canRollback: UpdateHistoryItem | null; rollbackPending: boolean }
export interface ApprovalItem { id: string; tool: string; risk: "read" | "write" | "danger"; args: Record<string, unknown>; expiresAt: number }
export interface ChatReply { turnId: string; reply: string; tools: string[]; memory: string[] }
export interface MemoryItem { id: string; kind: string; text: string; status: "active" | "pending"; score: number; createdAt?: number; expiresAt?: number; pinned?: boolean }
export interface QuickCommand { name: string; text: string }
export interface AssistantSettings {
  embeddings: { enabled: boolean; model: string };
  chat: { model: string; fallbackModel: string; reasoning: boolean };
  suggestions: "off" | "rules" | "smart";
  summaries: boolean;
  files: { root: string; allowWrite: boolean };
  web: boolean;
  /** The Brave key itself never comes back from the server, only whether one is saved. */
  webSearch: { provider: SearchProvider; braveKeySet: boolean };
  instructions: { about: string; style: string };
  quickCommands: QuickCommand[];
}
export type SearchProvider = "duckduckgo" | "brave";
export type Repeat = "daily" | "weekdays" | "weekly";
export interface Note { id: string; kind: "note" | "todo"; text: string; done: boolean; createdAt: string }
export interface Reminder { id: string; text: string; at: string; createdAt: string; status: "scheduled" | "due" | "done"; firedAt?: string; repeat?: Repeat; seriesId?: string }
export interface Brief {
  now: string; due: { id: string; text: string; at: string }[]; today: { id: string; text: string; at: string }[];
  openTodos: { count: number; first: { id: string; text: string }[] }; plansRunning: number; memoryPending: number; modulesFailed: string[]; updateAvailable: boolean; attention: number;
}
export interface QualityReport {
  totals: { turns: number; rated: number; up: number; down: number; unrated: number; satisfaction: number | null };
  byDay: { day: string; up: number; down: number }[];
  byTool: { tool: string; uses: number; up: number; down: number; satisfaction: number | null }[];
  worst: { id: string; at: string; user: string; reply: string; tools: string[] }[];
  troubleWords: { word: string; down: number; up: number }[];
  datasetReady: number;
}
export interface EvalResult { id: string; title: string; passed: boolean; ms: number; answer: string; tools: string[]; error?: string }
export interface EvalRun { id: string; at: string; model: string; fingerprint: string; passed: number; total: number; results: EvalResult[] }
export interface EvalStatus {
  running: boolean; progress: { done: number; total: number } | null; error: string | null; last: EvalRun | null; previous: EvalRun | null;
  compare: { improved: string[]; regressed: string[]; delta: number | null; sameSetup: boolean } | null;
  history: { id: string; at: string; model: string; passed: number; total: number }[]; cases: { id: string; title: string }[];
}
export interface RepeatSuggestion { text: string; count: number; name: string }
export interface EmbeddingDiagnostics { configured: boolean; checks: number; failures: number; paused: boolean; mode: string }
export interface ModuleInfo {
  name: string; deps: string[]; status: string; title?: string; note?: string;
  kind?: "builtin" | "manifest"; error?: string; enabled?: boolean; running?: boolean; core?: boolean;
  dependents?: string[]; assistantBlocked?: boolean; uptimeSec?: number; errors24h?: number; lastMs?: number | null;
}
export interface ModuleToolInfo { name: string; risk: "read" | "write" | "danger"; description: string; module: string; allowed: boolean; calls24h: number; errors24h: number; denied24h: number }
export interface ModuleDetail extends ModuleInfo {
  description: string; version?: string; permissions?: string[];
  files: { path: string; size: number | null }[]; tools: ModuleToolInfo[];
  health: null | { uptimeSec: number; errors24h: number; calls: number; lastError: string | null; lastOkAt: string | null; lastMs: number | null; avgMs: number | null };
  log: { at: string; level: "info" | "error"; text: string }[];
}
export interface ManifestPreview {
  manifest: { name: string; title: string; description: string; version: string; deps: string[]; permissions: string[]; source?: string };
  sha256: string; permissions: { id: string; label: string; risk: "low" | "medium" | "high" }[]; warnings: string[]; executable: false; note: string;
}
export type ModuleAction = "start" | "stop" | "restart" | "enable" | "disable";
/** What the server accepts: any subset, also inside the groups (it keeps what is not sent). */
export type SettingsPatch = { [K in Exclude<keyof AssistantSettings, "webSearch">]?: AssistantSettings[K] extends unknown[] ? AssistantSettings[K] : AssistantSettings[K] extends object ? Partial<AssistantSettings[K]> : AssistantSettings[K] }
  & { webSearch?: { provider?: SearchProvider; braveKey?: string } };
export interface Status { assistant: boolean; model?: string; hint?: string }

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { "content-type": "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error((body as { error?: string }).error ?? `Ошибка ${res.status}`), { body });
  return body as T;
}
const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export const api = {
  brainStatus: () => attemptAsync(() => call<BrainStatus>("/api/brain")),
  brainMode: (mode: BrainStatus["mode"]) => attemptAsync(() => call<BrainStatus>("/api/brain/mode", post({ mode }))),
  brainPlan: (goal:string, steps:string[]) => attemptAsync(() => call<BrainPlan>("/api/brain/plans", post({ goal, steps }))),
  nextScene: () => attemptAsync(() => call<SceneReply>("/api/juunibi/scenes/next",post({}))),
  cloudStatus: () => attemptAsync(() => call<CloudStatus>("/api/cloudru")),
  cloudSave: (apiKey: string) => attemptAsync(() => call<CloudStatus>("/api/cloudru", post({ apiKey }))),
  cloudModels: () => attemptAsync(() => call<{ models: string[] }>("/api/cloudru/models")),
  updateEvents: () => attemptAsync(() => call<UpdateEvent[]>("/api/update/events")),
  updateStatus: () => attemptAsync(() => call<UpdateStatus>("/api/update/status")),
  updateCheck: () => attemptAsync(() => call<UpdateStatus>("/api/update/check", post({}))),
  updateConfirmRemovals: () => attemptAsync(() => call<UpdateStatus>("/api/update/confirm-removals", post({}))),
  updateDownload: () => attemptAsync(() => call<{ok:boolean}>("/api/update/download", post({}))),
  updateCancel: () => attemptAsync(() => call<UpdateStatus>("/api/update/cancel", post({}))),
  updateSettings: (patch: Partial<UpdateConfig>) => attemptAsync(() => call<UpdateStatus>("/api/update/settings", post(patch))),
  updateHistory: () => attemptAsync(() => call<UpdateHistory>("/api/update/history")),
  updateRollback: (cancel = false) => attemptAsync(() => call<UpdateStatus>("/api/update/rollback", post({ cancel }))),
  updateInstallNow: (force = false) => attemptAsync(() => call<{ restarting: boolean }>("/api/update/install-now", post({ force }))),
  approvals: () => attemptAsync(() => call<ApprovalItem[]>("/api/approvals")),
  decideApproval: (id: string, approve: boolean) => attemptAsync(() => call<{ok:boolean}>(`/api/approvals/${encodeURIComponent(id)}/${approve ? "approve" : "reject"}`, post({}))),
  status: (): Promise<Result<Status>> => attemptAsync(() => call<Status>("/api/status")),
  modules: () => attemptAsync(() => call<ModuleInfo[]>("/api/modules")),
  moduleDetail: (name: string) => attemptAsync(() => call<ModuleDetail>(`/api/modules/${encodeURIComponent(name)}`)),
  moduleAct: (name: string, action: ModuleAction) => attemptAsync(() => call<ModuleInfo>(`/api/modules/${encodeURIComponent(name)}/${action}`, post({}))),
  moduleTools: () => attemptAsync(() => call<ModuleToolInfo[]>("/api/modules/tools")),
  moduleToolAllowed: (tool: string, allowed: boolean) => attemptAsync(() => call<ModuleToolInfo[]>("/api/modules/tools/policy", post({ tool, allowed }))),
  moduleAccess: (name: string, allowed: boolean) => attemptAsync(() => call<ModuleInfo>(`/api/modules/${encodeURIComponent(name)}/access`, post({ allowed }))),
  assistantView: () => attemptAsync(() => call<{ json: string; chars: number }>("/api/modules/assistant-view")),
  manifestPreview: (src: { manifest: unknown } | { url: string }) => attemptAsync(() => call<ManifestPreview>("/api/modules/manifests/preview", post(src))),
  manifestInstall: (manifest: unknown, sha256: string) => attemptAsync(() => call<ManifestPreview>("/api/modules/manifests/install", post({ manifest, sha256 }))),
  manifestRemove: (name: string) => attemptAsync(() => call<{ ok: boolean }>(`/api/modules/manifests/${encodeURIComponent(name)}`, { method: "DELETE" })),
  chat: (message: string) => attemptAsync(() => call<ChatReply>("/api/chat", post({ message }))),
  feedback: (turnId: string, rating: 1 | -1) => attemptAsync(() => call("/api/feedback", post({ turnId, rating }))),
  reflect: (turnId: string) => attemptAsync(() => call<MemoryItem[]>("/api/reflect", post({ turnId }))),
  assistantSettings: () => attemptAsync(() => call<AssistantSettings>("/api/assistant/settings")),
  saveAssistantSettings: (patch: SettingsPatch) => attemptAsync(() => call<AssistantSettings>("/api/assistant/settings", post(patch))),
  embeddingTest: () => attemptAsync(() => call<{ ok: boolean; dims?: number; ms: number; error?: string }>("/api/assistant/embedding-test", post({}))),
  embeddingDiagnostics: () => attemptAsync(() => call<EmbeddingDiagnostics>("/api/memory/diagnostics")),
  memoryPin: (id: string, pinned: boolean) => attemptAsync(() => call<{ ok: boolean }>(`/api/memory/${encodeURIComponent(id)}/pin`, post({ pinned }))),
  memoryExpiry: (id: string, until: number | null) => attemptAsync(() => call<{ ok: boolean }>(`/api/memory/${encodeURIComponent(id)}/expiry`, post({ until }))),
  memoryExport: () => attemptAsync(() => call<unknown>("/api/memory/export")),
  memoryImport: (data: unknown) => attemptAsync(() => call<{ added: number; duplicates: number; skipped: number }>("/api/memory/import", post(data))),
  organizer: () => attemptAsync(() => call<{ notes: Note[]; reminders: Reminder[] }>("/api/organizer")),
  addNote: (kind: "note" | "todo", text: string) => attemptAsync(() => call<Note>("/api/organizer/notes", post({ kind, text }))),
  setTodoDone: (id: string, done: boolean) => attemptAsync(() => call<Note>(`/api/organizer/notes/${encodeURIComponent(id)}/done`, post({ done }))),
  removeNote: (id: string) => attemptAsync(() => call<{ ok: boolean }>(`/api/organizer/notes/${encodeURIComponent(id)}`, { method: "DELETE" })),
  addReminder: (text: string, at: string, repeat?: Repeat) => attemptAsync(() => call<Reminder>("/api/organizer/reminders", post({ text, at, ...(repeat ? { repeat } : {}) }))),
  editNote: (id: string, text: string) => attemptAsync(() => call<Note>(`/api/organizer/notes/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ text }) })),
  editReminder: (id: string, patch: { text?: string; at?: string; repeat?: Repeat | "none" }) => attemptAsync(() => call<Reminder>(`/api/organizer/reminders/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) })),
  dismissReminder: (id: string) => attemptAsync(() => call<Reminder>(`/api/organizer/reminders/${encodeURIComponent(id)}/dismiss`, post({}))),
  removeReminder: (id: string) => attemptAsync(() => call<{ ok: boolean }>(`/api/organizer/reminders/${encodeURIComponent(id)}`, { method: "DELETE" })),
  brief: () => attemptAsync(() => call<Brief>("/api/brief")),
  quality: () => attemptAsync(() => call<QualityReport>("/api/assistant/quality")),
  evalStatus: () => attemptAsync(() => call<EvalStatus>("/api/assistant/eval")),
  evalStart: () => attemptAsync(() => call<EvalStatus>("/api/assistant/eval", post({}))),
  suggestions: () => attemptAsync(() => call<RepeatSuggestion[]>("/api/assistant/suggestions")),
  addMemory: (text: string, kind: "fact" | "preference" = "fact") => attemptAsync(() => call<MemoryItem>("/api/memory", post({ text, kind }))),
  memory: () => attemptAsync(() => call<MemoryItem[]>("/api/memory")),
  approve: (id: string) => attemptAsync(() => call(`/api/memory/${id}/approve`, post({}))),
  forget: (id: string) => attemptAsync(() => call(`/api/memory/${id}`, { method: "DELETE" })),
};
