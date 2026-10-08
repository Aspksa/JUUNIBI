import { Store, attempt } from "@juunibi/core";
import { ACCENT_IDS, type AccentId } from "./accents";
import { api, type ApprovalItem, type MemoryItem, type Status, type UpdateEvent, type UpdateStatus } from "./api";

export type Route = "home" | "memory" | "modules" | "update" | "settings";
export const ROUTES: Route[] = ["home", "memory", "modules", "update", "settings"];
export type Theme = "auto" | "light" | "dark";

export interface AppState {
  route: Route; navOpen: boolean;
  status: Status | null; memory: MemoryItem[]; modules: { name: string; deps: string[]; status: string }[];
  approvals: ApprovalItem[];
  update: UpdateStatus | null; updateEvents: UpdateEvent[]; updateError: string;
  theme: Theme; showScenes: boolean;
  chatOpen: boolean; chatMax: boolean; chatDensity: "comfortable" | "compact"; chatFont: "sm" | "md" | "lg"; accent: AccentId;
}

const KEY = "juunibi:ui:v3";
const read = attempt(() => JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<AppState>);
const saved: Partial<AppState> = read.ok && read.value && typeof read.value === "object" ? read.value : {};
const pick = <T extends string>(v: unknown, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d);

export const app = new Store<AppState>({
  route: routeFromHash(), navOpen: false,
  status: null, memory: [], modules: [], approvals: [],
  update: null, updateEvents: [], updateError: "",
  theme: pick(saved.theme, ["auto", "light", "dark"], "auto"), showScenes: saved.showScenes !== false,
  chatOpen: false, chatMax: saved.chatMax === true,
  chatDensity: pick(saved.chatDensity, ["comfortable", "compact"], "comfortable"), chatFont: pick(saved.chatFont, ["sm", "md", "lg"], "md"), accent: pick(saved.accent, ACCENT_IDS, "gold"),
});

export function routeFromHash(): Route {
  const h = location.hash.replace(/^#\/?/, "");
  return (ROUTES as string[]).includes(h) ? (h as Route) : "home";
}
export function persistPrefs(s: AppState) {
  attempt(() => localStorage.setItem(KEY, JSON.stringify({ theme: s.theme, showScenes: s.showScenes, chatMax: s.chatMax, chatDensity: s.chatDensity, chatFont: s.chatFont, accent: s.accent })));
}

export async function refreshStatus() {
  const r = await api.status();
  app.set({ status: r.ok ? r.value : { assistant: false, hint: "Сервер недоступен. Запустите через JUUNIBI.bat." } });
}
export async function refreshMemory() { const r = await api.memory(); if (r.ok) app.set({ memory: r.value }); }
export async function refreshModules() { const r = await api.modules(); if (r.ok) app.set({ modules: r.value }); }
export async function refreshApprovals() {
  const r = await api.approvals();
  if (r.ok && JSON.stringify(r.value) !== JSON.stringify(app.get().approvals)) app.set({ approvals: r.value });
}
export async function decideApproval(id: string, approve: boolean) { await api.decideApproval(id, approve); await refreshApprovals(); }
export async function refreshUpdate() {
  const r = await api.updateStatus();
  if (r.ok && JSON.stringify(r.value) !== JSON.stringify(app.get().update)) app.set({ update: r.value });
}
export async function refreshEvents() {
  const r = await api.updateEvents();
  if (r.ok && r.value.map((e) => e.event_id).join(",") !== app.get().updateEvents.map((e) => e.event_id).join(",")) app.set({ updateEvents: r.value });
}
export async function checkUpdate() {
  const r = await api.updateCheck();
  if (r.ok) app.set({ update: r.value, updateError: "" }); else app.set({ updateError: r.error.message });
}
export async function downloadUpdate() {
  const r = await api.updateDownload();
  if (!r.ok) app.set({ updateError: r.error.message }); else void refreshUpdate();
}
