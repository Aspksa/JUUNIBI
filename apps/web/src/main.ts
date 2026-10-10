import { Kernel, Logger } from "@juunibi/core";
import { applyAccent } from "./accents";
import { isHelpKey, openHotkeys } from "./hotkeys";
import { Avatar } from "./avatar";
import { Chats } from "./chat/chats";
import { ChatController } from "./chat/controller";
import { ChatView } from "./chat/view";
import { el, icon, settleAnimations } from "./dom";
import { Menu, openConnection } from "./nav/menu";
import { NAV_ITEMS, itemForDigit } from "./nav/model";
import { closePalette, openPalette, paletteOpen, setPaletteFallback } from "./nav/palette";
import { baseEntries, taskEntries } from "./nav/commands";
import { openQuickAdd } from "./nav/quick-add";
import { modulesPage } from "./pages/modules";
import { brainPage } from "./pages/brain";
import { animateFlight, setUpdateRerender, updatePage } from "./pages/update";
import { focusSettingsSearch, settingsPage } from "./pages/settings";
import { tasksPage } from "./pages/tasks";
import { mobilePage } from "./pages/mobile";
import {
  app, BRAIN_TILE_ROUTES, refreshApprovals, refreshBrief, refreshSettings, refreshSuggestions, refreshEvents, refreshMemory, refreshModules, refreshStatus, refreshUpdate, refreshHistory, routeFromHash,
  type AppState, type Route, type Theme,
} from "./state";
import { announceDue } from "./notify";
import { showToast } from "./toast";
import { api } from "./api";
import "./style.css";
import "./nav/nav.css";

const kernel = new Kernel(new Logger("web", "info"));
const chats = new Chats();
const ctl = new ChatController(chats);

const syncMeta = (): void => {
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  let m = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!m) { m = document.createElement("meta"); m.name = "theme-color"; document.head.append(m); }
  if (bg) m.content = bg;
};

kernel.register({
  name: "theme",
  start(ctx) {
    const apply = (t: Theme) => (t === "auto" ? document.documentElement.removeAttribute("data-theme") : (document.documentElement.dataset.theme = t));
    let first = true;
    const swap = (t: Theme) => {
      const cl = document.documentElement.classList;
      if (!first) { cl.add("theme-fade"); setTimeout(() => cl.remove("theme-fade"), 420); }
      first = false; apply(t); syncMeta();
    };
    swap(app.get().theme);
    const reapply = () => { applyAccent(app.get().accent, app.get().customAccent); syncMeta(); };
    const look = () => {
      const s = app.get(), d = document.documentElement;
      if (s.uiRadius === "normal") d.removeAttribute("data-radius"); else d.dataset.radius = s.uiRadius;
      if (s.uiScale === "md") d.removeAttribute("data-scale"); else d.dataset.scale = s.uiScale;
    };
    reapply(); look();
    ctx.onStop(app.select((s) => s.customAccent, reapply));
    ctx.onStop(app.select((s) => s.uiRadius + s.uiScale, look));
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", reapply);
    ctx.onStop(() => mq.removeEventListener("change", reapply));
    ctx.onStop(app.select((s) => s.theme, (t) => { swap(t); reapply(); }));
    ctx.onStop(app.select((s) => s.accent, reapply));
  },
});

