/** Small shared building blocks for the pages (header, buttons, chips, empty states). */
import { el, icon, type IconName } from "../dom";

export function pageHead(ic: IconName, title: string, lead?: string, right?: Node | null): HTMLElement {
  return el("header", { cls: "pg-head" }, el("span", { cls: "pg-head-icon" }, icon(ic, 22)),
    el("div", { cls: "pg-head-text" }, el("h1", { textContent: title }), lead ? el("p", { cls: "muted", textContent: lead }) : null), right ?? null);
}
export interface BtnOpts { primary?: boolean; danger?: boolean; icon?: IconName; disabled?: boolean; small?: boolean; title?: string }
export function btn(label: string, run: (e: MouseEvent) => void, o: BtnOpts = {}): HTMLButtonElement {
  const b = el("button", { type: "button", cls: ["btn", o.primary ? "primary" : "", o.danger ? "danger" : "", o.small ? "sm" : ""].filter(Boolean).join(" "), disabled: !!o.disabled, ...(o.title ? { title: o.title } : {}) }, o.icon ? icon(o.icon, 16) : null, label);
  b.addEventListener("click", run);
  return b;
}
export function chip(label: string, count: number | null, pressed: boolean, run: () => void): HTMLButtonElement {
  const b = el("button", { type: "button", cls: "chip", attrs: { "aria-pressed": String(pressed) } }, label, count !== null ? el("span", { cls: "n", textContent: String(count) }) : null);
  b.addEventListener("click", run);
  return b;
}
export function emptyState(ic: IconName, title: string, text: string, action?: Node | null): HTMLElement {
  return el("div", { cls: "empty-state" }, el("span", { cls: "empty-icon" }, icon(ic, 26)), el("strong", { textContent: title }), el("p", { cls: "muted", textContent: text }), action ?? null);
}
export const dot = (tone: "ok" | "warn" | "bad" | "off") => el("i", { cls: `sdot ${tone}`, attrs: { "aria-hidden": "true" } });
export const section = (title: string, ...kids: (Node | null)[]) => el("section", { cls: "pg-card" }, el("h2", { textContent: title }), ...kids);
