/**
 * The left menu as data: its groups, the person's own order and hidden items, the counters next to each item
 * and the search behind Ctrl+K. Pure, so it is unit-tested; menu.ts and palette.ts only draw it.
 */
import { attempt } from "@juunibi/core";
import type { Brief, MemoryItem } from "../api";
import type { IconName } from "../dom";
import type { Route } from "../state";

export type NavId = "chat" | "tasks" | "brain" | "modules" | "mobile" | "update" | "settings";
export type NavGroup = "main" | "brain" | "system";
export interface NavItem { id: NavId; label: string; icon: IconName; group: NavGroup; route?: Route }

/** Default order. «Беседа» opens the chat window, every other item is a page. */
export const NAV_ITEMS: NavItem[] = [
  { id: "chat", label: "Беседа", icon: "chat", group: "main" },
  { id: "tasks", label: "Дела", icon: "check", group: "main", route: "tasks" },
  { id: "brain", label: "Мозг", icon: "brain", group: "brain", route: "brain" },
  { id: "modules", label: "Модули", icon: "modules", group: "brain", route: "modules" },
  { id: "mobile", label: "Телефон", icon: "phone", group: "system", route: "mobile" },
  { id: "update", label: "Обновление", icon: "update", group: "system", route: "update" },
  { id: "settings", label: "Настройки", icon: "settings", group: "system", route: "settings" },
];
export const NAV_IDS = NAV_ITEMS.map((n) => n.id);
export const GROUPS: NavGroup[] = ["main", "brain", "system"];
/** Settings can't be hidden: that is where the menu is set up again. */
export const UNHIDEABLE: NavId[] = ["settings"];

export interface NavPrefs { collapsed: boolean; order: NavId[]; hidden: NavId[] }
const KEY = "juunibi:nav:v1";

/** Any stored value becomes valid prefs: unknown ids are dropped, missing ones are added at their default place. */
export function cleanPrefs(raw: unknown): NavPrefs {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const ids = (v: unknown): NavId[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is NavId => NAV_IDS.includes(x as NavId)))] : []);
  const order = ids(o.order);
  for (const id of NAV_IDS) if (!order.includes(id)) order.push(id);
  return { collapsed: o.collapsed === true, order, hidden: ids(o.hidden).filter((id) => !UNHIDEABLE.includes(id)) };
}
export function loadPrefs(): NavPrefs {
  const r = attempt(() => JSON.parse(localStorage.getItem(KEY) ?? "null") as unknown);
  return cleanPrefs(r.ok ? r.value : null);
}
export function savePrefs(p: NavPrefs) { attempt(() => localStorage.setItem(KEY, JSON.stringify(p))); }

export const itemOf = (id: NavId): NavItem => NAV_ITEMS.find((n) => n.id === id)!;

/** Items by group in the person's order. With `all`, hidden ones are kept too (for the edit mode). */
export function arrange(p: NavPrefs, all = false): { group: NavGroup; items: NavItem[] }[] {
  const pos = (id: NavId) => p.order.indexOf(id);
  return GROUPS.map((group) => ({
    group,
    items: NAV_ITEMS.filter((n) => n.group === group && (all || !p.hidden.includes(n.id))).sort((a, b) => pos(a.id) - pos(b.id)),
  })).filter((g) => g.items.length);
}
/** Visible items top to bottom: Alt+1 is the first of them. */
export const visibleItems = (p: NavPrefs): NavItem[] => arrange(p).flatMap((g) => g.items);

/** Moves an item one step up or down inside its own group. */
export function move(p: NavPrefs, id: NavId, dir: -1 | 1): NavPrefs {
  const same = arrange(p, true).find((g) => g.items.some((n) => n.id === id))!.items.map((n) => n.id);
  const i = same.indexOf(id), j = i + dir;
  if (j < 0 || j >= same.length) return p;
  return placeBefore(p, id, dir < 0 ? same[j]! : (same[j + 1] ?? null), same);
}
/** Drag and drop: puts `id` right before `target` (or last in the group when `target` is null). Other groups stay. */
export function placeBefore(p: NavPrefs, id: NavId, target: NavId | null, groupIds?: NavId[]): NavPrefs {
  if (id === target) return p;
  const group = itemOf(id).group;
  if (target && itemOf(target).group !== group) return p;
  const same = groupIds ?? arrange(p, true).find((g) => g.group === group)!.items.map((n) => n.id);
  const rest = same.filter((x) => x !== id);
  const at = target ? rest.indexOf(target) : rest.length;
  rest.splice(at < 0 ? rest.length : at, 0, id);
  // the group's slots in the global order are refilled in the new order
  const slots = p.order.map((x, k) => (same.includes(x) ? k : -1)).filter((k) => k >= 0);
  const order = [...p.order];
  slots.forEach((k, n) => { order[k] = rest[n]!; });
  return { ...p, order };
}
export function toggleHidden(p: NavPrefs, id: NavId): NavPrefs {
  if (UNHIDEABLE.includes(id)) return p;
  return { ...p, hidden: p.hidden.includes(id) ? p.hidden.filter((x) => x !== id) : [...p.hidden, id] };
}

