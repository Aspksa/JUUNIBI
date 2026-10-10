import { characterAvatar, greeting } from "../chat/art";
import type { Chats } from "../chat/chats";
import { previewOf, relTime } from "../chat/helpers";
import { el, icon, type IconName } from "../dom";
import type { AppState, Route } from "../state";
import { buildModules } from "./models";
import { btn } from "./kit";

export interface HomeDeps { go(r: Route): void; openChat(convId?: string): void; askBrief(): void; saveQuickCommand(name: string, text: string): void; dismissSuggestion(name: string): void; chats: Chats }

export interface Attention { id: "key" | "approvals" | "update" | "memory" | "modules" | "reminder" | "suggest"; tone: "warn" | "bad" | "info"; icon: IconName; text: string; action: string; run: () => void; secondary?: { label: string; run: () => void } }

/**
 * Things that need the user, each exactly once. Pending approvals are not listed while the chat is open:
 * they are already shown inside the conversation, and a second copy would only compete with it.
 */
export function buildAttention(s: AppState, d: Pick<HomeDeps, "go" | "openChat"> & Partial<Pick<HomeDeps, "saveQuickCommand" | "dismissSuggestion">>): Attention[] {
  const ok = !!s.status?.assistant;
  const u = s.update;
  const hasUpdate = !!(u?.latest && u.localVersion !== "не определена" && u.localVersion !== u.latest.sha);
  const pending = s.memory.filter((m) => m.status === "pending").length;
  const failed = buildModules(s.modules).counts.failed;
  const out: Attention[] = [];
  if (s.status && !ok) out.push({ id: "key", tone: "warn", icon: "settings", text: "Помощница не подключена: нужен ключ Cloud.ru.", action: "Подключить", run: () => d.go("settings") });
  if (s.approvals.length && !s.chatOpen) out.push({ id: "approvals", tone: "bad", icon: "alert", text: `Ждёт вашего решения действий: ${s.approvals.length}.`, action: "Открыть чат", run: () => d.openChat() });
  if (u?.phase === "ready") out.push({ id: "update", tone: "info", icon: "update", text: "Обновление скачано и проверено — его можно установить.", action: "Установить", run: () => d.go("update") });
  else if (u?.rollbackPending) out.push({ id: "update", tone: "warn", icon: "update", text: "Запланирован откат на предыдущую версию.", action: "Подробнее", run: () => d.go("update") });
  else if (hasUpdate && u?.blocked) out.push({ id: "update", tone: "info", icon: "update", text: `Новая версия ${u?.latest?.version} появилась, но её автоматические проверки ещё не пройдены.`, action: "Подробнее", run: () => d.go("update") });
  else if (hasUpdate) out.push({ id: "update", tone: "info", icon: "update", text: `Доступна новая версия ${u?.latest?.version}.`, action: "Обновить", run: () => d.go("update") });
  if (pending) out.push({ id: "memory", tone: "info", icon: "memory", text: `Новых записей памяти на подтверждение: ${pending}.`, action: "Посмотреть", run: () => d.go("memory") });
  const dueNow = s.brief?.due.length ?? 0;
  if (dueNow) out.push({ id: "reminder", tone: "warn", icon: "clock", text: dueNow === 1 ? `Напоминание: ${s.brief!.due[0]!.text}` : `Сработали напоминания: ${dueNow}.`, action: "Открыть", run: () => d.go("reminders") });
  if (failed) out.push({ id: "modules", tone: "bad", icon: "modules", text: `Модулей со сбоем: ${failed}.`, action: "Открыть", run: () => d.go("modules") });
  const sug = s.repeatSuggestions?.[0];
  if (sug && d.saveQuickCommand && d.dismissSuggestion) {
    const short = sug.text.length > 60 ? sug.text.slice(0, 59) + "…" : sug.text;
    out.push({ id: "suggest", tone: "info", icon: "plus", text: `Вы уже ${sug.count} раза просили: «${short}». Сохранить как быструю команду /${sug.name}?`,
      action: "Сохранить", run: () => d.saveQuickCommand!(sug.name, sug.text), secondary: { label: "Не надо", run: () => d.dismissSuggestion!(sug.name) } });
  }
  return out;
}

