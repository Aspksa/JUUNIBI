import { Kernel, Logger } from "@juunibi/core";
import { Avatar } from "./avatar";
import { Chats } from "./chat/chats";
import { ChatController } from "./chat/controller";
import { ChatView } from "./chat/view";
import { el, icon, type IconName } from "./dom";
import { homePage } from "./pages/home";
import { memoryPage } from "./pages/memory";
import { modulesPage } from "./pages/modules";
import { animateFlight, updatePage } from "./pages/update";
import { settingsPage } from "./pages/settings";
import {
  app, persistPrefs, refreshApprovals, refreshEvents, refreshMemory, refreshModules, refreshStatus, refreshUpdate, routeFromHash,
  type AppState, type Route, type Theme,
} from "./state";
import "./style.css";

const kernel = new Kernel(new Logger("web", "info"));
const chats = new Chats();
const ctl = new ChatController(chats);

const NAV: { route: Route; label: string; icon: IconName }[] = [
  { route: "home", label: "Главная", icon: "home" },
  { route: "memory", label: "Память", icon: "memory" },
  { route: "modules", label: "Модули", icon: "modules" },
  { route: "update", label: "Обновление", icon: "update" },
  { route: "settings", label: "Настройки", icon: "settings" },
];
const THEME_ICON: Record<Theme, IconName> = { auto: "auto", light: "sun", dark: "moon" };
const THEME_NAME: Record<Theme, string> = { auto: "Тема: как в системе", light: "Тема: светлая", dark: "Тема: тёмная" };
const NEXT_THEME: Record<Theme, Theme> = { auto: "light", light: "dark", dark: "auto" };

kernel.register({
  name: "theme",
  start(ctx) {
    const apply = (t: Theme) => (t === "auto" ? document.documentElement.removeAttribute("data-theme") : (document.documentElement.dataset.theme = t));
    apply(app.get().theme);
    ctx.onStop(app.select((s) => s.theme, (t) => apply(t)));
  },
});

