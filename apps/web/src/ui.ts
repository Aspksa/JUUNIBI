/** Typed component factories: the only place that knows the class names of the design system. */
import { el, icon, type IconName } from "./dom";

export type Tone = "ok" | "warn" | "danger" | "info";
export type Variant = "default" | "primary" | "danger" | "ghost";

export interface ButtonOpts { label?: string; icon?: IconName; variant?: Variant; size?: "md" | "sm"; disabled?: boolean; type?: "button" | "submit"; title?: string; onClick?: (e: MouseEvent) => void }
export function button(o: ButtonOpts): HTMLButtonElement {
  const cls = ["btn", o.variant && o.variant !== "default" ? o.variant : "", o.size === "sm" ? "sm" : ""].filter(Boolean).join(" ");
  const b = el("button", { type: o.type ?? "button", cls, disabled: !!o.disabled, ...(o.title ? { title: o.title } : {}) }, o.icon ? icon(o.icon, 16) : null, o.label ?? null);
  if (o.onClick) b.addEventListener("click", o.onClick);
  return b;
}
export const tag = (text: string, tone?: Tone) => el("span", { cls: "tag" + (tone ? " " + tone : ""), textContent: text });
export const badge = (text: string, tone?: "danger") => el("span", { cls: "badge" + (tone ? " " + tone : ""), textContent: text });

export function alert(o: { tone?: Tone; text: string; action?: HTMLElement }): HTMLElement {
  const ic: IconName = o.tone === "ok" ? "check" : "alert";
  return el("div", { cls: "alert" + (o.tone ? " " + o.tone : ""), attrs: { role: o.tone === "danger" ? "alert" : "status" } }, icon(ic, 18), el("div", { cls: "grow", textContent: o.text }), o.action ?? null);
}

export function field(o: { id: string; label: string; control: HTMLElement; hint?: string }): HTMLElement {
  o.control.id = o.id;
  return el("div", { cls: "field" }, el("label", { htmlFor: o.id, textContent: o.label }), o.control, o.hint ? el("span", { cls: "hint", textContent: o.hint }) : null);
}
export function input(o: { type?: string; placeholder?: string; value?: string; autocomplete?: string; required?: boolean; name?: string } = {}): HTMLInputElement {
  return el("input", { type: o.type ?? "text", placeholder: o.placeholder ?? "", value: o.value ?? "", autocomplete: o.autocomplete ?? "off", required: !!o.required, spellcheck: false, ...(o.name ? { name: o.name } : {}) });
}
export function switchField(o: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }): HTMLElement {
  const i = el("input", { type: "checkbox", id: o.id, checked: o.checked, attrs: { role: "switch" } });
  i.addEventListener("change", () => o.onChange(i.checked));
  return el("label", { cls: "switch", htmlFor: o.id }, i, el("span", { textContent: o.label }));
}
export function segmented<T extends string>(o: { label: string; options: readonly (readonly [T, string])[]; value: T; onChange: (v: T) => void }): HTMLElement {
  return el("div", { cls: "segmented", attrs: { role: "radiogroup", "aria-label": o.label } }, ...o.options.map(([v, text]) => {
    const b = el("button", { type: "button", textContent: text, attrs: { role: "radio", "aria-checked": String(o.value === v) } });
    b.addEventListener("click", () => o.onChange(v));
    return b;
  }));
}
export const panel = (title: string | null, ...kids: (Node | string | null)[]) => el("section", { cls: "panel" }, title ? el("h2", { textContent: title }) : null, ...kids);