export interface BriefItem { kind: "due" | "today" | "todo"; text: string; when?: string }
/** What the "Сегодня" card lists, in reading order: what already fired, what is planned today, then open to-dos. */
export function briefItems(b: NonNullable<AppState["brief"]>, max = 6): BriefItem[] {
  const time = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return [
    ...b.due.map((r): BriefItem => ({ kind: "due", text: r.text, when: "сработало" })),
    ...b.today.map((r): BriefItem => ({ kind: "today", text: r.text, when: time(r.at) })),
    ...b.openTodos.first.map((t): BriefItem => ({ kind: "todo", text: t.text })),
  ].slice(0, max);
}
function briefCard(s: AppState, d: HomeDeps): HTMLElement | null {
  const b = s.brief;
  if (!b) return null;
  const items = briefItems(b);
  const more = b.openTodos.count - b.openTodos.first.length;
  if (!items.length && !b.plansRunning) return null;
  return el("section", { cls: "pg-card brief" },
    el("div", { cls: "brief-head" }, el("h2", { textContent: "Сегодня" }), s.status?.assistant ? btn("Рассказать в чате", () => d.askBrief(), { small: true, icon: "chat" }) : null),
    items.length ? el("ul", { cls: "brief-list" }, ...items.map((i) => el("li", { cls: i.kind },
      icon(i.kind === "todo" ? "circleCheck" : "clock", 16), el("span", { cls: "grow", textContent: i.text }), i.when ? el("span", { cls: "muted small", textContent: i.when }) : null))) : null,
    more > 0 ? el("p", { cls: "muted small", textContent: `…и ещё дел: ${more}` }) : null,
    b.plansRunning ? el("p", { cls: "muted small", textContent: `Планов в работе: ${b.plansRunning}` }) : null);
}

export function homePage(s: AppState, d: HomeDeps): HTMLElement {
  const ok = !!s.status?.assistant;
  const attention = buildAttention(s, d);

  const hero = el("section", { cls: "home-hero" },
    characterAvatar(76, "hero-av"),
    el("div", { cls: "home-hero-text" },
      el("h1", { textContent: greeting() + "!" }),
      el("p", { cls: "muted", textContent: !s.status ? "Подключаюсь…" : ok ? "Я на связи. Чем помочь?" : "Добавьте ключ Cloud.ru, и я проснусь." }),
      // Key and update prompts are in "Требует внимания" only, so nothing is offered twice.
      ok ? el("div", { cls: "row" }, btn("Открыть чат", () => d.openChat(), { primary: true, icon: "chat" })) : null));

  const att = attention.length
    ? el("section", { cls: "pg-card" }, el("h2", { textContent: "Требует внимания" }),
        el("ul", { cls: "attn" }, ...attention.map((a) => {
          const b = btn(a.action, a.run, { small: true });
          const second = a.secondary ? btn(a.secondary.label, a.secondary.run, { small: true }) : null;
          return el("li", { cls: `attn-row ${a.tone}` }, icon(a.icon, 18), el("span", { cls: "grow", textContent: a.text }), ...(second ? [second] : []), b);
        })))
    : el("section", { cls: "pg-card calm" }, icon("circleCheck", 20), el("span", { textContent: "Всё в порядке: помощница на связи, обновлений и задач на подтверждение нет." }));

  const recent = d.chats.store.get().items.filter((c) => c.messages.length).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);
  const recents = el("section", { cls: "pg-card" }, el("h2", { textContent: "Недавние чаты" }),
    recent.length
      ? el("ul", { cls: "recent" }, ...recent.map((c) => {
          const row = el("button", { type: "button", cls: "recent-row" }, el("span", { cls: "recent-main" }, el("strong", { textContent: c.title }), el("span", { cls: "muted", textContent: previewOf(c.messages) })), el("span", { cls: "muted", textContent: relTime(c.updatedAt) }));
          row.addEventListener("click", () => d.openChat(c.id));
          return el("li", {}, row);
        }))
      : el("p", { cls: "muted", textContent: "Пока нет разговоров. Нажмите на аватар и напишите что-нибудь — они появятся здесь." }));

  return el("div", { cls: "page home" }, ...[hero, att, briefCard(s, d), recents].filter((x): x is HTMLElement => !!x));
}
