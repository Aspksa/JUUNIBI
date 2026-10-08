import { Kernel, Logger, Store, attempt } from "@juunibi/core";
import { api, type MemoryItem, type Status, type ApprovalItem, type UpdateStatus } from "./api";
import "./style.css";

interface Msg { role: "user" | "bot" | "error"; text: string; turnId?: string; rating?: 1 | -1; tools?: string[] }
interface State {
  msgs: Msg[]; busy: boolean; approvals: ApprovalItem[]; update: UpdateStatus | null; updateError: string; status: Status | null; tab: "chat" | "memory" | "modules" | "update";
  memory: MemoryItem[]; modules: { name: string; deps: string[]; status: string }[]; theme: "auto" | "light" | "dark";
}

const KEY = "juunibi:ui:v2";
const saved = attempt(() => JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<State>);
const theme0 = saved.ok && (saved.value.theme === "light" || saved.value.theme === "dark") ? saved.value.theme : "auto";
const store = new Store<State>({ msgs: [], busy: false, approvals: [], update: null, updateError: "", status: null, tab: "chat", memory: [], modules: [], theme: theme0 });
const kernel = new Kernel(new Logger("web", "info"));

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const { cls, ...rest } = props;
  const n = Object.assign(document.createElement(tag), rest);
  if (typeof cls === "string") n.className = cls;
  n.append(...kids);
  return n;
};

async function refreshUpdate() {
  const r = await api.updateStatus();
  if (r.ok) store.set({ update: r.value });
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
    const nextTheme = { auto: "light", light: "dark", dark: "auto" } as const;
    const tabs = { chat: "Чат", memory: "Память", modules: "Модули", update: "Обновление проекта" } as const;

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
      if (b?.dataset.tab) { const tab = b.dataset.tab as State["tab"]; store.set({ tab }); if (tab === "memory") void refreshMemory(); if (tab === "modules") void refreshModules(); if (tab === "update") void refreshUpdate(); }
      else if (b?.id === "theme") store.set((s) => ({ theme: nextTheme[s.theme] }));
    });

    const poll = setInterval(() => { if (store.get().busy || store.get().approvals.length) void refreshApprovals(); if (store.get().tab === "update") void refreshUpdate(); }, 1000);
    ctx.onStop(() => clearInterval(poll));
    const render = () => {
      const s = store.get();
      const banner = s.status && !s.status.assistant ? el("p", { cls: "banner", role: "alert", textContent: s.status.hint ?? "Помощник не настроен." }) : null;
      const head = el("header", {}, el("h1", { textContent: "JUUNIBI" }),
        el("span", { cls: "model", textContent: s.status?.model ?? "" }),
        el("button", { id: "theme", type: "button", cls: "ghost", textContent: themeNames[s.theme] }));
      const nav = el("nav", { cls: "tabs" }, ...(Object.keys(tabs) as (keyof typeof tabs)[]).map((t) => {
        const b = el("button", { type: "button", textContent: tabs[t] });
        b.dataset.tab = t; b.setAttribute("aria-pressed", String(t === s.tab));
        return b;
      }));
      let body: HTMLElement;
      if (s.tab === "chat") {
        log.replaceChildren(
          ...(s.msgs.length ? [] : [el("p", { cls: "empty", textContent: "Спросите что-нибудь или попросите запомнить." })]),
          ...s.msgs.map((m) => {
            const row = el("div", { cls: `msg ${m.role}` }, el("div", { cls: "bubble", textContent: m.text }));
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
        body = el("div", {}, log, form);
        queueMicrotask(() => (log.scrollTop = log.scrollHeight));
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
      } else if (s.tab === "update") {
        const u = s.update;
        const btn = (title: string, action: () => void, disabled = false) => {
          const b = el("button", { type: "button", textContent: title, disabled });
          b.addEventListener("click", action);
          return b;
        };
        const progress = el("progress", { max: 100, value: u?.percent ?? 0 });
        progress.setAttribute("aria-label", "Прогресс скачивания");
        body = el("section", { cls: "updater" },
          el("h2", { textContent: "Обновление проекта" }),
          el("p", { textContent: "Источник: github.com/Aspksa/JUUNIBI" }),
          el("p", { textContent: "Локальная версия: " + (u?.localVersion ?? "загрузка…") }),
          el("p", { textContent: "Доступная версия: " + (u?.latest?.version ?? "ещё не проверена") }),
          el("p", { textContent: "Описание: " + (u?.latest?.description ?? "Нажмите «Проверить обновления»") }),
          el("p", { textContent: "Дата публикации: " + (u?.latest?.date ? new Date(u.latest.date).toLocaleString("ru-RU") : "неизвестна") }),
          btn("Проверить обновления", () => void checkUpdate(), u?.phase === "downloading" || u?.phase === "testing"),
          btn("Скачать и проверить", () => void downloadUpdate(), !u?.latest || u.localVersion === u.latest.sha || u.phase === "downloading" || u.phase === "testing"),
          progress,
          el("p", { textContent: `${u?.percent ?? 0}% · Файлов: ${u?.downloadedFiles ?? 0} из ${u?.totalFiles ?? 0} · ${((u?.downloadedBytes ?? 0) / 1048576).toFixed(2)} из ${((u?.totalBytes ?? 0) / 1048576).toFixed(2)} МБ` }),
          el("p", { textContent: "Этап: " + (u?.phase === "testing" ? "Тесты и сборка" : u?.phase === "ready" ? "Готово к установке" : u?.phase === "downloading" ? "Скачивание" : u?.phase === "error" ? "Ошибка" : "Ожидание") }),
          el("p", { textContent: u?.error || s.updateError || u?.message || "" }),
          el("p", { textContent: u?.phase === "ready" ? "Перезапустите JUUNIBI через штатный лаунчер для установки. Резервная копия будет создана автоматически." : "" }),
        );
      } else {
        body = el("ul", {}, ...s.modules.map((m) => el("li", {}, el("span", { cls: "grow", textContent: m.name }), el("small", { textContent: `${m.status}${m.deps.length ? " ← " + m.deps.join(", ") : ""}` }))));
      }
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
      view.replaceChildren(head, nav, ...(banner ? [banner] : []), ...approvals, el("main", { cls: "card" }, body));
    };
    ctx.onStop(store.subscribe(render));
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
