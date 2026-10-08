import { api } from "../api";
import { el, short } from "../dom";
import { segmented } from "../ui";
import { app, checkUpdate, downloadUpdate, persistPrefs, type AppState } from "../state";

const MODES = [["simple", "Простой"], ["visual", "Визуальный"], ["technical", "Технический"]] as const;
const dirOf = (p: string) => p.split("/").slice(0, -1).join("/") || "Корень";

export function updatePage(s: AppState): HTMLElement {
  const u = s.update;
  const events = [...new Map(s.updateEvents.map((e) => [e.event_id, e])).values()];
  const manifest = [...events].reverse().find((e) => e.type === "manifest_ready");
  const files = manifest?.files ?? [];
  const newest = [...events].reverse().find((e) => e.relative_path && ["file_download_done", "file_install_start", "file_install_done", "file_install_failed"].includes(e.type));
  const installed = new Set(events.filter((e) => e.type === "file_install_done").map((e) => e.relative_path));
  const downloaded = new Set(events.filter((e) => e.type === "file_download_done").map((e) => e.relative_path));
  const failed = new Set(events.filter((e) => e.type === "file_install_failed").map((e) => e.relative_path));
  const busy = u?.phase === "downloading" || u?.phase === "testing";

  const btn = (title: string, run: () => void, disabled = false, primary = false) => {
    const b = el("button", { type: "button", cls: "btn" + (primary ? " primary" : ""), textContent: title, disabled });
    b.addEventListener("click", run);
    return b;
  };
  const modes = segmented<AppState["updateMode"]>({ label: "Режим отображения", options: MODES, value: s.updateMode, onChange: (m) => { app.set({ updateMode: m }); persistPrefs(app.get()); } });

  const folders = [...new Set(files.map((f) => dirOf(f.path)))].sort();
  const flight = el("div", { cls: "flight-layout" },
    el("div", { cls: "flight-zone" }, el("strong", { textContent: "GitHub · источник" }),
      ...files.slice(0, 65).map((f) => el("div", { cls: "flight-file" + (f.change_type === "removed" ? " removed" : ""), textContent: (f.change_type === "added" ? "+ " : f.change_type === "modified" ? "~ " : f.change_type === "removed" ? "− " : "= ") + f.path }))),
    el("div", { cls: "flight-center" }, el("strong", { textContent: "Проверка → загрузка" }),
      ...(newest ? [el("div", { cls: "flying-file", textContent: newest.relative_path })] : [el("p", { cls: "muted", textContent: "Ожидание реальных событий" })])),
    el("div", { cls: "flight-zone" }, el("strong", { textContent: "Локальные папки" }),
      ...folders.slice(0, 65).map((folder) => {
        const inDir = files.filter((f) => dirOf(f.path) === folder);
        return el("details", {}, el("summary", { textContent: `📁 ${folder} · установлено ${inDir.filter((f) => installed.has(f.path)).length}` }),
          ...inDir.map((f) => el("div", { cls: "flight-file " + (installed.has(f.path) ? "installed" : failed.has(f.path) ? "failed" : downloaded.has(f.path) ? "downloaded" : ""),
            textContent: (installed.has(f.path) ? "✓ " : failed.has(f.path) ? "✕ " : downloaded.has(f.path) ? "↓ " : "• ") + (f.path.split("/").pop() ?? f.path) })));
      })));

  const log = el("div", { cls: "update-log" }, ...events.slice(-100).reverse().map((e) =>
    el("p", { textContent: new Date(e.timestamp).toLocaleTimeString("ru-RU") + " · " + e.type + (e.relative_path ? " · " + e.relative_path : "") + (e.message ? " · " + e.message : "") })));

  const health = [...events].reverse().find((e) => e.type === "health_check_done");
  const removals = u?.pendingRemovals ?? [];
  const removalBox = u?.phase === "ready" && removals.length
    ? el("section", { cls: "removals", attrs: { role: "group" } },
        el("strong", { textContent: `Новая версия больше не содержит ${removals.length} файл(ов). Они будут удалены при установке только после вашего подтверждения (резервная копия создаётся):` }),
        el("ul", {}, ...removals.slice(0, 50).map((r) => el("li", { textContent: r }))),
        btn(u.removalsConfirmed ? "Удаление подтверждено" : "Подтвердить удаление", () => void api.updateConfirmRemovals().then((r) => { if (r.ok) app.set({ update: r.value }); }), !!u.removalsConfirmed))
    : null;

  const progress = el("progress", { max: 100, value: u?.percent ?? 0, attrs: { "aria-label": "Прогресс скачивания" } });
  const phase = u?.phase === "testing" ? "Тесты и сборка" : u?.phase === "ready" ? "Готово к установке" : u?.phase === "downloading" ? "Скачивание" : u?.phase === "error" ? "Ошибка" : "Ожидание";
  const hasNew = !!u?.latest && u.localVersion !== u.latest.sha;
  const row = (k: string, v: string) => el("div", { cls: "kv" }, el("span", { cls: "muted", textContent: k }), el("span", { textContent: v }));

  return el("div", { cls: "page updater" }, el("h1", { textContent: "Обновление" }),
    el("p", { cls: "muted lead", textContent: "Источник: github.com/Aspksa/JUUNIBI. Файлы проверяются, прогоняются тесты, и только потом обновление устанавливается при следующем запуске." }),
    modes,
    ...(s.updateMode === "visual" ? [flight] : []),
    ...(s.updateMode === "technical" ? [el("h3", { textContent: "Журнал фактических событий" }), log] : []),
    el("section", { cls: "panel" },
      row("Локальная версия", short(u?.localVersion)),
      row("Доступная версия", u?.latest?.version ?? "ещё не проверена"),
      row("Описание", u?.latest?.description ?? "Нажмите «Проверить обновления»"),
      row("Дата публикации", u?.latest?.date ? new Date(u.latest.date).toLocaleString("ru-RU") : "неизвестна"),
      el("div", { cls: "row" }, btn("Проверить обновления", () => void checkUpdate(), busy), btn("Скачать и проверить", () => void downloadUpdate(), !hasNew || busy, true))),
    progress,
    ...(removalBox ? [removalBox] : []),
    ...(health ? [el("p", { cls: health.status === "healthy" ? "ok" : "bad", textContent: "Проверка запуска после установки: " + (health.status === "healthy" ? "пройдена" : "не пройдена" + (health.message ? " — " + health.message : "")) })] : []),
    el("p", { cls: "muted", textContent: `${u?.percent ?? 0}% · файлов: ${u?.downloadedFiles ?? 0} из ${u?.totalFiles ?? 0} · ${((u?.downloadedBytes ?? 0) / 1048576).toFixed(2)} из ${((u?.totalBytes ?? 0) / 1048576).toFixed(2)} МБ · этап: ${phase}` }),
    ...(u?.error || s.updateError || u?.message ? [el("p", { cls: u?.error || s.updateError ? "bad" : "muted", textContent: u?.error || s.updateError || u?.message || "" })] : []),
    ...(u?.phase === "ready" ? [el("p", { cls: "muted", textContent: "Перезапустите JUUNIBI через штатный лаунчер для установки. Резервная копия будет создана автоматически." })] : []));
}

