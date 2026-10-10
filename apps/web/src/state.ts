import { Store, attempt } from "@juunibi/core";
import { ACCENT_IDS, type AccentId } from "./accents";
import { api, type AssistantSettings, type Brief, type RepeatSuggestion, type ModuleInfo, type ApprovalItem, type MemoryItem, type Status, type UpdateEvent, type UpdateHistory, type UpdateStatus } from "./api";

export type Route = "home" | "tasks" | "memory" | "quality" | "modules" | "brain" | "update" | "settings";
export const ROUTES: Route[] = ["home", "tasks", "memory", "quality", "modules", "brain", "update", "settings"];
/** Older addresses that now open another page. */
const ROUTE_ALIASES: Record<string, Route> = { notes: "tasks", reminders: "tasks" };
/** Addresses that open a tile of the Brain page in its window. */
export const BRAIN_TILE_ROUTES: Partial<Record<Route, "memory" | "quality">> = { memory: "memory", quality: "quality" };
export type Theme = "auto" | "light" | "dark";

export interface AppState {
  route: Route; navOpen: boolean;
  status: Status | null; memory: MemoryItem[]; modules: ModuleInfo[];
  assistantSettings: AssistantSettings | null; brief: Brief | null; repeatSuggestions: RepeatSuggestion[];
  approvals: ApprovalItem[];
  update: UpdateStatus | null; updateEvents: UpdateEvent[]; updateError: string;
  updateHistory: UpdateHistory | null;
  /** "": normal; otherwise the server is being restarted by the launcher to install an update or a rollback. */
  updateRestarting: "" | "install" | "rollback";
  /** Work that a restart would interrupt, shown for confirmation before "install now". */
  updateWarnings: string[];
  theme: Theme; showScenes: boolean;
  chatOpen: boolean; chatMax: boolean; chatDensity: "comfortable" | "compact"; chatFont: "sm" | "md" | "lg"; accent: AccentId;
}

const KEY = "juunibi:ui:v3";
const read = attempt(() => JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<AppState>);
const saved: Partial<AppState> = read.ok && read.value && typeof read.value === "object" ? read.value : {};
const pick = <T extends string>(v: unknown, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d);

export const app = new Store<AppState>({
  route: routeFromHash(), navOpen: false,
  status: null, memory: [], modules: [], approvals: [], assistantSettings: null, brief: null, repeatSuggestions: [],
  update: null, updateEvents: [], updateError: "", updateHistory: null, updateRestarting: "", updateWarnings: [],
  theme: pick(saved.theme, ["auto", "light", "dark"], "auto"), showScenes: saved.showScenes !== false,
  chatOpen: false, chatMax: saved.chatMax === true,
  chatDensity: pick(saved.chatDensity, ["comfortable", "compact"], "comfortable"), chatFont: pick(saved.chatFont, ["sm", "md", "lg"], "md"), accent: pick(saved.accent, ACCENT_IDS, "gold"),
});

export function routeFromHash(): Route {
  const h = location.hash.replace(/^#\/?/, "");
  return (ROUTES as string[]).includes(h) ? (h as Route) : ROUTE_ALIASES[h] ?? "home";
}
export function persistPrefs(s: AppState) {
  attempt(() => localStorage.setItem(KEY, JSON.stringify({ theme: s.theme, showScenes: s.showScenes, chatMax: s.chatMax, chatDensity: s.chatDensity, chatFont: s.chatFont, accent: s.accent })));
}

export async function refreshStatus() {
  const r = await api.status();
  app.set({ status: r.ok ? r.value : { assistant: false, hint: "Сервер недоступен. Запустите через JUUNIBI.bat." } });
}
export async function refreshMemory() { const r = await api.memory(); if (r.ok) app.set({ memory: r.value }); }
export async function refreshSettings() { const r = await api.assistantSettings(); if (r.ok) app.set({ assistantSettings: r.value }); }
const DISMISSED_KEY = "juunibi:dismissedSuggestions";
export const dismissedSuggestions = (): string[] => { const r = attempt(() => JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]") as string[]); return r.ok && Array.isArray(r.value) ? r.value : []; };
export function dismissSuggestion(name: string) {
  attempt(() => localStorage.setItem(DISMISSED_KEY, JSON.stringify([...new Set([...dismissedSuggestions(), name])].slice(-50))));
  app.set({ repeatSuggestions: app.get().repeatSuggestions.filter((x) => x.name !== name) });
}
export async function refreshSuggestions() {
  const r = await api.suggestions();
  if (!r.ok) return;
  const hidden = new Set(dismissedSuggestions());
  const fresh = r.value.filter((x) => !hidden.has(x.name));
  if (JSON.stringify(fresh) !== JSON.stringify(app.get().repeatSuggestions)) app.set({ repeatSuggestions: fresh });
}
export async function refreshBrief() {
  const r = await api.brief();
  if (r.ok && JSON.stringify(r.value) !== JSON.stringify(app.get().brief)) app.set({ brief: r.value });
}
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
export async function refreshHistory() {
  const r = await api.updateHistory();
  if (r.ok && JSON.stringify(r.value) !== JSON.stringify(app.get().updateHistory)) app.set({ updateHistory: r.value });
}
export async function cancelUpdate() {
  const r = await api.updateCancel();
  if (r.ok) app.set({ update: r.value, updateError: "" }); else app.set({ updateError: r.error.message });
}
export async function saveUpdateConfig(patch: Partial<NonNullable<UpdateStatus["config"]>>) {
  const r = await api.updateSettings(patch);
  if (r.ok) app.set({ update: r.value, updateError: "" }); else app.set({ updateError: r.error.message });
  if (r.ok && patch.channel) void checkUpdate(); // the other channel may have a different newest version
}
/** Plans or cancels a rollback to the previous version; it is carried out when JUUNIBI starts the next time. */
export async function requestRollback(cancel = false) {
  const r = await api.updateRollback(cancel);
  if (r.ok) app.set({ update: r.value, updateError: "" }); else app.set({ updateError: r.error.message });
  void refreshHistory();
}
/** Waits for the launcher to restart the server, then reloads the page so the new interface is loaded. */
function watchRestart(kind: "install" | "rollback") {
  const started = Date.now();
  let wentDown = false;
  const tick = async () => {
    const r = await api.updateStatus();
    if (!r.ok) wentDown = true;
    else if (wentDown || Date.now() - started > 20_000) { location.reload(); return; }
    if (Date.now() - started > 5 * 60_000) {
      app.set({ updateRestarting: "", updateError: "Перезапуск занял слишком много времени. Посмотрите окно JUUNIBI — там написана причина." });
      return;
    }
    setTimeout(() => void tick(), 1500);
  };
  app.set({ updateRestarting: kind, updateError: "", updateWarnings: [] });
  setTimeout(() => void tick(), 1200);
}
/** Installs a prepared update (or a planned rollback) right now: the launcher restarts JUUNIBI. */
export async function installNow(force = false) {
  const kind = app.get().update?.rollbackPending && app.get().update?.phase !== "ready" ? "rollback" : "install";
  const r = await api.updateInstallNow(force);
  if (r.ok) return watchRestart(kind);
  const warnings = (r.error as Error & { body?: { warnings?: string[] } }).body?.warnings;
  if (warnings?.length) app.set({ updateWarnings: warnings, updateError: "" });
  else app.set({ updateError: r.error.message, updateWarnings: [] });
}
export function dismissInstallWarning() { app.set({ updateWarnings: [] }); }
