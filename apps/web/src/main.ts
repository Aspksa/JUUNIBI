import { Kernel, Logger, Store, attempt } from "@juunibi/core";
import "./style.css";

type Filter = "all" | "active" | "done";
interface Item { id: string; text: string; done: boolean }
interface State { items: Item[]; filter: Filter; theme: "auto" | "light" | "dark" }
type Events = { "item:added": Item };

const KEY = "juunibi:v1";

function load(): State {
  const fallback: State = { items: [], filter: "all", theme: "auto" };
  const raw = attempt(() => localStorage.getItem(KEY));
  if (!raw.ok || !raw.value) return fallback;
  const parsed = attempt(() => JSON.parse(raw.value as string) as Partial<State>);
  if (!parsed.ok || typeof parsed.value !== "object" || parsed.value === null) return fallback;
  const p = parsed.value;
  const items = Array.isArray(p.items)
    ? p.items.filter((i): i is Item => !!i && typeof i.id === "string" && typeof i.text === "string" && typeof i.done === "boolean")
    : [];
  const theme = p.theme === "light" || p.theme === "dark" ? p.theme : "auto";
  const filter = p.filter === "active" || p.filter === "done" ? p.filter : "all";
  return { items, filter, theme };
}

const store = new Store<State>(load());
const kernel = new Kernel<Events>(new Logger("web", "info"));

kernel.register({
  name: "persist",
  start(ctx) {
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = store.subscribe((s) => {
      clearTimeout(t);
      t = setTimeout(() => {
        const r = attempt(() => localStorage.setItem(KEY, JSON.stringify(s)));
        if (!r.ok) ctx.log.warn("не удалось сохранить", r.error);
      }, 150);
    });
    ctx.onStop(() => { off(); clearTimeout(t); });
  },
});

kernel.register({
  name: "theme",
  start(ctx) {
    const apply = (theme: State["theme"]) => {
      if (theme === "auto") document.documentElement.removeAttribute("data-theme");
      else document.documentElement.dataset.theme = theme;
    };
    apply(store.get().theme);
    ctx.onStop(store.select((s) => s.theme, apply));
  },
});

kernel.register({
  name: "ui",
  deps: ["persist", "theme"],
  start(ctx) {
    const root = document.getElementById("app");
    if (!root) throw new Error("#app not found");
    root.innerHTML = `
      <div class="wrap">
        <header><h1>JUUNIBI</h1><button class="ghost" id="theme" type="button"></button></header>
        <main class="card">
          <form id="add"><label class="sr" for="new">Новая задача</label>
            <input id="new" type="text" maxlength="200" placeholder="Что нужно сделать?" autocomplete="off" required />
            <button class="primary" type="submit">Добавить</button></form>
          <div class="filters" role="group" aria-label="Фильтр"></div>
          <ul id="list"></ul>
          <p class="status" id="status" aria-live="polite"></p>
        </main>
      </div>`;
    const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
    const list = $<HTMLUListElement>("#list");
    const status = $("#status");
    const filters = $(".filters");
    const labels: Record<Filter, string> = { all: "Все", active: "Активные", done: "Готово" };
    const themeNames = { auto: "Тема: авто", light: "Тема: светлая", dark: "Тема: тёмная" };

    const render = () => {
      const { items, filter, theme } = store.get();
      const shown = items.filter((i) => filter === "all" || (filter === "done") === i.done);
      list.replaceChildren(
        ...shown.map((i) => {
          const li = document.createElement("li");
          li.className = i.done ? "done" : "";
          li.dataset.id = i.id;
          const cb = document.createElement("input");
          cb.type = "checkbox"; cb.checked = i.done; cb.id = `c-${i.id}`;
          const lb = document.createElement("label");
          lb.htmlFor = cb.id; lb.textContent = i.text;
          const del = document.createElement("button");
          del.type = "button"; del.className = "ghost"; del.dataset.del = i.id;
          del.textContent = "✕"; del.setAttribute("aria-label", `Удалить: ${i.text}`);
          li.append(cb, lb, del);
          return li;
        }),
      );
      if (!shown.length) {
        const p = document.createElement("li");
        p.className = "empty"; p.textContent = "Пока пусто";
        list.append(p);
      }
      filters.replaceChildren(
        ...(Object.keys(labels) as Filter[]).map((f) => {
          const b = document.createElement("button");
          b.type = "button"; b.dataset.filter = f; b.textContent = labels[f];
          b.setAttribute("aria-pressed", String(f === filter));
          return b;
        }),
      );
      const left = items.filter((i) => !i.done).length;
      status.textContent = `Осталось: ${left} из ${items.length}`;
      $("#theme").textContent = themeNames[theme];
    };

    const onSubmit = (e: Event) => {
      e.preventDefault();
      const input = $<HTMLInputElement>("#new");
      const text = input.value.trim();
      if (!text) return;
      const item: Item = { id: crypto.randomUUID(), text, done: false };
      store.set((s) => ({ items: [item, ...s.items] }));
      ctx.bus.emit("item:added", item);
      input.value = "";
      input.focus();
    };
    const onChange = (e: Event) => {
      const id = (e.target as HTMLElement).closest("li")?.dataset.id;
      const cb = e.target as HTMLInputElement;
      if (id && cb.type === "checkbox") store.set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, done: cb.checked } : i)) }));
    };
    const onClick = (e: Event) => {
      const t = (e.target as HTMLElement).closest("button");
      if (!t) return;
      if (t.dataset.del) store.set((s) => ({ items: s.items.filter((i) => i.id !== t.dataset.del) }));
      else if (t.dataset.filter) store.set({ filter: t.dataset.filter as Filter });
      else if (t.id === "theme") {
        const next = { auto: "light", light: "dark", dark: "auto" } as const;
        store.set((s) => ({ theme: next[s.theme] }));
      }
    };
    $("#add").addEventListener("submit", onSubmit);
    root.addEventListener("change", onChange);
    root.addEventListener("click", onClick);
    const off = store.subscribe(render);
    render();
    ctx.onStop(() => {
      off();
      root.removeEventListener("change", onChange);
      root.removeEventListener("click", onClick);
      root.replaceChildren();
    });
  },
});

kernel.bus.on("plugin:failed", ({ name, error }) => {
  document.body.insertAdjacentHTML("afterbegin", `<p role="alert" style="color:#c62828;padding:8px">Ошибка модуля ${name}: ${error.message}</p>`);
});

window.addEventListener("error", (e) => kernel.log.error("uncaught", e.error));
window.addEventListener("unhandledrejection", (e) => kernel.log.error("unhandled rejection", e.reason));
void kernel.start();
