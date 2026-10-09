import { el, icon, iconButton, type IconName } from "../dom";

export interface SheetOpts {
  title: string; icon: IconName; sub?: string;
  /** Colours the icon like the tiles do: ok = green, warn = amber, bad = red, off = grey. */
  tone?: "ok" | "warn" | "bad" | "off";
  content: Node;
  onClose?: () => void;
}
export interface Sheet { close(): void; setContent(node: Node): void; readonly open: boolean }
const TONE_CLASS = { ok: "started", warn: "pending", bad: "failed", off: "stopped" } as const;
let current: Sheet | null = null;

/**
 * A window opened in the middle of the screen over a dimmed page. Esc, the cross and a click outside close it;
 * focus goes back to what opened it. Only one is open at a time.
 */
export function openSheet(o: SheetOpts): Sheet {
  current?.close();
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const body = el("div", { cls: "bk-body" }, o.content);
  const closeBtn = iconButton("x", "Закрыть", () => sheet.close(), "icon-btn");
  const panel = el("div", { cls: `mod-sheet bk-sheet ${TONE_CLASS[o.tone ?? "ok"]}`, attrs: { role: "dialog", "aria-modal": "true", "aria-label": o.title } },
    el("header", { cls: "ms-head" },
      el("span", { cls: "mt-ic big" }, icon(o.icon, 28)),
      el("div", { cls: "ms-title" }, el("strong", { textContent: o.title }), o.sub ? el("span", { cls: "muted small", textContent: o.sub }) : null),
      closeBtn),
    body);
  const overlay = el("div", { cls: "mod-modal" }, panel);
  let open = true;
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); sheet.close(); } };
  const sheet: Sheet = {
    get open() { return open; },
    setContent(node) { body.replaceChildren(node); },
    close() {
      if (!open) return;
      open = false;
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      if (current === sheet) current = null;
      if (opener?.isConnected) opener.focus();
      o.onClose?.();
    },
  };
  overlay.addEventListener("click", (e) => { if (e.target === overlay) sheet.close(); });
  document.addEventListener("keydown", onKey, true);
  document.body.append(overlay);
  closeBtn.focus();
  current = sheet;
  return sheet;
}
