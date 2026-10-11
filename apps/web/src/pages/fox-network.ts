import { el, icon } from "../dom";
import { pageHead, btn, section } from "./kit";
import { api } from "../api";
const field = (name: string, value: string) => el("div", { cls: "pg-card" }, el("small", { cls: "muted", textContent: name }), el("p", { textContent: value }));
const find = (raw: string, pattern: RegExp) => raw.match(pattern)?.[1]?.trim() ?? "Не определено";
export function foxNetworkPage(): HTMLElement {
  const refresh = btn("Обновить измерения", () => { void load(); }, { icon: "refresh", primary: true });
  const content = el("div", {}, el("p", { cls: "muted", textContent: "Считывание адаптера Windows и доступных точек Wi-Fi. Настройки подключения не изменяются." }));
  const root = el("div", { cls: "page fox-network" },
    pageHead("link", "Лисья сеть", "Wi-Fi · Mesh · Сигнал · Каналы", refresh), content);
  async function load() {
    refresh.disabled = true;
    content.replaceChildren(el("p", { cls: "muted", textContent: "Считываю состояние Wi-Fi…" }));
    const response = await api.foxNetwork();
    refresh.disabled = false;
    if (!response.ok) { content.replaceChildren(field("Ошибка", "Не удалось получить данные Wi-Fi от локального сервера.")); return; }
    const s = response.value;
    if (!s.supported) { content.replaceChildren(field("Недоступно", s.error ?? "Адаптер Wi-Fi не обнаружен")); return; }
    const info = s.interfaces;
    const quality = find(info, /(?:Signal|Сигнал)\s*:\s*([^\r\n]+)/i);
    const channel = find(info, /(?:Channel|Канал)\s*:\s*([^\r\n]+)/i);
    const ssid = find(info, /^\s*SSID\s*:\s*([^\r\n]+)/im);
    const radio = find(info, /(?:Radio type|Тип радио)\s*:\s*([^\r\n]+)/i);
    const bssid = find(info, /^\s*BSSID\s*:\s*([^\r\n]+)/im);
    const cards = el("div", { cls: "fox-grid" }, field("Сеть (SSID)", ssid), field("Сигнал", quality), field("Канал", channel), field("Стандарт", radio), field("Точка доступа (BSSID)", bssid), field("Проверено", s.checkedAt));
    const networkText = el("pre", { cls: "fox-pre", textContent: s.networks || "Соседние точки доступа не обнаружены." });
    const details = el("details", {}, el("summary", { textContent: "Технические сведения адаптера" }), el("pre", { cls: "fox-pre", textContent: info }));
    content.replaceChildren(cards, section("Wi-Fi и Mesh", el("p", { textContent: s.meshNote }), el("p", { cls: "muted", textContent: "Для точной топологии Mesh и качества связи между узлами необходимы данные самого роутера. Повторяйте замеры по комнатам." })), section("Обнаруженные сети и BSSID", networkText), details);
  }
  void load();
  return root;
}
