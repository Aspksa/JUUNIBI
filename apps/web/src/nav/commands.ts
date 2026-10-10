/** What Ctrl+K can find and do: sections, commands, chats, memory, and (loaded on open) to-dos, reminders and notes. */
import { api } from "../api";
import type { Chats } from "../chat/chats";
import { relTime } from "../chat/helpers";
import { persistPrefs, app, type Route } from "../state";
import { searchTasksFor } from "../pages/tasks";
import { NAV_ITEMS, hotkeyLabel, type NavPrefs, type PaletteEntry } from "./model";

export interface CommandDeps {
  chats: Chats; prefs: NavPrefs;
  go(r: Route): void; openChat(convId?: string): void; newChat(): void; send(text: string): void;
  quickAdd(text?: string): void; toggleCollapsed(): void; editMenu(): void; connection(): void;
}

export function baseEntries(d: CommandDeps): PaletteEntry[] {
  const s = app.get();
  const dark = s.theme === "dark" || (s.theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  const out: PaletteEntry[] = [
    { kind: "command", title: "Новая беседа", icon: "chat", keys: "Alt+N", terms: "чат новый", run: d.newChat },
    { kind: "command", title: "Добавить дело, напоминание или заметку", icon: "plus", terms: "новое дело напомнить заметка создать", run: () => d.quickAdd() },
    ...(s.assistantSettings?.quickCommands ?? []).map((c): PaletteEntry => ({ kind: "command", title: "/" + c.name, sub: c.text, icon: "list", terms: "быстрая команда", run: () => { d.openChat(); d.send(c.text); } })),
    { kind: "command", title: dark ? "Светлая тема" : "Тёмная тема", icon: dark ? "sun" : "moon", terms: "тема оформление", run: () => { app.set({ theme: dark ? "light" : "dark" }); persistPrefs(app.get()); } },
    { kind: "command", title: d.prefs.collapsed ? "Развернуть меню" : "Свернуть меню", icon: "sidebar", keys: "Ctrl+B", terms: "меню иконки", run: d.toggleCollapsed },
    { kind: "command", title: "Настроить меню", icon: "edit", terms: "порядок скрыть пункты", run: d.editMenu },
    { kind: "command", title: "Подключение к Cloud.ru", icon: "cloud", terms: "ключ модель api", run: d.connection },
  ];
  for (const n of NAV_ITEMS) {
    out.push({ kind: "section", title: n.label, icon: n.icon, keys: hotkeyLabel(d.prefs, n.id) ?? undefined, terms: n.id === "mobile" ? "мобильное приложение" : n.id === "brain" ? "память качество" : undefined,
      run: () => (n.route ? d.go(n.route) : d.openChat()) });
  }
  out.push({ kind: "section", title: "Память", sub: "Мозг", icon: "memory", run: () => d.go("memory") });
  for (const c of d.chats.store.get().items) {
    if (!c.messages.length) continue;
    out.push({ kind: "chat", title: c.title, sub: "беседа · " + relTime(c.updatedAt), icon: "chat", terms: c.messages.slice(-30).map((m) => m.content.slice(0, 300)).join(" "), run: () => d.openChat(c.id) });
  }
  for (const m of s.memory) out.push({ kind: "memory", title: m.text, sub: m.status === "pending" ? "ждёт решения" : undefined, icon: "memory", run: () => d.go("memory") });
  return out;
}

export async function taskEntries(d: Pick<CommandDeps, "go">): Promise<PaletteEntry[]> {
  const r = await api.organizer();
  if (!r.ok) return [];
  const open = (q: string) => () => { searchTasksFor(q); d.go("tasks"); };
  const when = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return [
    ...r.value.notes.filter((n) => !n.done).map((n): PaletteEntry => ({ kind: "task", title: n.text, sub: n.kind === "note" ? "заметка" : n.dueAt ? "дело · срок " + when(n.dueAt) : "дело", icon: n.kind === "note" ? "file" : "check", terms: n.project, run: open(n.text) })),
    ...r.value.reminders.filter((x) => x.status !== "done").map((x): PaletteEntry => ({ kind: "task", title: x.text, sub: "напоминание · " + when(x.at), icon: "clock", run: open(x.text) })),
  ];
}
