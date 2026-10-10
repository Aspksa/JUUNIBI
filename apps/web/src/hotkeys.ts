import { el } from "./dom";
import { openSheet } from "./pages/sheet";

/** Every keyboard shortcut of the app (physical keys, so they also work with the Russian layout). */
export const HOTKEYS: [string, string[]][] = [
  ["Поиск и команды", ["Ctrl", "K"]], ["Открыть или закрыть чат", ["Ctrl", "J"]], ["Новая беседа", ["Alt", "N"]],
  ["Разделы меню по порядку", ["Alt", "1…7"]], ["Свернуть или развернуть меню", ["Ctrl", "B"]],
  ["Поиск по настройкам", ["Ctrl", ","]], ["Эта таблица", ["?"]],
  ["Сохранить поле настроек", ["Enter"]], ["Сохранить многострочное поле", ["Ctrl", "Enter"]], ["Закрыть окно", ["Esc"]],
];

export const keys = (list: string[]) => el("span", { cls: "hk-keys" }, ...list.flatMap((k, i) => [i ? " + " : "", el("kbd", { cls: "kbd", textContent: k })]));
export const hotkeyTable = () => el("dl", { cls: "hk-table" }, ...HOTKEYS.flatMap(([label, k]) => [el("dt", { textContent: label }), el("dd", {}, keys(k))]));

export function openHotkeys() {
  openSheet({ title: "Горячие клавиши", icon: "keyboard", sub: "Работают и в русской раскладке", content: hotkeyTable() });
}

/** "?" pressed outside a text field. */
export function isHelpKey(e: KeyboardEvent): boolean {
  if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey) return false;
  const t = e.target as HTMLElement | null;
  return !(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)));
}
