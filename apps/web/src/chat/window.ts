import { attempt } from "@juunibi/core";
import { clampRect, resizeRect, type Rect } from "./helpers";

const KEY = "juunibi:chatwin:v1";
const DIRS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const;
const MOBILE = 760;

/** Makes the chat window movable (drag the header) and resizable (edges/corners), and remembers its place. */
export class WindowFrame {
  private rect: Rect;
  constructor(private readonly win: HTMLElement, private readonly head: HTMLElement, private readonly onToggleMax: () => void) {
    const saved = attempt(() => JSON.parse(localStorage.getItem(KEY) ?? "null") as Rect | null);
    this.rect = saved.ok && saved.value && [saved.value.x, saved.value.y, saved.value.w, saved.value.h].every(Number.isFinite) ? saved.value : this.defaultRect();
    for (const d of DIRS) {
      const h = document.createElement("div");
      h.className = `rz rz-${d}`; h.dataset.dir = d; h.setAttribute("aria-hidden", "true");
      h.addEventListener("pointerdown", (e) => this.startResize(e, d));
      win.append(h);
    }
    head.addEventListener("pointerdown", (e) => this.startMove(e));
    head.addEventListener("dblclick", (e) => { if (!(e.target as HTMLElement).closest("button,input,textarea")) this.onToggleMax(); });
    addEventListener("resize", () => this.apply());
    this.apply();
  }
  private vw() { return document.documentElement.clientWidth; }
  private vh() { return document.documentElement.clientHeight; }
  private defaultRect(): Rect {
    const w = Math.min(1040, this.vw() - 48), h = Math.min(760, this.vh() - 48);
    return { w, h, x: this.vw() - w - 24, y: this.vh() - h - 24 };
  }
  /** Places the window; on phones and when maximized CSS takes over (inline geometry is ignored via !important rules). */
  apply() {
    this.rect = clampRect(this.rect, this.vw(), this.vh());
    const s = this.win.style;
    s.left = this.rect.x + "px"; s.top = this.rect.y + "px"; s.width = this.rect.w + "px"; s.height = this.rect.h + "px";
  }
  reset() { this.rect = this.defaultRect(); this.apply(); this.save(); }
  private free() { return this.vw() > MOBILE && !this.win.classList.contains("max"); }
  private save() { attempt(() => localStorage.setItem(KEY, JSON.stringify(this.rect))); }

  private drag(e: PointerEvent, update: (dx: number, dy: number, start: Rect) => Rect, cursor: string) {
    const start = { ...this.rect }, sx = e.clientX, sy = e.clientY;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    this.win.classList.add("moving"); document.body.style.cursor = cursor; document.body.style.userSelect = "none";
    const move = (m: PointerEvent) => { this.rect = update(m.clientX - sx, m.clientY - sy, start); this.apply(); };
    const up = () => {
      target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", up); target.removeEventListener("pointercancel", up);
      this.win.classList.remove("moving"); document.body.style.cursor = ""; document.body.style.userSelect = "";
      this.save();
    };
    target.addEventListener("pointermove", move); target.addEventListener("pointerup", up); target.addEventListener("pointercancel", up);
  }
  private startMove(e: PointerEvent) {
    if (e.button !== 0 || !this.free() || (e.target as HTMLElement).closest("button,input,textarea,a")) return;
    this.drag(e, (dx, dy, s) => ({ ...s, x: s.x + dx, y: s.y + dy }), "move");
  }
  private startResize(e: PointerEvent, dir: string) {
    if (e.button !== 0 || !this.free()) return;
    e.preventDefault();
    this.drag(e, (dx, dy, s) => resizeRect(s, dir, dx, dy, this.vw(), this.vh()), getComputedStyle(e.currentTarget as HTMLElement).cursor);
  }
}
