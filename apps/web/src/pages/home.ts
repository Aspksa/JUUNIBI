import { characterAvatar, greeting } from "../chat/art";
import type { Chats } from "../chat/chats";
import { previewOf, relTime } from "../chat/helpers";
import { el, icon, short, type IconName } from "../dom";
import type { AppState, Route } from "../state";
import { buildModules } from "./models";
import { btn, dot } from "./kit";

export interface HomeDeps { go(r: Route): void; openChat(convId?: string): void; chats: Chats }

interface Attention { tone: "warn" | "bad" | "info"; icon: IconName; text: string; action: string; run: () => void }

export function homePage(s: AppState, d: HomeDeps): HTMLElement {
  const ok = !!s.status?.assistant;
  const u = s.update;
  const hasUpdate = !!(u?.latest && u.localVersion !== "не определена" && u.localVersion !== u.latest.sha);
  const pending = s.memory.filter((m) => m.status === "pending").length;
  const mods = buildModules(s.modules);
  const modsBad = mods.counts.failed;

  // ---- things that need the user
  const attention: Attention[] = [];
  if (s.status && !ok) attention.push({ tone: "warn", icon: "settings", text: "Помощница не подключена: нужен ключ Cloud.ru.", action: "Подключить", run: () => d.go("settings") });
  if (s.approvals.length) attention.push({ tone: "bad", icon: "alert", text: `Ждёт вашего решения действий: ${s.approvals.length}.`, action: "Открыть чат", run: () => d.openChat() });
  if (u?.phase === "ready") attention.push({ tone: "info", icon: "update", text: "Обновление скачано и проверено — осталось перезапустить JUUNIBI.", action: "Подробнее", run: () => d.go("update") });
  else if (hasUpdate) attention.push({ tone: "info", icon: "update", text: `Доступна новая версия ${u?.latest?.version}.`, action: "Обновить", run: () => d.go("update") });
  if (pending) attention.push({ tone: "info", icon: "memory", text: `Новых записей памяти на подтверждение: ${pending}.`, action: "Посмотреть", run: () => d.go("memory") });
  if (modsBad) attention.push({ tone: "bad", icon: "modules", text: `Модулей со сбоем: ${modsBad}.`, action: "Открыть", run: () => d.go("modules") });

  const hero = el("section", { cls: "home-hero" },
    characterAvatar(76, "hero-av"),
    el("div", { cls: "home-hero-text" },
      el("h1", { textContent: greeting() + "!" }),
      el("p", { cls: "muted", textContent: !s.status ? "Подключаюсь…" : ok ? "Я на связи. Чем помочь?" : "Добавьте ключ Cloud.ru, и я проснусь." }),
      el("div", { cls: "row" },
        ok ? btn("Открыть чат", () => d.openChat(), { primary: true, icon: "chat" }) : btn("Подключить помощницу", () => d.go("settings"), { primary: true, icon: "settings" }),
        btn("Проверить обновления", () => d.go("update"), { icon: "update" }))));

  const att = attention.length
    ? el("section", { cls: "pg-card" }, el("h2", { textContent: "Требует внимания" }),
        el("ul", { cls: "attn" }, ...attention.map((a) => {
          const b = btn(a.action, a.run, { small: true });
          return el("li", { cls: `attn-row ${a.tone}` }, icon(a.icon, 18), el("span", { cls: "grow", textContent: a.text }), b);
        })))
    : el("section", { cls: "pg-card calm" }, icon("circleCheck", 20), el("span", { textContent: "Всё в порядке: помощница на связи, обновлений и задач на подтверждение нет." }));

  const stat = (ic: IconName, title: string, value: string, hint: string, tone: "ok" | "warn" | "bad" | "off", go: Route) => {
    const c = el("button", { type: "button", cls: "stat-card" }, el("span", { cls: "stat-top" }, icon(ic, 18), el("span", { textContent: title }), dot(tone)),
      el("strong", { textContent: value }), el("span", { cls: "muted", textContent: hint }));
    c.addEventListener("click", () => d.go(go));
    return c;
  };
  const cards = el("div", { cls: "stat-grid" },
    stat("update", "Версия", short(u?.localVersion), hasUpdate ? `Доступна ${u?.latest?.version}` : u?.latest ? "Последняя версия" : "Ещё не проверялась", hasUpdate ? "warn" : u?.latest ? "ok" : "off", "update"),
    stat("memory", "Память", `${s.memory.filter((m) => m.status === "active").length} записей`, pending ? `${pending} ждут подтверждения` : "Всё подтверждено", pending ? "warn" : "ok", "memory"),
    stat("modules", "Модули", s.modules.length ? `${mods.counts.started} из ${s.modules.length} работают` : "—", mods.counts.pending ? `${mods.counts.pending} ждут настройки` : modsBad ? `${modsBad} со сбоем` : "Всё запущено", modsBad ? "bad" : mods.counts.pending ? "warn" : s.modules.length ? "ok" : "off", "modules"));

  const recent = d.chats.store.get().items.filter((c) => c.messages.length).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5);
  const recents = el("section", { cls: "pg-card" }, el("h2", { textContent: "Недавние чаты" }),
    recent.length
      ? el("ul", { cls: "recent" }, ...recent.map((c) => {
          const row = el("button", { type: "button", cls: "recent-row" }, el("span", { cls: "recent-main" }, el("strong", { textContent: c.title }), el("span", { cls: "muted", textContent: previewOf(c.messages) })), el("span", { cls: "muted", textContent: relTime(c.updatedAt) }));
          row.addEventListener("click", () => d.openChat(c.id));
          return el("li", {}, row);
        }))
      : el("p", { cls: "muted", textContent: "Пока нет разговоров. Нажмите на аватар и напишите что-нибудь — они появятся здесь." }));

  return el("div", { cls: "page home" }, hero, att, cards, recents);
}
