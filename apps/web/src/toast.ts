import { el } from "./dom";

/** A small message in the corner. It goes away by itself and never steals focus. */
export function showToast(text: string, opts: { action?: { label: string; run: () => void }; ms?: number } = {}): void {
  let host = document.querySelector<HTMLElement>(".toasts");
  if (!host) { host = el("div", { cls: "toasts", attrs: { role: "status", "aria-live": "polite" } }); document.body.append(host); }
  const t = el("div", { cls: "toast" }, el("span", { textContent: text }));
  if (opts.action) {
    const b = el("button", { type: "button", cls: "btn sm", textContent: opts.action.label });
    b.addEventListener("click", () => { opts.action!.run(); t.remove(); });
    t.append(b);
  }
  host.append(t);
  setTimeout(() => t.remove(), opts.ms ?? 8000);
}