kernel.register({
  name: "shell",
  deps: ["theme"],
  start(ctx) {
    const root = document.getElementById("app");
    if (!root) throw new Error("#app not found");

    const pageHost = el("main", { cls: "content-main", attrs: { id: "main", tabindex: "-1" } });
    const nav = el("nav", { cls: "nav", attrs: { "aria-label": "Разделы" } });
    const navScrim = el("div", { cls: "nav-scrim" });
    navScrim.addEventListener("click", () => app.set({ navOpen: false }));
    const burger = el("button", { type: "button", cls: "icon-btn burger", title: "Меню", attrs: { "aria-label": "Меню" } }, icon("menu", 20));
    burger.addEventListener("click", () => app.set((s) => ({ navOpen: !s.navOpen })));
    const topTitle = el("strong", { cls: "topbar-title" });
    const topbar = el("header", { cls: "topbar" }, burger, topTitle);
    const shell = el("div", { cls: "app" }, nav, navScrim, el("div", { cls: "content" }, topbar, pageHost));
    root.replaceChildren(shell);

    const go = (r: Route) => { location.hash = "#/" + r; };
    addEventListener("hashchange", () => app.set({ route: routeFromHash(), navOpen: false }));

    const chatWin = new ChatView(chats, ctl);
    document.body.append(chatWin.root);
    const avatar = new Avatar(() => openChat());
    document.body.append(avatar.root);

    const openChat = () => {
      app.set({ chatOpen: true, navOpen: false });
      chatWin.root.hidden = false;
      const c = avatar.center();
      chatWin.root.style.setProperty("--ox", c.x + "px"); chatWin.root.style.setProperty("--oy", c.y + "px");
      chatWin.root.classList.remove("opening"); void chatWin.root.offsetWidth; chatWin.root.classList.add("opening");
      if (!chats.active()) chats.create();
      ctl.clearUnread();
      void refreshStatus();
      queueMicrotask(() => chatWin.focus());
    };
    const closeChat = () => { app.set({ chatOpen: false }); chatWin.root.hidden = true; avatar.focus(); };
    chatWin.setHandlers(closeChat, () => { closeChat(); go("settings"); });
    addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (app.get().chatOpen) closeChat(); else openChat(); }
      else if (e.key === "Escape" && app.get().chatOpen && !e.defaultPrevented) { if (chatWin.escape() === "close") closeChat(); }
    });

    // ----- left menu
    const renderNav = (s: AppState) => {
      const newer = !!s.update?.latest && s.update.localVersion !== "не определена" && s.update.localVersion !== s.update.latest.sha;
      const theme = el("button", { type: "button", cls: "nav-item", title: THEME_NAME[s.theme] }, icon(THEME_ICON[s.theme], 18), el("span", { textContent: THEME_NAME[s.theme] }));
      theme.addEventListener("click", () => { app.set((x) => ({ theme: NEXT_THEME[x.theme] })); persistPrefs(app.get()); });
      nav.replaceChildren(
        el("div", { cls: "brand", textContent: "JUUNIBI" }), // reserved slot: put your logo here
        ...NAV.map((n) => el("a", { href: "#/" + n.route, cls: "nav-item" + (n.route === s.route ? " active" : ""), attrs: n.route === s.route ? { "aria-current": "page" } : {} },
          icon(n.icon, 18), el("span", { textContent: n.label }), n.route === "update" && newer ? el("i", { cls: "dot", title: "Доступно обновление" }) : null)),
        el("span", { cls: "grow" }), theme);
      nav.classList.toggle("open", s.navOpen);
      navScrim.classList.toggle("show", s.navOpen);
      topTitle.textContent = NAV.find((n) => n.route === s.route)?.label ?? "";
    };

    // ----- pages (re-rendered only when what they show actually changed, so typing in forms is never disturbed)
    let pageSig = "";
    const sigFor = (s: AppState): string => {
      switch (s.route) {
        case "home": return JSON.stringify([s.status, s.update?.latest?.sha, s.update?.localVersion, s.memory.length, s.memory.filter((m) => m.status === "pending").length, s.modules.length]);
        case "memory": return JSON.stringify(s.memory);
        case "modules": return JSON.stringify(s.modules);
        case "update": return JSON.stringify([s.update, s.updateEvents.length ? s.updateEvents[s.updateEvents.length - 1]?.event_id : "", s.updateEvents.length, s.updateMode, s.updateError]);
        case "settings": return JSON.stringify([s.status?.assistant, s.status?.model, s.theme, s.showScenes]);
      }
    };
    const renderPage = (s: AppState) => {
      const sig = s.route + "|" + sigFor(s);
      if (sig === pageSig) return;
      const changedRoute = !pageSig.startsWith(s.route + "|");
      pageSig = sig;
      const page =
        s.route === "home" ? homePage(s, { go, openChat })
        : s.route === "memory" ? memoryPage(s)
        : s.route === "modules" ? modulesPage(s)
        : s.route === "update" ? updatePage(s)
        : settingsPage(s, chats);
      const scroll = pageHost.scrollTop;
      pageHost.replaceChildren(page);
      if (!changedRoute) pageHost.scrollTop = scroll;
      if (s.route === "update") animateFlight(pageHost, s);
    };

    const renderAvatar = () => {
      const s = app.get();
      avatar.setState({ hidden: s.chatOpen, busy: ctl.busy, unread: ctl.store.get().unread, ready: !!s.status?.assistant, attention: s.approvals.length > 0 });
    };

    const onApp = () => { const s = app.get(); renderNav(s); renderPage(s); renderAvatar(); };
    ctx.onStop(app.subscribe(onApp));
    ctx.onStop(ctl.store.subscribe(renderAvatar));
    app.set({ route: routeFromHash() });
    onApp();

    // route entry hooks
    ctx.onStop(app.select((s) => s.route, (r) => {
      if (r === "memory") void refreshMemory();
      if (r === "modules") void refreshModules();
      if (r === "update") { void refreshUpdate(); void refreshEvents(); }
      pageHost.focus({ preventScroll: true });
    }));

    void refreshStatus(); void refreshUpdate(); void refreshMemory(); void refreshModules();
    let tick = 0;
    const poll = setInterval(() => {
      tick++;
      const s = app.get();
      if (ctl.busy || s.approvals.length) void refreshApprovals();
      if (s.route === "update" || s.update?.phase === "downloading" || s.update?.phase === "testing") { void refreshUpdate(); void refreshEvents(); }
      if (tick % 8 === 0) { void refreshStatus(); void refreshUpdate(); }
    }, 2500);
    ctx.onStop(() => clearInterval(poll));
    ctx.onStop(() => { chatWin.root.remove(); avatar.root.remove(); root.replaceChildren(); });
  },
});

kernel.bus.on("plugin:failed", ({ name, error }) => {
  const p = el("p", { cls: "fatal", attrs: { role: "alert" }, textContent: `Ошибка модуля ${name}: ${error.message}` });
  document.body.prepend(p);
});
addEventListener("error", (e) => kernel.log.error("uncaught", e.error));
addEventListener("unhandledrejection", (e) => kernel.log.error("unhandled rejection", e.reason));
void kernel.start();
