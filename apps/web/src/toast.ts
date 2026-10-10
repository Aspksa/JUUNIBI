import { el } from "./dom";

/** A small message in the corner. It goes away by itself and never steals focus. */
export function showToast(text: string, opts: { action?: { label: string; run: () => void }; actions?: { label: string; run: () => void }[]; ms?: number } = {}): void {
  let host = document.querySelector<HTMLElement>(".toasts");
  if (!host) { host = el("div", { cls: "toasts", attrs: { role: "status", "aria-live": "polite" } }); document.body.append(host); }
  const t = el("div", { cls: "toast" }, el("span", { textContent: text }));
  const actions = [...(opts.action ? [opts.action] : []), ...(opts.actions ?? [])];
  // several buttons (a reminder: «10 мин», «1 ч», «Завтра») go on their own line under the text
  const row = actions.length > 1 ? el("div", { cls: "toast-actions" }) : t;
  for (const a of actions) {
    const b = el("button", { type: "button", cls: "btn sm", textContent: a.label });
    b.addEventListener("click", () => { a.run(); t.remove(); });
    row.append(b);
  }
  if (row !== t) { t.classList.add("multi"); t.append(row); }
  host.append(t);
  setTimeout(() => t.remove(), opts.ms ?? 8000);
}