// ---------------------------------------------------------------- counters

export interface NavBadge { count?: number; tone: "accent" | "bad" | "info"; title: string }
export interface BadgeInput { brief: Brief | null; memory: MemoryItem[]; modulesFailed: number; updateAvailable: boolean; unread: number; approvals: number }

/** What needs the person, per item. Nothing is shown for zero. */
export function badges(s: BadgeInput): Partial<Record<NavId, NavBadge>> {
  const out: Partial<Record<NavId, NavBadge>> = {};
  const due = s.brief?.due.length ?? 0;
  if (due) out.tasks = { count: due, tone: "accent", title: due === 1 ? "Сработало напоминание" : `Сработало напоминаний: ${due}` };
  const pending = Math.max(s.memory.filter((m) => m.status === "pending").length, s.brief?.memoryPending ?? 0);
  if (pending) out.brain = { count: pending, tone: "info", title: `Записей памяти ждут решения: ${pending}` };
  const failed = Math.max(s.modulesFailed, s.brief?.modulesFailed.length ?? 0);
  if (failed) out.modules = { tone: "bad", title: `Модулей со сбоем: ${failed}` };
  if (s.updateAvailable) out.update = { tone: "bad", title: "Доступно обновление" };
  if (s.approvals) out.chat = { count: s.approvals, tone: "bad", title: `Ждёт вашего решения: ${s.approvals}` };
  else if (s.unread) out.chat = { count: s.unread, tone: "accent", title: `Новых ответов: ${s.unread}` };
  return out;
}

/** The line under «Дела»: what already fired, else the nearest reminder still ahead today. */
export function todayLine(b: Brief | null, now = new Date()): { time: string; text: string; due: boolean } | null {
  if (!b) return null;
  if (b.due[0]) return { time: "сейчас", text: b.due[0].text, due: true };
  const next = b.today.filter((r) => new Date(r.at).getTime() >= now.getTime()).sort((x, y) => x.at.localeCompare(y.at))[0];
  return next ? { time: new Date(next.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }), text: next.text, due: false } : null;
}

/** Chats under «Беседа»: the newest that have messages. */
export function recentChats<T extends { id: string; updatedAt: number; messages: unknown[] }>(items: T[], n = 4): T[] {
  return items.filter((c) => c.messages.length > 0).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, n);
}

// ---------------------------------------------------------------- hotkeys

/** "Alt+1" for the n-th visible item (1–9), so the hint in the tooltip always matches what the key does. */
export function hotkeyLabel(p: NavPrefs, id: NavId): string | null {
  const i = visibleItems(p).findIndex((n) => n.id === id);
  return i >= 0 && i < 9 ? `Alt+${i + 1}` : null;
}
/** Physical key → item, independent of the keyboard layout (Russian layout gives no Latin letters). */
export function itemForDigit(p: NavPrefs, code: string): NavItem | null {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  return m ? visibleItems(p)[Number(m[1]) - 1] ?? null : null;
}

// ---------------------------------------------------------------- Ctrl+K search

export type PaletteKind = "section" | "command" | "chat" | "task" | "memory";
export interface PaletteEntry { kind: PaletteKind; title: string; sub?: string | undefined; keys?: string | undefined; icon: IconName; run: () => void; /** extra words to match */ terms?: string | undefined }
export const KIND_LABEL: Record<PaletteKind, string> = { command: "Команды", section: "Разделы", chat: "Беседы", task: "Дела и заметки", memory: "Память" };
const KIND_ORDER: PaletteKind[] = ["section", "command", "chat", "task", "memory"];

export const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();

/**
 * Ranks entries for the typed text: every word must be found; a title that starts with the text wins,
 * then a word of the title that starts with it, then a match anywhere (body text counts least).
 * Empty text: commands and sections only, in their own order.
 */
export function searchPalette(entries: PaletteEntry[], query: string, perKind = 6): PaletteEntry[] {
  const q = norm(query);
  if (!q) return entries.filter((e) => e.kind === "command" || e.kind === "section");
  const words = q.split(" ");
  const scored: { e: PaletteEntry; score: number; i: number }[] = [];
  entries.forEach((e, i) => {
    const title = norm(e.title), all = norm([e.title, e.sub, e.terms].filter(Boolean).join(" "));
    if (!words.every((w) => all.includes(w))) return;
    const score = title.startsWith(q) ? 0 : (" " + title).includes(" " + words[0]) ? 1 : title.includes(words[0]!) ? 2 : 3;
    scored.push({ e, score, i });
  });
  scored.sort((a, b) => a.score - b.score || KIND_ORDER.indexOf(a.e.kind) - KIND_ORDER.indexOf(b.e.kind) || a.i - b.i);
  const count: Partial<Record<PaletteKind, number>> = {};
  return scored.filter(({ e }) => (count[e.kind] = (count[e.kind] ?? 0) + 1) <= perKind).map((x) => x.e);
}
