import { attempt } from "@juunibi/core";
import { el } from "./dom";

const KEY = "juunibi:avatar:v1";
const SIZE = 64;
const MARGIN = 16;

interface Pos { x: number; y: number } // fractions of the free area, so the spot survives window resizes

/**
 * Floating assistant avatar: drag it anywhere on the page, tap/click (or Enter) to open the chat.
 * Arrow keys move it for keyboard users. Put your own picture at /avatar.webp (or .png/.jpg) — until then a letter is shown.
 */
export class Avatar {
  readonly root: HTMLButtonElement;
  private pos: Pos;
  private dragging = false;
  private suppressClick = false;
  private badge: HTMLElement;

  constructor(private readonly onOpen: () => void) {
    const saved = attempt(() => JSON.parse(localStorage.getItem(KEY) ?? "null") as Pos | null);
    this.pos = saved.ok && saved.value && Number.isFinite(saved.value.x) && Number.isFinite(saved.value.y)
      ? { x: clamp01(saved.value.x), y: clamp01(saved.value.y) } : { x: 1, y: 1 };
    this.badge = el("span", { cls: "fab-badge", hidden: true });
    const letter = el("span", { cls: "fab-letter", textContent: "J" });
    const img = el("img", { alt: "", cls: "fab-img", draggable: false });
    img.addEventListener("load", () => letter.remove(), { once: true });
    img.addEventListener("error", () => img.remove(), { once: true });
    img.src = "/avatar.webp";
    this.root = el("button", { type: "button", cls: "fab", title: "Открыть чат · перетащите, чтобы переместить", attrs: { "aria-label": "Открыть чат с JUUNIBI" } }, letter, img, this.badge);
    this.place();

    this.root.addEventListener("pointerdown", (e) => this.down(e));
    this.root.addEventListener("click", () => { if (this.suppressClick) { this.suppressClick = false; return; } this.onOpen(); });
    this.root.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 80 : 20;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!d) return;
      e.preventDefault();
      const r = this.root.getBoundingClientRect();
      this.setPx(r.left + d[0]!, r.top + d[1]!);
      this.save();
    });
    addEventListener("resize", () => this.place());
  }

  private area() { return { w: Math.max(1, innerWidth - SIZE - MARGIN * 2), h: Math.max(1, innerHeight - SIZE - MARGIN * 2) }; }
  private place() {
    const a = this.area();
    this.root.style.left = MARGIN + this.pos.x * a.w + "px";
    this.root.style.top = MARGIN + this.pos.y * a.h + "px";
  }
  private setPx(left: number, top: number) {
    const a = this.area();
    this.pos = { x: clamp01((left - MARGIN) / a.w), y: clamp01((top - MARGIN) / a.h) };
    this.place();
  }
  private save() { attempt(() => localStorage.setItem(KEY, JSON.stringify(this.pos))); }

  private down(e: PointerEvent) {
    if (e.button !== 0) return;
    const r = this.root.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    const sx = e.clientX, sy = e.clientY;
    this.dragging = false;
    this.root.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) => {
      if (!this.dragging && Math.hypot(m.clientX - sx, m.clientY - sy) < 6) return;
      this.dragging = true;
      this.root.classList.add("dragging");
      this.setPx(m.clientX - dx, m.clientY - dy);
    };
    const up = () => {
      this.root.removeEventListener("pointermove", move);
      this.root.removeEventListener("pointerup", up);
      this.root.removeEventListener("pointercancel", up);
      this.root.classList.remove("dragging");
      if (this.dragging) { this.suppressClick = true; this.save(); this.dragging = false; setTimeout(() => (this.suppressClick = false), 0); }
    };
    this.root.addEventListener("pointermove", move);
    this.root.addEventListener("pointerup", up);
    this.root.addEventListener("pointercancel", up);
  }

  setState(o: { hidden: boolean; busy: boolean; unread: number; ready: boolean; attention: boolean }) {
    this.root.hidden = o.hidden;
    this.root.classList.toggle("busy", o.busy);
    this.root.classList.toggle("ready", o.ready);
    this.badge.hidden = o.unread === 0 && !o.attention;
    this.badge.textContent = o.attention ? "!" : o.unread > 9 ? "9+" : String(o.unread);
    this.badge.classList.toggle("alert", o.attention);
    this.root.setAttribute("aria-label", o.attention ? "Открыть чат: требуется ваше разрешение" : o.unread ? `Открыть чат с JUUNIBI, новых ответов: ${o.unread}` : "Открыть чат с JUUNIBI");
  }
  focus() { this.root.focus(); }
  /** Centre of the avatar, used as the origin of the open animation. */
  center() { const r = this.root.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
}
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
