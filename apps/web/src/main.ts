import { Kernel, Logger, Store, attempt } from "@juunibi/core";
import { api, type MemoryItem, type Status, type ApprovalItem, type UpdateStatus, type UpdateEvent, type SceneReply } from "./api";
import "./style.css";

interface Msg { role: "user" | "bot" | "error"; text: string; turnId?: string; rating?: 1 | -1; tools?: string[] }
interface State {
  updateEvents: UpdateEvent[]; updateMode: "simple"|"visual"|"technical"; scene: SceneReply | null; msgs: Msg[]; busy: boolean; approvals: ApprovalItem[]; update: UpdateStatus | null; updateError: string; status: Status | null; tab: "chat" | "memory" | "modules" | "update" | "settings";
  memory: MemoryItem[]; modules: { name: string; deps: string[]; status: string }[]; theme: "auto" | "light" | "dark";
}

const KEY = "juunibi:ui:v2";
const saved = attempt(() => JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<State>);
const theme0 = saved.ok && (saved.value.theme === "light" || saved.value.theme === "dark") ? saved.value.theme : "auto";
const store = new Store<State>({ updateEvents: [], updateMode: "visual", scene: null, msgs: [], busy: false, approvals: [], update: null, updateError: "", status: null, tab: "chat", memory: [], modules: [], theme: theme0 });
const kernel = new Kernel(new Logger("web", "info"));

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const { cls, ...rest } = props;
  const n = Object.assign(document.createElement(tag), rest);
  if (typeof cls === "string") n.className = cls;
  n.append(...kids);
  return n;
};

async function refreshEvents() {
  const r = await api.updateEvents();
  if (r.ok && r.value.map(e=>e.event_id).join(",") !== store.get().updateEvents.map(e=>e.event_id).join(",")) store.set({updateEvents:r.value});
}
async function refreshUpdate() {
  const r = await api.updateStatus();
  if (r.ok && JSON.stringify(r.value) !== JSON.stringify(store.get().update)) store.set({ update: r.value });
}
async function checkUpdate() {
  const r = await api.updateCheck();
  if (r.ok) store.set({ update: r.value, updateError: "" });
  else store.set({ updateError: r.error.message });
}
async function downloadUpdate() {
  const r = await api.updateDownload();
  if (!r.ok) store.set({ updateError: r.error.message });
  else void refreshUpdate();
}
const SVG = "http://www.w3.org/2000/svg";
const ICONS: Record<string, string> = {
  chat: "M4 5h16v11H9l-5 4z",
  memory: "M12 3a6 6 0 0 0-3 11.2V17h6v-2.8A6 6 0 0 0 12 3zM9 20h6",
  modules: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  update: "M12 4v10m0 0-4-4m4 4 4-4M5 19h14",
  settings: "M4 7h9M17 7h3M4 17h3M11 17h9M15 4v6M9 14v6",
  sun: "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 1v3M12 20v3M1 12h3M20 12h3",
  moon: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z",
  auto: "M12 3a9 9 0 1 0 0 18V3z",
};
function icon(name: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("width", "20"); svg.setAttribute("height", "20");
  svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round"); svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", ICONS[name] ?? ""); svg.append(path);
  return svg;
}
/** Fox crest: ears, face and a fan of twelve tails — the JUUNIBI emblem (original vector, no raster assets). */
function emblem(size: number): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 100 100"); svg.setAttribute("width", String(size)); svg.setAttribute("height", String(size));
  svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "Эмблема JUUNIBI");
  const add = (tag: string, attrs: Record<string, string>) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); svg.append(n); };
  for (let i = 0; i < 12; i++) {
    const a = (-75 + i * (150 / 11)) * Math.PI / 180;
    const x = 50 + Math.sin(a) * 44, y = 62 - Math.cos(a) * 46;
    add("path", { d: `M50 62 Q${50 + Math.sin(a) * 30} ${62 - Math.cos(a) * 14} ${x.toFixed(1)} ${y.toFixed(1)}`, stroke: "var(--accent)", "stroke-width": "3.4", "stroke-linecap": "round", fill: "none", opacity: i % 2 ? "0.55" : "0.9" });
  }
  add("path", { d: "M30 58 L33 34 L44 46 Q50 44 56 46 L67 34 L70 58 Q70 78 50 82 Q30 78 30 58 Z", fill: "var(--card)", stroke: "var(--accent)", "stroke-width": "2.6", "stroke-linejoin": "round" });
  add("path", { d: "M41 62 Q44 60 47 62 M53 62 Q56 60 59 62", stroke: "var(--accent)", "stroke-width": "2.4", "stroke-linecap": "round", fill: "none" });
  add("path", { d: "M47 70 L50 73 L53 70 Z", fill: "var(--accent)" });
  return svg;
}
const short = (v?: string) => (v && /^[0-9a-f]{40}$/.test(v) ? v.slice(0, 8) : v ?? "…");
const SUGGESTIONS = ["Что умеешь?", "Покажи модули проекта", "Запомни: я люблю тёмную тему"];

