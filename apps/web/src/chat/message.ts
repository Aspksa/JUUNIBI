import { el, icon, iconButton } from "../dom";
import { characterAvatar } from "./art";
import { renderMarkdownInto } from "../markdown";
import type { ChatMsg, Step } from "./chats";
import type { ChatController } from "./controller";
import { formatBytes, stepLabel } from "./helpers";
import { speechSupported } from "./voice";

export interface MsgCtx {
  convId: string; streaming: boolean; isLast: boolean; busy: boolean; editing: boolean; speaking: boolean;
  ctl: ChatController;
  onEdit(id: string): void; onCancelEdit(): void; onSaveEdit(id: string, text: string): void;
  onRemember(text: string): void; onSpeak(m: ChatMsg): void;
}

const time = (ts: number) => new Date(ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
const STEP_ICON: Record<Step["status"], string> = { running: "", ok: "✓", error: "✕", denied: "⊘" };
const STEP_TITLE: Record<Step["status"], string> = { running: "выполняется", ok: "готово", error: "ошибка", denied: "отклонено" };

/** Signature of everything that changes how a message looks; rows are rebuilt only when it changes. */
export function msgSignature(m: ChatMsg, c: Pick<MsgCtx, "streaming" | "isLast" | "busy" | "editing" | "speaking">): string {
  return [m.content.length, m.rating, m.error, m.stopped, m.turnId, m.scene?.action, m.steps?.map((s) => s.status).join(), m.memoryUsed?.length, m.files?.length,
    c.streaming, c.isLast, c.busy, c.editing, c.speaking].join("|");
}

export function fillMessage(root: HTMLElement, m: ChatMsg, c: MsgCtx) {
  root.dataset.role = m.role;
  if (m.role === "assistant") { fillAssistant(root, m, c); return; }
  root.replaceChildren();
  if (m.role === "note") { root.append(el("p", { cls: "note-row", textContent: m.content })); return; }
  fillUser(root, m, c);
}

function copyButton(text: string): HTMLButtonElement {
  const b = iconButton("copy", "Копировать", async () => {
    try { await navigator.clipboard.writeText(text); b.replaceChildren(icon("check", 16)); setTimeout(() => b.replaceChildren(icon("copy", 16)), 1500); } catch { b.title = "Не удалось скопировать"; }
  }, "icon-btn sm");
  return b;
}

function fillUser(root: HTMLElement, m: ChatMsg, c: MsgCtx) {
  if (c.editing) {
    const ta = el("textarea", { value: m.content, cls: "edit-input", rows: 3, maxLength: 100000, attrs: { "aria-label": "Редактирование сообщения" } });
    const cancel = el("button", { type: "button", cls: "btn", textContent: "Отмена" });
    const save = el("button", { type: "button", cls: "btn primary", textContent: "Отправить" });
    cancel.addEventListener("click", () => c.onCancelEdit());
    save.addEventListener("click", () => c.onSaveEdit(m.id, ta.value));
    ta.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel.click(); } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save.click(); });
    root.append(el("div", { cls: "edit-box" }, ta, el("div", { cls: "row" }, cancel, save)));
    queueMicrotask(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); });
    return;
  }
  if (m.files?.length) root.append(el("div", { cls: "msg-files" }, ...m.files.map((f) => el("span", { cls: "file-chip", title: f.name }, icon("file", 14), el("span", { cls: "file-name", textContent: f.name }), el("span", { cls: "muted", textContent: formatBytes(f.size) })))));
  if (m.content) root.append(el("div", { cls: "bubble", textContent: m.content }));
  const actions = el("div", { cls: "msg-actions" }, el("span", { cls: "msg-time", textContent: time(m.at) }), copyButton(m.content));
  if (!c.busy) actions.append(iconButton("edit", "Изменить сообщение", () => c.onEdit(m.id), "icon-btn sm"));
  if (m.content.trim()) actions.append(iconButton("memory", "Запомнить это", () => c.onRemember(m.content), "icon-btn sm"));
  root.append(actions);
}

function stepsBlock(steps: Step[]): HTMLElement {
  const running = steps.some((s) => s.status === "running");
  const d = el("details", { cls: "steps" + (running ? " running" : ""), open: running },
    el("summary", {}, running ? el("i", { cls: "spin" }) : icon("check", 14), el("span", { textContent: running ? stepLabel(steps.find((s) => s.status === "running")!.name) + "…" : `Шагов выполнено: ${steps.length}` })));
  for (const s of steps) {
    d.append(el("div", { cls: `step ${s.status}` },
      s.status === "running" ? el("i", { cls: "spin" }) : el("span", { cls: "step-icon", textContent: STEP_ICON[s.status], attrs: { "aria-label": STEP_TITLE[s.status] } }),
      el("span", { cls: "grow", textContent: stepLabel(s.name) }), el("span", { cls: "muted", textContent: s.ms !== undefined ? (s.ms < 1000 ? `${s.ms} мс` : `${(s.ms / 1000).toFixed(1)} с`) : "" })));
  }
  return d;
}

