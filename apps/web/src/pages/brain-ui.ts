import { el } from "../dom";
import { dot } from "./kit";

export const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : Math.round(v) + "%");
export const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };

export const failed = (title: string, text: string) => [el("header", { cls: "br-block-head" }, el("h2", { textContent: title })), empty(text)];
export const postJson = (path: string, body: unknown) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// ---------- small building blocks ----------
/** Page block with a title, an optional one-line hint and a body. Never nested inside another block. */
export function block(title: string, hint: string | null, ...kids: (Node | null)[]): HTMLElement {
  return el("section", { cls: "br-block" },
    el("header", { cls: "br-block-head" }, el("h2", { textContent: title }), hint ? el("p", { cls: "muted", textContent: hint }) : null),
    ...kids);
}
export function tile(label: string, value: string, sub?: string, tone?: "ok" | "warn" | "off"): HTMLElement {
  return el("div", { cls: "br-tile" },
    el("span", { cls: "br-tile-label" }, tone ? dot(tone) : null, label),
    el("strong", { cls: "br-tile-value", textContent: value }),
    sub ? el("span", { cls: "br-tile-sub muted", textContent: sub }) : null);
}
export const tag = (text: string, tone = "") => el("span", { cls: "br-tag " + tone, textContent: text });
export const note = (text: string) => el("p", { cls: "br-note muted", textContent: text });
export const empty = (text: string) => el("p", { cls: "br-empty muted", textContent: text });
export function progress(done: number, total: number, label: string): HTMLElement {
  const v = total > 0 ? Math.min(100, Math.round((100 * done) / total)) : 0;
  const bar = el("div", { cls: "br-bar", attrs: { role: "progressbar", "aria-label": label, "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(v) } },
    el("i", {}));
  (bar.firstElementChild as HTMLElement).style.width = v + "%";
  return bar;
}
export function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return el("label", { cls: "br-field" }, el("span", { textContent: label }), control, hint ? el("small", { cls: "muted", textContent: hint }) : null);
}
export function fold(summary: string, ...kids: Node[]): HTMLElement {
  return el("details", { cls: "br-fold" }, el("summary", { textContent: summary }), ...kids);
}