async function refreshMemory() {
  const r = await api.memory();
  if (r.ok) store.set({ memory: r.value });
}
async function refreshModules() {
  const r = await api.modules();
  if (r.ok) store.set({ modules: r.value });
}

async function refreshApprovals() {
  const r = await api.approvals();
  if (r.ok) store.set({ approvals: r.value });
}
async function decideApproval(id: string, approve: boolean) {
  await api.decideApproval(id, approve);
  await refreshApprovals();
}

async function send(text: string) {
  const scene = await api.nextScene();
  if (scene.ok) store.set({ scene: scene.value });
  store.set((s) => ({ msgs: [...s.msgs, { role: "user", text }], busy: true }));
  const r = await api.chat(text);
  store.set((s) => ({
    busy: false,
    msgs: [...s.msgs, r.ok ? { role: "bot", text: r.value.reply || "(пустой ответ)", turnId: r.value.turnId, tools: r.value.tools } : { role: "error", text: r.error.message }],
  }));
}

async function rate(m: Msg, rating: 1 | -1) {
  if (!m.turnId) return;
  const r = await api.feedback(m.turnId, rating);
  if (!r.ok) return;
  store.set((s) => ({ msgs: s.msgs.map((x) => (x === m ? { ...x, rating } : x)) }));
  await api.reflect(m.turnId); // proposes lessons; they wait for approval in "Память"
  await refreshMemory();
}

kernel.register({
  name: "theme",
  start(ctx) {
    const apply = (t: State["theme"]) => (t === "auto" ? document.documentElement.removeAttribute("data-theme") : (document.documentElement.dataset.theme = t));
    apply(store.get().theme);
    ctx.onStop(store.select((s) => s.theme, (t) => { apply(t); attempt(() => localStorage.setItem(KEY, JSON.stringify({ theme: t }))); }));
  },
});

