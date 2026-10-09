import { characterAvatar, greeting } from "../chat/art";
import type { Chats } from "../chat/chats";
import { previewOf, relTime } from "../chat/helpers";
import { el, icon, type IconName } from "../dom";
import type { AppState, Route } from "../state";
import { buildModules } from "./models";
import { btn } from "./kit";

export interface HomeDeps { go(r: Route): void; openChat(convId?: string): void; chats: Chats }

export interface Attention { id: "key" | "approvals" | "update" | "memory" | "modules"; tone: "warn" | "bad" | "info"; icon: IconName; text: string; action: string; run: () => void }

/**
 * Things that need the user, each exactly once. Pending approvals are not listed while the chat is open:
 * they are already shown inside the conversation, and a second copy would only compete with it.
 */
export function buildAttention(s: AppState, d: Pick<HomeDeps, "go" | "openChat">): Attention[] {
  const ok = !!s.status?.assistant;
  const u = s.update;
  const hasUpdate = !!(u?.latest && u.localVersion !== "не определена" && u.localVersion !== u.latest.sha);
  const pending = s.memory.filter((m) => m.status === "pending").length;
  const failed = buildModules(s.modules).counts.failed;
  const out: Attention[] = [];
  if (s.status && !ok) out.push({ id: "key", tone: "warn", icon: "settings", text: "Помощница не подключена: нужен ключ Cloud.ru.", action: "Подключить", run: () => d.go("settings") });
  if (s.approvals.length && !s.chatOpen) out.push({ id: "approvals", tone: "bad", icon: "alert", text: `Ждёт вашего решения действий: ${s.approvals.length}.`, action: "Открыть чат", run: () => d.openChat() });
  if (u?.phase === "ready") out.push({ id: "update", tone: "info", icon: "update", text: "Обновление скачано и проверено — осталось перезапустить JUUNIBI.", action: "Подробнее", run: () => d.go("update") });
  else if (hasUpdate) out.push({ id: "update", tone: "info", icon: "update", text: `Доступна новая версия ${u?.latest?.version}.`, action: "Обновить", run: () => d.go("update") });
  if (pending) out.push({ id: "memory", tone: "info", icon: "memory", text: `Новых записей памяти на подтверждение: ${pending}.`, action: "Посмотреть", run: () => d.go("memory") });
  if (failed) out.push({ id: "modules", tone: "bad", icon: "modules", text: `Модулей со сбоем: ${failed}.`, action: "Открыть", run: () => d.go("modules") });
  return out;
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
          return el("li", { cls: `attn-row ${a.tone}` }, icon(a.icon, 18), el("span", { cls: "grow", textContent: a.text }), b);
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

  return el("div", { cls: "page home" }, hero, att, recents);
}
