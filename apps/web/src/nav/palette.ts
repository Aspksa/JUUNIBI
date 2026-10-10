/**
 * Ctrl+K: one window to find a chat, a to-do or a memory entry, open any section or run a command.
 * Arrow keys pick, Enter runs, Esc closes; focus goes back to where it was.
 */
import { el, icon } from "../dom";
import { KIND_LABEL, searchPalette, type PaletteEntry } from "./model";

let openNow: (() => void) | null = null;

export function paletteOpen(): boolean { return openNow !== null; }
export function closePalette() { openNow?.(); }

/** `base` is ready at once; `more` (to-dos and notes from the server) is added when it arrives. */
export function openPalette(base: PaletteEntry[], more?: Promise<PaletteEntry[]>) {
  if (openNow) { openNow(); return; }
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  let entries = base;
  let shown: PaletteEntry[] = [];
  let active = 0;

  const input = el("input", { type: "text", cls: "pal-input", placeholder: "Найти беседу, дело, запись памяти или команду…", autocomplete: "off", spellcheck: false,
    attrs: { role: "combobox", "aria-expanded": "true", "aria-controls": "pal-list", "aria-autocomplete": "list", "aria-label": "Поиск и команды" } });
  const list = el("ul", { cls: "pal-list", id: "pal-list", attrs: { role: "listbox", "aria-label": "Результаты" } });
  const status = el("p", { cls: "sr-only", attrs: { "aria-live": "polite" } });
  const panel = el("div", { cls: "pal", attrs: { role: "dialog", "aria-modal": "true", "aria-label": "Поиск и команды" } },
    el("div", { cls: "pal-head" }, icon("search", 18), input, el("kbd", { cls: "kbd", textContent: "Esc" })),
    list, status,
    el("div", { cls: "pal-foot muted small" }, el("span", {}, el("kbd", { cls: "kbd", textContent: "↑" }), el("kbd", { cls: "kbd", textContent: "↓" }), " выбрать"), el("span", {}, el("kbd", { cls: "kbd", textContent: "Enter" }), " открыть"), el("span", {}, el("kbd", { cls: "kbd", textContent: "Ctrl" }), "+", el("kbd", { cls: "kbd", textContent: "K" }), " в любом месте")));
  const overlay = el("div", { cls: "pal-overlay" }, panel);

  const close = () => {
    if (!openNow) return;
    openNow = null;
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
    if (opener?.isConnected) opener.focus();
  };
  const run = (e: PaletteEntry | undefined) => { if (!e) return; close(); e.run(); };
  const mark = () => {
    list.querySelectorAll<HTMLElement>("[role=option]").forEach((li, i) => {
      li.setAttribute("aria-selected", String(i === active));
      if (i === active) { input.setAttribute("aria-activedescendant", li.id); li.scrollIntoView({ block: "nearest" }); }
    });
  };
  const draw = () => {
    shown = searchPalette(entries, input.value);
    active = Math.min(active, Math.max(0, shown.length - 1));
    // grouped under a heading per kind, in the order the best match of each kind came
    const kinds = [...new Set(shown.map((e) => e.kind))];
    const ordered = kinds.flatMap((k) => shown.filter((e) => e.kind === k));
    shown = ordered;
    let n = 0;
    list.replaceChildren(...kinds.flatMap((k) => [
      el("li", { cls: "pal-group", textContent: KIND_LABEL[k], attrs: { role: "presentation" } }),
      ...ordered.filter((e) => e.kind === k).map((e) => {
        const i = n++;
        const li = el("li", { cls: "pal-item", id: "pal-o" + i, attrs: { role: "option", "aria-selected": "false" } },
          el("span", { cls: "pal-ic" }, icon(e.icon, 16)),
          el("span", { cls: "pal-text" }, el("span", { cls: "pal-title", textContent: e.title }), e.sub ? el("span", { cls: "pal-sub muted", textContent: e.sub }) : null),
          e.keys ? el("kbd", { cls: "kbd", textContent: e.keys }) : null);
        li.addEventListener("mousemove", () => { if (active !== i) { active = i; mark(); } });
        li.addEventListener("click", () => run(shown[i]));
        return li;
      }),
    ]));
    if (!shown.length) list.append(el("li", { cls: "pal-empty muted", textContent: "Ничего не нашлось. Enter — спросить в беседе.", attrs: { role: "presentation" } }));
    status.textContent = input.value.trim() ? (shown.length ? `Найдено: ${shown.length}` : "Ничего не нашлось") : "";
    mark();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (shown.length) { active = (active + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length; mark(); } }
    else if (e.key === "Enter" && document.activeElement === input) {
      e.preventDefault();
      if (shown.length) run(shown[active]);
      else if (input.value.trim() && askFallback) { const q = input.value.trim(); close(); askFallback(q); }
    } else if (e.key === "Tab") { e.preventDefault(); input.focus(); }
  };
  input.addEventListener("input", () => { active = 0; draw(); });
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey, true);
  document.body.append(overlay);
  openNow = close;
  draw();
  input.focus();
  void more?.then((extra) => { if (openNow === close && extra.length) { entries = [...entries, ...extra]; draw(); } });
}

/** What Enter does when nothing matched: ask the assistant in the chat. Set by the menu. */
let askFallback: ((text: string) => void) | null = null;
export function setPaletteFallback(fn: (text: string) => void) { askFallback = fn; }