interface AssistantParts { scene: HTMLElement; steps: HTMLElement; prose: HTMLElement; typing: HTMLElement; extras: HTMLElement; actions: HTMLElement; sig: Record<string, string> }
const PARTS = new WeakMap<HTMLElement, AssistantParts>();

/** Assistant rows are patched in place (not rebuilt), so text selection and the streaming caret stay stable. */
function partsFor(root: HTMLElement): AssistantParts {
  let p = PARTS.get(root);
  if (p) return p;
  const slot = (cls: string) => el("div", { cls: `slot ${cls}` });
  p = { scene: slot("slot-scene"), steps: slot("slot-steps"), prose: el("div", { cls: "prose" }), typing: slot("slot-typing"), extras: slot("slot-extras"), actions: slot("slot-actions"), sig: {} };
  root.replaceChildren(characterAvatar(32, "msg-av"), el("div", { cls: "msg-body" }, p.scene, p.steps, p.prose, p.typing, p.extras, p.actions));
  PARTS.set(root, p);
  return p;
}
const patch = (p: AssistantParts, key: string, sig: string, slot: HTMLElement, build: () => Node[]) => { if (p.sig[key] !== sig) { p.sig[key] = sig; slot.replaceChildren(...build()); } };

function fillAssistant(root: HTMLElement, m: ChatMsg, c: MsgCtx) {
  const p = partsFor(root);
  patch(p, "scene", m.scene ? m.scene.action + "|" + (m.scene.phrase ?? "") : "", p.scene, () => m.scene
    ? [el("div", { cls: "scene" }, el("em", { textContent: m.scene.action }), ...(m.scene.phrase ? [el("p", { textContent: "«" + m.scene.phrase + "»" })] : []))] : []);
  patch(p, "steps", JSON.stringify(m.steps ?? []), p.steps, () => (m.steps?.length ? [stepsBlock(m.steps)] : []));

  p.prose.classList.toggle("streaming", c.streaming);
  renderMarkdownInto(p.prose, m.content, !c.streaming);
  const waiting = c.streaming && !m.content && !m.steps?.some((s) => s.status === "running");
  patch(p, "typing", String(waiting), p.typing, () => (waiting ? [el("span", { cls: "typing", attrs: { "aria-label": "JUUNIBI печатает" } }, el("i"), el("i"), el("i"))] : []));

  patch(p, "extras", JSON.stringify([m.stopped, m.error, c.isLast, c.busy, m.memoryUsed]), p.extras, () => {
    const out: Node[] = [];
    if (m.stopped) out.push(el("p", { cls: "note", textContent: "Генерация остановлена." }));
    if (m.error && !m.stopped) {
      const retry = el("button", { type: "button", cls: "btn", textContent: "Повторить" });
      retry.addEventListener("click", () => { void c.ctl.regenerate(c.convId); });
      out.push(el("div", { cls: "error-box", attrs: { role: "alert" } }, icon("alert", 16), el("span", { textContent: m.error }), c.isLast && !c.busy ? retry : null));
    }
    if (m.memoryUsed?.length) {
      out.push(el("details", { cls: "mem-used" }, el("summary", {}, icon("memory", 14), el("span", { textContent: `Использована память · ${m.memoryUsed.length}` })),
        el("ul", {}, ...m.memoryUsed.map((t) => el("li", { textContent: t })))));
    }
    return out;
  });

  patch(p, "actions", JSON.stringify([c.streaming, m.content.length, m.turnId, m.rating, c.isLast, c.busy, c.speaking, m.at]), p.actions, () => {
    if (c.streaming) return [];
    const actions = el("div", { cls: "msg-actions" }, el("span", { cls: "msg-time", textContent: time(m.at) }));
    if (m.content) {
      actions.append(copyButton(m.content));
      if (m.turnId) for (const [name, label, r] of [["up", "Хороший ответ", 1], ["down", "Плохой ответ", -1]] as const) {
        const b = iconButton(name, label, () => void c.ctl.rate(c.convId, m, r), "icon-btn sm");
        b.setAttribute("aria-pressed", String(m.rating === r));
        actions.append(b);
      }
      if (speechSupported()) {
        const b = iconButton("volume", c.speaking ? "Остановить озвучку" : "Озвучить", () => c.onSpeak(m), "icon-btn sm");
        b.setAttribute("aria-pressed", String(c.speaking));
        actions.append(b);
      }
    }
    if (c.isLast && !c.busy) actions.append(iconButton("refresh", "Сгенерировать заново", () => void c.ctl.regenerate(c.convId), "icon-btn sm"));
    return actions.childElementCount > 1 ? [actions] : [];
  });
}