kernel.register({
  name: "ui",
  deps: ["theme"],
  start(ctx) {
    const root = document.getElementById("app");
    if (!root) throw new Error("#app not found");
    const view = el("div", { cls: "wrap" });
    root.replaceChildren(view);
    const themeNames = { auto: "Тема: авто", light: "Тема: светлая", dark: "Тема: тёмная" };
    const themeIcon = { auto: "auto", light: "sun", dark: "moon" } as const;
    const shortTabs = { chat: "Чат", memory: "Память", modules: "Модули", update: "Обновл.", settings: "ИИ" } as const;
    const tabIcon = { chat: "chat", memory: "memory", modules: "modules", update: "update", settings: "settings" } as const;
    const nextTheme = { auto: "light", light: "dark", dark: "auto" } as const;
    const tabs = { chat: "Чат", memory: "Память", modules: "Модули", update: "Обновление", settings: "Настройки" } as const;

    const input = el("input", { type: "text", id: "msg", placeholder: "Напишите помощнику…", autocomplete: "off", maxLength: 4000 });
    input.setAttribute("aria-label", "Сообщение");
    const log = el("div", { cls: "log", role: "log" });
    log.setAttribute("aria-live", "polite");
    const form = el("form", {}, input, el("button", { type: "submit", cls: "primary", textContent: "Отправить" }));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const t = input.value.trim();
      if (!t || store.get().busy || !store.get().status?.assistant) return;
      input.value = "";
      void send(t);
    });
    view.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (b?.dataset.tab) { const tab = b.dataset.tab as State["tab"]; store.set({ tab }); if (tab === "memory") void refreshMemory(); if (tab === "modules") void refreshModules(); if (tab === "update") { void refreshUpdate(); void refreshEvents(); } }
      else if (b?.id === "theme") store.set((s) => ({ theme: nextTheme[s.theme] }));
    });

    void refreshUpdate();
    const poll = setInterval(() => {
      const current = store.get();
      if (current.busy || current.approvals.length) void refreshApprovals();
      if (current.tab === "update" || current.update?.phase === "downloading" || current.update?.phase === "testing") {void refreshUpdate();void refreshEvents();}
    }, 2500);
    ctx.onStop(() => clearInterval(poll));
    let lastFlightEvent = "";
    const render = () => {
      const s = store.get();
      const banner = s.status && !s.status.assistant && (s.tab === "chat" || s.tab === "settings") ? el("p", { cls: "banner", role: "alert", textContent: s.status.hint ?? "Помощник не настроен." }) : null;
      const themeBtn = el("button", { id: "theme", type: "button", cls: "ghost icon-btn", title: themeNames[s.theme] }, icon(themeIcon[s.theme]));
      themeBtn.setAttribute("aria-label", themeNames[s.theme]);
      const head = el("header", { cls: "app-head" }, emblem(36), el("h1", { textContent: "JUUNIBI" }),
        el("span", { cls: "model", textContent: (s.status?.model ?? "").split("/").pop() ?? "", title: s.status?.model ?? "" }), themeBtn);
      const nav = el("nav", { cls: "tabs", role: "tablist" }, ...(Object.keys(tabs) as (keyof typeof tabs)[]).map((t) => {
        const dot = t === "update" && s.update?.latest && s.update.localVersion !== s.update.latest.sha;
        const b = el("button", { type: "button" }, icon(tabIcon[t]), el("span", { cls: "full", textContent: tabs[t] }), el("span", { cls: "short", textContent: shortTabs[t] }), ...(dot ? [el("i", { cls: "dot", title: "Доступно обновление" })] : []));
        b.dataset.tab = t; b.setAttribute("aria-pressed", String(t === s.tab));
        if (t === s.tab) b.setAttribute("aria-current", "page");
        return b;
      }));
      let body: HTMLElement;
      if (s.tab === "chat") {
        const previousScroll = log.scrollTop;
        const shouldScroll = log.scrollHeight - log.clientHeight - log.scrollTop < 36;
        log.replaceChildren(
          ...(s.msgs.length || s.busy ? [] : [el("div", { cls: "welcome" }, emblem(88), el("h2", { textContent: "Чем помочь, Господин?" }), el("p", { textContent: "Спросите что-нибудь, попросите запомнить или проверить проект." }),
            el("div", { cls: "chips" }, ...SUGGESTIONS.map((t) => { const c = el("button", { type: "button", textContent: t }); c.addEventListener("click", () => { if (!store.get().busy && store.get().status?.assistant) void send(t); }); return c; })))]),
          ...s.msgs.map((m) => {
            const row = el("div", { cls: `msg ${m.role}` }, el("div", { cls: "bubble", textContent: m.text }));
            const copy = el("button", { type: "button", cls: "ghost copy-message", textContent: "Копировать" });
            copy.setAttribute("aria-label", "Копировать сообщение");
            copy.addEventListener("click", async () => {
              try { await navigator.clipboard.writeText(m.text); copy.textContent = "Скопировано"; }
              catch { copy.textContent = "Выделите текст и нажмите Ctrl+C"; }
            });
            row.append(copy);
            if (m.tools?.length) row.append(el("small", { textContent: `инструменты: ${m.tools.join(", ")}` }));
            if (m.role === "bot" && m.turnId) {
              const mk = (r: 1 | -1, label: string) => {
                const b = el("button", { type: "button", cls: "ghost", textContent: r === 1 ? "👍" : "👎" });
                b.setAttribute("aria-label", label); b.setAttribute("aria-pressed", String(m.rating === r));
                b.addEventListener("click", () => void rate(m, r));
                return b;
              };
              row.append(el("div", { cls: "rate" }, mk(1, "Хороший ответ"), mk(-1, "Плохой ответ")));
            }
            return row;
          }),
          ...(s.busy ? [el("p", { cls: "empty", textContent: "Помощник думает…" })] : []),
        );
        input.disabled = s.busy || !s.status?.assistant;
        const scenePanel = s.scene ? el("section", { cls: "scene-panel", role: "status" },
          el("div", { cls: "scene-meta", textContent: "✦ " + s.scene.action.category + " · " + s.scene.stats.used + "/" + s.scene.stats.total + " действий" }),
          el("p", { cls: "scene-action", textContent: s.scene.action.text }),
          ...(s.scene.phrase ? [el("p", { cls: "scene-phrase", textContent: s.scene.phrase.text })] : [])
        ) : null;
        body = el("div", {}, ...(scenePanel ? [scenePanel] : []), log, form);
        queueMicrotask(() => { log.scrollTop = shouldScroll ? log.scrollHeight : previousScroll; });
      } else if (s.tab === "memory") {
        const item = (m: MemoryItem) => {
          const li = el("li", {}, el("span", { cls: "grow", textContent: `${m.status === "pending" ? "⏳ " : ""}${m.text}` }));
          if (m.status === "pending") {
            const ok = el("button", { type: "button", cls: "primary", textContent: "Принять" });
            ok.addEventListener("click", () => void api.approve(m.id).then(refreshMemory));
            li.append(ok);
          }
          const del = el("button", { type: "button", cls: "ghost", textContent: "✕" });
          del.setAttribute("aria-label", `Забыть: ${m.text}`);
          del.addEventListener("click", () => void api.forget(m.id).then(refreshMemory));
          li.append(del);
          return li;
        };
        body = el("ul", {}, ...(s.memory.length ? s.memory.map(item) : [el("li", { cls: "empty", textContent: "Память пуста. Новые уроки появятся здесь на подтверждение." })]));
      } else if (s.tab === "settings") {
        const title = el("h2", { textContent: "Подключение Cloud.ru" });
        const label = el("label", { textContent: "API-ключ Cloud.ru" });
        const key = el("input", { type: "password", autocomplete: "new-password", placeholder: "Вставьте API-ключ", required: true });
        const save = el("button", { type: "submit", cls: "primary", textContent: "Сохранить и подключить" });
        const note = el("p", { role: "status", textContent: s.status?.assistant ? "Модель подключена" : "Ключ ещё не настроен" });
        const configForm = el("form", {}, label, key, save);
        configForm.addEventListener("submit", async e => {
          e.preventDefault();
          save.disabled = true;
          const r = await api.cloudSave(key.value.trim());
          key.value = "";
          save.disabled = false;
          note.textContent = r.ok ? "Ключ сохранён локально. DeepSeek V4 Flash подключена." : r.error.message;
          if (r.ok) { const status = await api.status(); if (status.ok) store.set({ status: status.value }); }
        });
        body = el("section", { cls: "updater" }, title, el("p", { textContent: "Провайдер: Cloud.ru · Модель: DeepSeek V4 Flash" }), el("p", { textContent: "Ключ хранится на локальном сервере в data/cloudru-settings.json, не в браузере и не в GitHub." }), configForm, note);
      } else if (s.tab === "update") {
        const u = s.update;
        const events = [...new Map(s.updateEvents.map(e=>[e.event_id,e])).values()];
        const manifest = [...events].reverse().find(e=>e.type==="manifest_ready");
        const files = manifest?.files ?? [];
        const newest = [...events].reverse().find(e=>e.relative_path && (e.type==="file_download_done" || e.type==="file_install_start" || e.type==="file_install_done" || e.type==="file_install_failed"));
        const installed = new Set(events.filter(e=>e.type==="file_install_done").map(e=>e.relative_path));
        const downloaded = new Set(events.filter(e=>e.type==="file_download_done").map(e=>e.relative_path));
        const failed = new Set(events.filter(e=>e.type==="file_install_failed").map(e=>e.relative_path));
        const modes = el("div",{cls:"update-modes"},...(["simple","visual","technical"] as const).map(mode=>{
          const b=el("button",{type:"button",textContent:mode==="simple"?"Простой":mode==="visual"?"Визуальный":"Технический"});
          b.setAttribute("aria-pressed",String(s.updateMode===mode));
          b.addEventListener("click",()=>store.set({updateMode:mode}));
          return b;
        }));
        const folders = [...new Set(files.map(f=>f.path.split("/").slice(0,-1).join("/") || "Корень"))].sort();
        const flight = el("div",{cls:"flight-layout"},
          el("div",{cls:"flight-zone"},el("strong",{textContent:"GitHub · источник"}),...(files.slice(0,65).map(f=>el("div",{cls:"flight-file"+(f.change_type==="removed"?" removed":""),textContent:(f.change_type==="added"?"+ ":f.change_type==="modified"?"~ ":f.change_type==="removed"?"− ":"= ")+f.path})))),
          el("div",{cls:"flight-center"},el("strong",{textContent:"Проверка → загрузка"}),...(newest?[el("div",{cls:"flying-file",textContent:newest.relative_path})]:[el("p",{textContent:"Ожидание реальных событий"})])),
          el("div",{cls:"flight-zone"},el("strong",{textContent:"Локальные папки"}),...folders.slice(0,65).map(folder=>{
            const count=files.filter(f=>(f.path.split("/").slice(0,-1).join("/")||"Корень")===folder&&installed.has(f.path)).length;
            return el("details",{},el("summary",{textContent:"📁 "+folder+" · установлено "+count}),...files.filter(f=>(f.path.split("/").slice(0,-1).join("/")||"Корень")===folder).map(f=>el("div",{cls:"flight-file "+(installed.has(f.path)?"installed":failed.has(f.path)?"failed":downloaded.has(f.path)?"downloaded":""),textContent:(installed.has(f.path)?"✓ ":failed.has(f.path)?"✕ ":downloaded.has(f.path)?"↓ ":"• ")+f.path.split("/").pop()})));
          }))
        );
        const logPanel=el("div",{cls:"update-log"},...events.slice(-100).reverse().map(e=>el("p",{textContent:new Date(e.timestamp).toLocaleTimeString("ru-RU")+" · "+e.type+(e.relative_path?" · "+e.relative_path:"")+(e.message?" · "+e.message:"")})));

        const btn = (title: string, action: () => void, disabled = false) => {
          const b = el("button", { type: "button", textContent: title, disabled });
          b.addEventListener("click", action);
          return b;
        };
        const health = [...events].reverse().find(e => e.type === "health_check_done");
        const removals = u?.pendingRemovals ?? [];
        const removalBox = u?.phase === "ready" && removals.length
          ? el("section", { cls: "removals", role: "group" },
              el("strong", { textContent: `Новая версия больше не содержит ${removals.length} файл(ов). Они будут удалены при установке только после вашего подтверждения (резервная копия создаётся):` }),
              el("ul", {}, ...removals.slice(0, 50).map((r) => el("li", { textContent: r }))),
              btn(u.removalsConfirmed ? "Удаление подтверждено" : "Подтвердить удаление", () => void api.updateConfirmRemovals().then((r) => { if (r.ok) store.set({ update: r.value }); }), !!u.removalsConfirmed))
          : null;
        const progress = el("progress", { max: 100, value: u?.percent ?? 0 });
        progress.setAttribute("aria-label", "Прогресс скачивания");
        body = el("section", { cls: "updater" },
          el("h2", { textContent: "Обновление проекта" }),
          modes,
          ...(s.updateMode==="visual"?[flight]:[]),
          ...(s.updateMode==="technical"?[el("h3",{textContent:"Журнал фактических событий"}),logPanel]:[]),
          el("p", { textContent: "Источник: github.com/Aspksa/JUUNIBI" }),
          el("p", { textContent: "Локальная версия: " + short(u?.localVersion) }),
          el("p", { textContent: "Доступная версия: " + (u?.latest?.version ?? "ещё не проверена") }),
          el("p", { textContent: "Описание: " + (u?.latest?.description ?? "Нажмите «Проверить обновления»") }),
          el("p", { textContent: "Дата публикации: " + (u?.latest?.date ? new Date(u.latest.date).toLocaleString("ru-RU") : "неизвестна") }),
          btn("Проверить обновления", () => void checkUpdate(), u?.phase === "downloading" || u?.phase === "testing"),
          btn("Скачать и проверить", () => void downloadUpdate(), !u?.latest || u.localVersion === u.latest.sha || u.phase === "downloading" || u.phase === "testing"),
          progress,
          ...(removalBox ? [removalBox] : []),
          ...(health ? [el("p", { cls: health.status === "healthy" ? "ok" : "bad", textContent: "Проверка запуска после установки: " + (health.status === "healthy" ? "пройдена" : "не пройдена" + (health.message ? " — " + health.message : "")) })] : []),
          el("p", { textContent: `${u?.percent ?? 0}% · Файлов: ${u?.downloadedFiles ?? 0} из ${u?.totalFiles ?? 0} · ${((u?.downloadedBytes ?? 0) / 1048576).toFixed(2)} из ${((u?.totalBytes ?? 0) / 1048576).toFixed(2)} МБ` }),
          el("p", { textContent: "Этап: " + (u?.phase === "testing" ? "Тесты и сборка" : u?.phase === "ready" ? "Готово к установке" : u?.phase === "downloading" ? "Скачивание" : u?.phase === "error" ? "Ошибка" : "Ожидание") }),
          el("p", { textContent: u?.error || s.updateError || u?.message || "" }),
          el("p", { textContent: u?.phase === "ready" ? "Перезапустите JUUNIBI через штатный лаунчер для установки. Резервная копия будет создана автоматически." : "" }),
        );
      } else {
        body = el("ul", {}, ...s.modules.map((m) => el("li", {}, el("span", { cls: "grow", textContent: m.name }), el("small", { textContent: `${m.status}${m.deps.length ? " ← " + m.deps.join(", ") : ""}` }))));
      }
      const updateAlert = s.tab !== "update" && s.update?.latest && s.update.localVersion !== "не определена" && s.update.localVersion !== s.update.latest.sha ? el("p", { cls: "update-notice", role: "status", textContent: "Доступно обновление JUUNIBI: " + s.update.latest.version + ". Откройте «Обновление проекта»." }) : null;
      const approvals = s.approvals.map((a) => {
        const panel = el("section", { cls: "card", role: "group" },
          el("h2", { textContent: `Подтверждение: ${a.tool} (${a.risk})` }),
          el("pre", { textContent: JSON.stringify(a.args, null, 2).slice(0, 4000) }),
          el("p", { textContent: "Разрешение одноразовое. Проверьте действие и параметры." }));
        for (const [allow, title] of [[false, "Отклонить"], [true, "Разрешить"]] as const) {
          const b = el("button", { type: "button", cls: allow ? "primary" : "ghost", textContent: title });
          b.addEventListener("click", () => void decideApproval(a.id, allow));
          panel.append(b);
        }
        return panel;
      });
      view.replaceChildren(head, nav, ...(banner ? [banner] : []), ...(updateAlert ? [updateAlert] : []), ...approvals, el("main", { cls: "card" }, body));
      if (s.tab === "update" && s.updateMode === "visual" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        const event = [...s.updateEvents].reverse().find(e => e.relative_path && (e.type === "file_download_done" || e.type === "file_install_done"));
        if (event && event.event_id !== lastFlightEvent) {
          lastFlightEvent = event.event_id;
          const zones = view.querySelectorAll<HTMLElement>(".flight-zone");
          const center = view.querySelector<HTMLElement>(".flight-center");
          const from = event.type === "file_install_done" ? center : zones[0];
          const to = event.type === "file_install_done" ? zones[1] : center;
          if (from && to) {
            const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
            const x = a.left + a.width / 2, y = a.top + a.height / 2;
            const dx = b.left + b.width / 2 - x, dy = b.top + b.height / 2 - y;
            const chip = el("div", { cls: "update-flight-overlay", textContent: event.relative_path.split("/").pop() ?? "Файл" });
            chip.style.left = x + "px"; chip.style.top = y + "px";
            document.body.append(chip);
            const animation = chip.animate([
              { transform: "translate(-50%,-50%)", opacity: 0.6 },
              { transform: "translate(calc(-50% + " + (dx / 2) + "px),calc(-50% + " + (dy / 2 - 24) + "px))", opacity: 1, offset: 0.5 },
              { transform: "translate(calc(-50% + " + dx + "px),calc(-50% + " + dy + "px))", opacity: 0.85 }
            ], { duration: 850, easing: "ease-in-out" });
            void animation.finished.then(() => chip.remove(), () => chip.remove());
          }
        }
      }
    };
    let previous = store.get();
    ctx.onStop(store.subscribe(() => {
      const next = store.get();
      const updateOnly = previous.update !== next.update &&
        previous.updateEvents === next.updateEvents && previous.updateMode === next.updateMode && previous.msgs === next.msgs && previous.busy === next.busy &&
        previous.approvals === next.approvals && previous.updateError === next.updateError &&
        previous.status === next.status && previous.tab === next.tab &&
        previous.memory === next.memory && previous.modules === next.modules && previous.theme === next.theme;
      previous = next;
      if (updateOnly && next.tab !== "update") return;
      render();
    }));
    render();
    void api.status().then((r) => store.set({ status: r.ok ? r.value : { assistant: false, hint: "Сервер недоступен. Запустите через JUUNIBI.bat." } }));
    ctx.onStop(() => root.replaceChildren());
  },
});

kernel.bus.on("plugin:failed", ({ name, error }) => {
  document.body.insertAdjacentHTML("afterbegin", `<p role="alert" class="banner"></p>`);
  document.querySelector(".banner")!.textContent = `Ошибка модуля ${name}: ${error.message}`;
});
window.addEventListener("error", (e) => kernel.log.error("uncaught", e.error));
window.addEventListener("unhandledrejection", (e) => kernel.log.error("unhandled rejection", e.reason));
void kernel.start();