let lastFlight = "";
/** Animates the real event (download -> centre, install -> local folders). Never blocks, skipped for reduced motion. */
export function animateFlight(host: HTMLElement, s: AppState) {
  if (s.updateMode !== "visual" || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const event = [...s.updateEvents].reverse().find((e) => e.relative_path && (e.type === "file_download_done" || e.type === "file_install_done"));
  if (!event || event.event_id === lastFlight) return;
  lastFlight = event.event_id;
  const zones = host.querySelectorAll<HTMLElement>(".flight-zone");
  const center = host.querySelector<HTMLElement>(".flight-center");
  const from = event.type === "file_install_done" ? center : zones[0];
  const to = event.type === "file_install_done" ? zones[1] : center;
  if (!from || !to) return;
  const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
  const x = a.left + a.width / 2, y = a.top + a.height / 2;
  const dx = b.left + b.width / 2 - x, dy = b.top + b.height / 2 - y;
  const chip = el("div", { cls: "update-flight-overlay", textContent: event.relative_path.split("/").pop() ?? "Файл" });
  chip.style.left = x + "px"; chip.style.top = y + "px";
  document.body.append(chip);
  const anim = chip.animate([
    { transform: "translate(-50%,-50%)", opacity: 0.6 },
    { transform: `translate(calc(-50% + ${dx / 2}px),calc(-50% + ${dy / 2 - 24}px))`, opacity: 1, offset: 0.5 },
    { transform: `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px))`, opacity: 0.85 },
  ], { duration: 850, easing: "ease-in-out" });
  void anim.finished.then(() => chip.remove(), () => chip.remove());
}