kernel.register({
  name: "shell",
  deps: ["theme"],
  start(ctx) {
    const root = document.getElementById("app");
    if (!root) throw new Error("#app not found");

    const pageHost = el("main", { cls: "content-main", attrs: { id: "main", tabindex: "-1" } });
    const navScrim = el("div", { cls: "nav-scrim" });
    navScrim.addEventListener("click", () => app.set({ navOpen: false }));
    const burger = el("button", { type: "button", cls: "icon-btn burger", title: "Меню", attrs: { "aria-label": "Меню" } }, icon("menu", 20));
    burger.addEventListener("click", () => app.set((s) => ({ navOpen: !s.navOpen })));
    const topTitle = el("strong", { cls: "topbar-title" });
    const topbar = el("header", { cls: "topbar" }, burger, topTitle);
    const menu: Menu = new Menu({ chats, ctl, go: (r) => go(r), openChat: (id) => openChat(id), quickAdd: () => quickAdd(), palette: () => palette() });
    const shell = el("div", { cls: "app" }, menu.nav, navScrim, el("div", { cls: "content" }, topbar, pageHost), menu.bottom);
    root.replaceChildren(shell);

    const go = (r: Route) => { location.hash = "#/" + r; };
    addEventListener("hashchange", () => app.set({ route: routeFromHash(), navOpen: false }));

    const chatWin = new ChatView(chats, ctl);
    document.body.append(chatWin.root);
    const avatar = new Avatar(() => openChat());
    document.body.append(avatar.root);

    const openChat = (convId?: string) => {
      if (convId) chats.select(convId);
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
    const closeChat = () => { app.set({ chatOpen: false }); chatWin.root.hidden = true; chatWin.onClosed(); avatar.focus(); };
    chatWin.setHandlers(closeChat, (r) => { closeChat(); go(r); });
    const newChat = () => { openChat(); chatWin.startNew(); };
    const quickAdd = (text = "") => openQuickAdd(() => { if (app.get().route === "tasks") { pageSig = ""; renderPage(app.get()); } }, text);
    const commandDeps = () => ({
      chats, prefs: menu.prefs, go: (r: Route) => { if (app.get().chatOpen) closeChat(); go(r); }, openChat: (id?: string) => openChat(id), newChat,
      send: (t: string) => void chatWin.send(t), quickAdd, toggleCollapsed: () => menu.toggleCollapsed(), editMenu: () => menu.startEdit(), connection: () => openConnection(go),
    });
    const palette = () => { const d = commandDeps(); openPalette(baseEntries(d), taskEntries(d)); };
    setPaletteFallback((q) => { openChat(); void chatWin.send(q); });
    // Physical keys (e.code), so the shortcuts also work with the Russian layout.
    addEventListener("keydown", (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && !e.shiftKey && e.code === "KeyK") { e.preventDefault(); if (paletteOpen()) closePalette(); else palette(); }
      else if (mod && !e.altKey && !e.shiftKey && e.code === "KeyJ") { e.preventDefault(); if (app.get().chatOpen) closeChat(); else openChat(); }
      else if (mod && !e.altKey && !e.shiftKey && e.code === "KeyB" && innerWidth > 860) { e.preventDefault(); menu.toggleCollapsed(); }
      else if (e.altKey && !mod && !e.shiftKey && e.code === "KeyN") { e.preventDefault(); newChat(); }
      else if (mod && !e.altKey && !e.shiftKey && e.code === "Comma") { e.preventDefault(); if (app.get().chatOpen) closeChat(); go("settings"); focusSettingsSearch(); }
      else if (isHelpKey(e)) { e.preventDefault(); openHotkeys(); }
      else if (e.altKey && !mod && !e.shiftKey && itemForDigit(menu.prefs, e.code)) {
        e.preventDefault();
        const n = itemForDigit(menu.prefs, e.code)!;
        if (n.route) { if (app.get().chatOpen) closeChat(); go(n.route); } else openChat();
      }
      else if (e.key === "Escape" && app.get().chatOpen && !e.defaultPrevented) { if (chatWin.escape() === "close") closeChat(); }
      else if (e.key === "Escape" && app.get().navOpen && !e.defaultPrevented) app.set({ navOpen: false });
    });

    // ----- left menu
    const renderNav = (s: AppState) => {
      menu.render(s);
      navScrim.classList.toggle("show", s.navOpen);
      topTitle.textContent = NAV_ITEMS.find((n) => n.route === (BRAIN_TILE_ROUTES[s.route] ? "brain" : s.route))?.label ?? "";
    };

    // ----- pages (re-rendered only when what they show actually changed, so typing in forms is never disturbed)
    let pageSig = "";
    const sigFor = (s: AppState): string => {
      switch (s.route) {
        case "memory": case "quality": return ""; // tiles of the Brain page, which keeps itself up to date
        case "modules": case "tasks": case "mobile": return ""; // the page loads and refreshes its own data
        case "brain": return "";
        case "update": return JSON.stringify([s.update, s.updateEvents.length ? s.updateEvents[s.updateEvents.length - 1]?.event_id : "", s.updateEvents.length, s.updateError, s.updateHistory, s.updateRestarting, s.updateWarnings]);
        case "settings": return JSON.stringify([s.assistantSettings, s.status?.assistant, s.status?.model, s.theme, s.accent, s.customAccent, s.uiRadius, s.uiScale, s.chatDensity, s.chatFont, s.showScenes, s.update?.localVersion, chats.store.get().items.length, chats.store.get().items.reduce((n, c) => n + c.messages.length, 0)]);
      }
    };
    const renderPage = (s: AppState) => {
      const sig = s.route + "|" + sigFor(s);
      if (sig === pageSig) return;
      const changedRoute = !pageSig.startsWith(s.route + "|");
      pageSig = sig;
      const page =
        BRAIN_TILE_ROUTES[s.route] ? brainPage({ open: BRAIN_TILE_ROUTES[s.route]!, onClosed: () => { if (routeFromHash() === s.route) go("brain"); } })
        : s.route === "tasks" ? tasksPage({ go, openChat })
        : s.route === "mobile" ? mobilePage()
        : s.route === "modules" ? modulesPage(s, go)
        : s.route === "brain" ? brainPage()
        : s.route === "update" ? updatePage(s)
        : settingsPage(s, chats);
      const scroll = pageHost.scrollTop;
      pageHost.replaceChildren(page);
      if (!changedRoute) { pageHost.scrollTop = scroll; settleAnimations(page); }
      if (s.route === "update") animateFlight(pageHost, s);
    };

    setUpdateRerender(() => { pageSig = ""; renderPage(app.get()); });
    const renderAvatar = () => {
      const s = app.get();
      avatar.setState({ hidden: s.chatOpen, busy: ctl.busy, unread: ctl.store.get().unread, ready: !!s.status?.assistant, attention: s.approvals.length > 0 });
    };

    const onApp = () => { const s = app.get(); renderNav(s); renderPage(s); renderAvatar(); };
    ctx.onStop(app.subscribe(onApp));
    ctx.onStop(ctl.store.subscribe(() => { renderAvatar(); menu.render(app.get()); }));
    ctx.onStop(chats.store.subscribe(() => { menu.render(app.get()); if (app.get().route === "settings") renderPage(app.get()); }));
    app.set({ route: routeFromHash() });
    onApp();

    // route entry hooks
    ctx.onStop(app.select((s) => s.route, (r) => {
      if (BRAIN_TILE_ROUTES[r] || r === "brain") void refreshMemory();
      if (r === "modules") void refreshModules();
      if (r === "update") { void refreshUpdate(); void refreshEvents(); void refreshHistory(); }
      pageHost.focus({ preventScroll: true });
    }));

    void refreshStatus(); void refreshUpdate(); void refreshEvents(); void refreshMemory(); void refreshModules(); void refreshSettings(); void refreshBrief(); void refreshSuggestions();
    ctx.onStop(app.select((s) => (s.brief?.quiet ? "q:" : "") + (s.brief?.due.map((d) => d.id).join(",") ?? ""), () => {
      const b = app.get().brief;
      if (b?.due.length) announceDue(b.due, { open: () => go("tasks"), snooze: (id, m) => void api.snoozeReminder(id, m).then((r) => {
        showToast(r.ok ? (m === "tomorrow" ? "Напомню завтра утром" : `Напомню через ${m === 60 ? "час" : m + " минут"}`) : r.error.message, { ms: 3000 });
        void refreshBrief();
      }) }, !!b.quiet);
    }));
    let tick = 0;
    const poll = setInterval(() => {
      tick++;
      const s = app.get();
      if (ctl.busy || s.approvals.length) void refreshApprovals();
      if (s.route === "update" || s.update?.phase === "downloading" || s.update?.phase === "testing") { void refreshUpdate(); void refreshEvents(); if (s.route === "update" && tick % 4 === 0) void refreshHistory(); }
      if (tick % 8 === 0) { void refreshStatus(); void refreshUpdate(); void refreshBrief(); void refreshSuggestions(); }
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
