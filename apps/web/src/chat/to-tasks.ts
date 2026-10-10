/** «В дела» under a chat message: the selected words (or the first sentence) become a to-do or a reminder. */
import { api } from "../api";
import { el, icon, iconButton } from "../dom";
import { refreshBrief } from "../state";
import { showToast } from "../toast";
import { findPromise, parseQuick, taskTextFrom } from "../pages/quick-entry";
import { describeQuick, saveQuick, savedText } from "../pages/tasks";

export function toTasksButton(content: string, host: () => HTMLElement | null): HTMLButtonElement {
  return iconButton("list", "В дела: выделенное или первое предложение", async () => {
    const s = window.getSelection();
    const root = host();
    const inside = s && root && !s.isCollapsed && s.anchorNode && root.contains(s.anchorNode) ? s.toString() : "";
    const text = taskTextFrom(content, inside);
    if (!text) { showToast("Нечего добавить: выделите текст в сообщении."); return; }
    const p = parseQuick(text, new Date(), "auto");
    const r = await saveQuick(p.kind === "note" ? { ...p, kind: "todo" } : p);
    if (!r.ok) { showToast(r.error.message, { ms: 8000 }); return; }
    const id = r.value.id;
    void refreshBrief();
    showToast(savedText(p.kind === "note" ? { ...p, kind: "todo" } : p) + ": «" + p.text.slice(0, 60) + "»", { ms: 6000, action: { label: "Отменить", run: () => {
      void (p.kind === "reminder" ? api.removeReminder(id) : api.removeNote(id)).then(() => refreshBrief());
    } } });
  }, "icon-btn sm");
}

/** «Обещания из чата» is on (Автоматика → День); asked once and again after five minutes. */
let promises: { at: number; on: Promise<boolean> } | null = null;
function promisesOn(): Promise<boolean> {
  if (!promises || Date.now() - promises.at > 5 * 60_000) promises = { at: Date.now(), on: api.automation().then((r) => r.ok && r.value.chatPromises, () => false) };
  return promises.on;
}
const HANDLED = "juunibi.chat.promises";
const handled = (): string[] => { try { return JSON.parse(localStorage.getItem(HANDLED) ?? "[]") as string[]; } catch { return []; } };
const markHandled = (id: string) => { try { localStorage.setItem(HANDLED, JSON.stringify([...handled(), id].slice(-200))); } catch { /* private mode */ } };

/**
 * Under the owner's own message with a promise and a date («завтра надо позвонить маме»): a card «Добавить в дела?».
 * Only for fresh messages, once per message, and only when the setting is on.
 */
export function promiseCard(msgId: string, content: string, at: number): HTMLElement | null {
  if (Date.now() - at > 24 * 3_600_000 || handled().includes(msgId)) return null;
  const p = findPromise(content, new Date(at));
  if (!p) return null;
  // the setting comes from the server: an empty slot now, the card once it says yes
  const slot = el("div", { cls: "promise-slot" });
  void promisesOn().then((on) => { if (on) slot.replaceWith(buildCard(msgId, p)); else slot.remove(); });
  return slot;
}
function buildCard(msgId: string, p: ReturnType<typeof findPromise> & object): HTMLElement {
  const card = el("div", { cls: "promise-card", attrs: { role: "group", "aria-label": "Добавить в дела" } },
    icon("list", 16), el("span", { cls: "grow" }, el("b", { textContent: "В дела? " }), el("span", { textContent: "«" + p.text + "» · " + describeQuick(p).split(" · ").slice(1).join(" · ") })));
  const add = el("button", { type: "button", cls: "btn sm primary", textContent: "Добавить" });
  add.addEventListener("click", async () => {
    add.disabled = true;
    const r = await saveQuick(p);
    if (!r.ok) { add.disabled = false; showToast(r.error.message, { ms: 8000 }); return; }
    markHandled(msgId); card.remove(); void refreshBrief();
    showToast(savedText(p) + ": «" + p.text.slice(0, 60) + "»", { ms: 6000, action: { label: "Отменить", run: () => { void api.removeNote(r.value.id).then(() => refreshBrief()); } } });
  });
  card.append(add, iconButton("x", "Не нужно", () => { markHandled(msgId); card.remove(); }, "icon-btn sm"));
  return card;
}
