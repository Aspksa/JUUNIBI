/** Building blocks of the Modules page: detail panel, dependency graph, assistant tools, "what the assistant sees", manifests. */
import { api, type ManifestPreview, type ModuleDetail, type ModuleToolInfo } from "../api";
import { formatBytes } from "../chat/helpers";
import { el } from "../dom";
import { btn, dot } from "./kit";
import { impactOf, layoutGraph, needsOf, type ModStatus, type ModView } from "./models";

export const STATUS_TEXT: Record<ModStatus, string> = { started: "Работает", pending: "Ждёт настройки", failed: "Сбой", stopped: "Остановлен" };
export const TONE: Record<ModStatus, "ok" | "warn" | "bad" | "off"> = { started: "ok", pending: "warn", failed: "bad", stopped: "off" };
const TAG: Record<ModStatus, string> = { started: "ok", pending: "warn", failed: "danger", stopped: "off" };
export const statusTag = (s: ModStatus) => el("span", { cls: `tag ${TAG[s]}`, textContent: STATUS_TEXT[s] });
const RISK: Record<string, [string, string]> = { read: ["чтение", "ok"], write: ["запись", "warn"], danger: ["опасно", "danger"] };
const PERM_RISK: Record<string, string> = { low: "ok", medium: "warn", high: "danger" };

export function ago(iso: string | null | undefined, now = Date.now()): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, Math.round((now - t) / 1000));
  return s < 60 ? "только что" : s < 3600 ? `${Math.floor(s / 60)} мин назад` : s < 86400 ? `${Math.floor(s / 3600)} ч назад` : `${Math.floor(s / 86400)} дн назад`;
}
export function duration(sec: number): string {
  return sec < 60 ? `${sec} с` : sec < 3600 ? `${Math.floor(sec / 60)} мин` : sec < 86400 ? `${Math.floor(sec / 3600)} ч ${Math.floor((sec % 3600) / 60)} мин` : `${Math.floor(sec / 86400)} дн ${Math.floor((sec % 86400) / 3600)} ч`;
}

/** Switch with a label; reverts itself when the server refuses the change. */
export function toggle(label: string, hint: string, checked: boolean, change: (v: boolean) => Promise<boolean>, disabled = false): HTMLElement {
  const i = el("input", { type: "checkbox", checked, disabled, attrs: { role: "switch" } });
  i.addEventListener("change", async () => {
    const want = i.checked;
    i.disabled = true;
    const ok = await change(want).catch(() => false);
    if (!ok) i.checked = !want;
    i.disabled = disabled;
  });
  return el("label", { cls: "set-row switch-row" }, el("span", { cls: "grow" }, el("strong", { textContent: label }), el("small", { cls: "muted", textContent: hint })), el("span", { cls: "switch" }, i));
}
const kv = (k: string, v: string | Node) => [el("span", { cls: "muted", textContent: k }), typeof v === "string" ? el("span", { textContent: v }) : v];
const sub = (title: string, ...kids: (Node | null)[]) => el("div", { cls: "br-sub" }, el("h3", { textContent: title }), ...kids);

// ---------- detail panel ----------
export function detailPanel(m: ModView, items: ModView[], reload: () => void): HTMLElement {
  const box = el("div", { cls: "mod-detail", attrs: { "aria-live": "polite" } }, el("p", { cls: "muted", textContent: "Загрузка…" }));
  void api.moduleDetail(m.name).then((r) => {
    if (!r.ok) { box.replaceChildren(el("p", { cls: "flash bad", textContent: "Не удалось загрузить: " + r.error.message })); return; }
    box.replaceChildren(...detailBody(r.value, m, items, reload));
  });
  return box;
}
function detailBody(d: ModuleDetail, m: ModView, items: ModView[], reload: () => void): Node[] {
  const out: Node[] = [el("p", { textContent: d.description })];
  const flash = el("p", { cls: "flash", attrs: { role: "status" } });
  const needs = needsOf(items, m.name), impact = impactOf(items, m.name);
  const chips = (names: string[]) => el("span", { cls: "mod-deps" }, ...(names.length ? names.map((x) => el("code", { textContent: x })) : [el("span", { cls: "muted", textContent: "нет" })]));
  out.push(el("div", { cls: "mod-kv" }, ...kv("Нужны для работы", chips(needs)), ...kv("Зависят от него", chips(impact))));

  if (d.kind === "manifest") {
    out.push(sub("Манифест",
      el("p", { cls: "muted small", textContent: `Версия ${d.version ?? "?"}. Манифест не содержит кода и ничего не выполняет: он лишь фиксирует запрошенные права.` }),
      el("div", { cls: "chips" }, ...(d.permissions ?? []).map((p) => el("span", { cls: "br-chip", textContent: p })))));
    out.push(btn("Удалить манифест", async () => {
      if (!confirm(`Удалить манифест «${m.title}»?`)) return;
      const r = await api.manifestRemove(m.name);
      if (r.ok) reload(); else { flash.className = "flash bad"; flash.textContent = r.error.message; }
    }, { danger: true, small: true, icon: "trash" }), flash);
    return out;
  }

  if (!d.core) {
    out.push(sub("Управление",
      toggle("Включён", "Выключатель сохраняется: после перезапуска сервера модуль не запустится. «Остановить» на карточке действует только до перезапуска.", d.enabled !== false,
        async (v) => {
          if (!v && impact.length && !confirm(`Выключить «${m.title}»? Это затронет: ${impact.join(", ")}.`)) return false;
          const r = await api.moduleAct(m.name, v ? "enable" : "disable");
          if (!r.ok) { flash.className = "flash bad"; flash.textContent = r.error.message; return false; }
          reload(); return true;
        }),
      toggle("Доступ помощницы", "Если закрыть, помощница не сможет вызывать инструменты этого модуля. Подтверждения действий остаются в силе.", !d.assistantBlocked,
        async (v) => {
          const r = await api.moduleAccess(m.name, v);
          if (!r.ok) { flash.className = "flash bad"; flash.textContent = r.error.message; return false; }
          reload(); return true;
        }), flash));
  } else {
    out.push(el("p", { cls: "muted small", textContent: "Основа системы: её нельзя остановить или выключить." }));
  }

  if (d.health) {
    const h = d.health;
    out.push(sub("Здоровье", el("div", { cls: "br-tiles" },
      statTile("Работает", d.running ? duration(h.uptimeSec) : "—"),
      statTile("Ошибок за сутки", String(h.errors24h), h.errors24h ? "bad" : ""),
      statTile("Последний успех", ago(h.lastOkAt)),
      statTile("Время ответа", h.lastMs === null ? "—" : `${h.lastMs} мс`, "", h.avgMs === null ? undefined : `в среднем ${h.avgMs} мс`)),
      h.lastError ? el("p", { cls: "mod-error", textContent: "Последняя ошибка: " + h.lastError }) : null));
  }

  if (d.tools.length) out.push(sub("Инструменты помощницы", toolRows(d.tools)));
  if (d.files.length) out.push(sub("Файлы данных", el("ul", { cls: "mod-files" }, ...d.files.map((f) =>
    el("li", {}, el("code", { textContent: f.path }), el("span", { cls: "muted", textContent: f.size === null ? "нет файла" : formatBytes(f.size) }))))));
  out.push(sub("Журнал", d.log.length
    ? el("ul", { cls: "mod-log" }, ...[...d.log].reverse().map((l) => el("li", { cls: l.level }, el("time", { cls: "muted", textContent: ago(l.at) }), el("span", { textContent: l.text }))))
    : el("p", { cls: "muted small", textContent: "Записей пока нет." })));
  return out;
}
function statTile(label: string, value: string, tone = "", subText?: string): HTMLElement {
  return el("div", { cls: "br-tile" }, el("span", { cls: "br-tile-label", textContent: label }),
    el("strong", { cls: "br-tile-value" + (tone === "bad" ? " bad" : ""), textContent: value }), subText ? el("span", { cls: "br-tile-sub muted", textContent: subText }) : null);
}

// ---------- tools ----------
function toolRows(tools: ModuleToolInfo[]): HTMLElement {
  return el("ul", { cls: "mod-tools" }, ...tools.map((t) => {
    const [label, tone] = RISK[t.risk] ?? [t.risk, ""];
    const sw = toggle(t.name, t.description, t.allowed, async (v) => (await api.moduleToolAllowed(t.name, v)).ok);
    return el("li", {}, sw, el("div", { cls: "mod-tool-meta" }, el("span", { cls: `tag ${tone}`, textContent: label }),
      el("span", { cls: "muted small", textContent: `за сутки: ${t.calls24h} вызовов${t.errors24h ? `, ошибок ${t.errors24h}` : ""}${t.denied24h ? `, отказов ${t.denied24h}` : ""}` })));
  }));
}
/** All tools the assistant has, grouped by module, with owner switches (they can only narrow access). */
export function toolsView(): HTMLElement {
  const box = el("div", { cls: "br-block" }, el("p", { cls: "muted", textContent: "Загрузка…" }));
  void api.moduleTools().then((r) => {
    if (!r.ok) { box.replaceChildren(el("p", { cls: "flash bad", textContent: r.error.message })); return; }
    if (!r.value.length) { box.replaceChildren(el("p", { cls: "br-empty muted", textContent: "Инструментов нет: помощница не подключена." })); return; }
    const groups = new Map<string, ModuleToolInfo[]>();
    for (const t of r.value) groups.set(t.module, [...(groups.get(t.module) ?? []), t]);
    box.replaceChildren(
      el("header", { cls: "br-block-head" }, el("h2", { textContent: "Инструменты помощницы" }),
        el("p", { cls: "muted", textContent: "Выключатель закрывает инструмент для помощницы. Открыть больше, чем разрешено, он не может: инструменты записи по-прежнему требуют вашего подтверждения. Счётчики — по последним 100 вызовам." })),
      ...[...groups].map(([name, tools]) => sub(name, toolRows(tools))));
  });
  return box;
}

// ---------- what the assistant sees ----------
export function assistantViewPanel(): HTMLElement {
  const box = el("div", { cls: "br-block" }, el("p", { cls: "muted", textContent: "Загрузка…" }));
  void api.assistantView().then((r) => {
    if (!r.ok) { box.replaceChildren(el("p", { cls: "flash bad", textContent: r.error.message })); return; }
    const copy = btn("Копировать", async () => { try { await navigator.clipboard.writeText(r.value.json); copy.textContent = "Скопировано ✓"; } catch { copy.textContent = "Не удалось"; } }, { small: true, icon: "copy" });
    box.replaceChildren(
      el("header", { cls: "br-block-head" }, el("h2", { textContent: "Что видит помощница" }),
        el("p", { cls: "muted", textContent: `Это точный JSON, который попадает в её системный промпт и в ответ инструмента list_modules (${r.value.chars} символов). Журналов, ошибок и путей к файлам в нём нет.` })),
      el("pre", { cls: "mod-json", textContent: r.value.json }), el("div", { cls: "br-row" }, copy));
  });
  return box;
}

// ---------- add a module (manifest only) ----------
export function addModulePanel(onInstalled: () => void): HTMLElement {
  const text = el("textarea", { rows: 7, placeholder: '{\n  "name": "weather",\n  "title": "Погода",\n  "description": "Что делает модуль",\n  "version": "1.0.0",\n  "permissions": ["read:memory"]\n}', spellcheck: false });
  const url = el("input", { type: "url", placeholder: "https://raw.githubusercontent.com/Aspksa/JUUNIBI/main/…/manifest.json" });
  const out = el("div", { attrs: { "aria-live": "polite" } });
  const flash = el("p", { cls: "flash", attrs: { role: "status" } });
  const fail = (msg: string) => { flash.className = "flash bad"; flash.textContent = msg; };
  const show = (p: ManifestPreview) => {
    const ok = el("input", { type: "checkbox" });
    const install = btn("Установить манифест", async () => {
      install.disabled = true;
      const r = await api.manifestInstall(p.manifest, p.sha256);
      if (r.ok) { flash.className = "flash"; flash.textContent = "Манифест установлен."; out.replaceChildren(); onInstalled(); } else { fail(r.error.message); install.disabled = !ok.checked; }
    }, { primary: true, disabled: true });
    ok.addEventListener("change", () => { install.disabled = !ok.checked; });
    out.replaceChildren(el("div", { cls: "mod-preview" },
      el("strong", { textContent: `${p.manifest.title} · ${p.manifest.version}` }), el("code", { textContent: p.manifest.name }),
      el("p", { textContent: p.manifest.description }),
      el("p", { cls: "muted small", textContent: p.note }),
      el("div", { cls: "chips" }, ...(p.permissions.length ? p.permissions.map((x) => el("span", { cls: `tag ${PERM_RISK[x.risk]}`, textContent: x.label })) : [el("span", { cls: "muted small", textContent: "Особых прав не запрашивает." })])),
      ...p.warnings.map((w) => el("p", { cls: "mod-error", textContent: w })),
      el("p", { cls: "muted small" }, "Контрольная сумма SHA-256: ", el("code", { cls: "mod-hash", textContent: p.sha256 })),
      el("label", { cls: "mod-confirm" }, ok, el("span", { textContent: "Я проверил права и контрольную сумму" })), install));
  };
  const preview = async (src: { manifest: unknown } | { url: string }) => {
    flash.className = "flash"; flash.textContent = "Проверка…"; out.replaceChildren();
    const r = await api.manifestPreview(src);
    if (r.ok) { flash.textContent = ""; show(r.value); } else fail(r.error.message);
  };
  const check = btn("Проверить", () => {
    let manifest: unknown;
    try { manifest = JSON.parse(text.value); } catch { fail("Это не JSON."); return; }
    void preview({ manifest });
  }, { primary: true });
  const fetchBtn = btn("Загрузить по адресу", () => { if (!url.value.trim()) { fail("Укажите адрес."); return; } void preview({ url: url.value.trim() }); }, { small: true });
  return el("div", { cls: "br-block" },
    el("header", { cls: "br-block-head" }, el("h2", { textContent: "Добавить модуль" }),
      el("p", { cls: "muted", textContent: "Поддерживаются только манифесты: описание модуля и запрашиваемые права. Код из них не загружается и не выполняется, а установка не добавляет помощнице инструментов." })),
    el("div", { cls: "br-form" },
      el("label", { cls: "br-field" }, el("span", { textContent: "Манифест (JSON)" }), text),
      el("div", { cls: "br-row" }, check),
      el("label", { cls: "br-field" }, el("span", { textContent: "или адрес из репозитория JUUNIBI" }), url),
      el("div", { cls: "br-row" }, fetchBtn)),
    flash, out);
}

// ---------- dependency graph ----------
const NS = "http://www.w3.org/2000/svg";
const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...kids: Node[]) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  n.append(...kids);
  return n;
};
/** Click a module to see what it needs (left) and what stops working if it fails (right, red). */
export function graphView(items: ModView[], selected: { name: string | null }): HTMLElement {
  const g = layoutGraph(items);
  const byName = new Map(g.nodes.map((n) => [n.name, n]));
  const caption = el("p", { cls: "mod-graph-note muted", attrs: { "aria-live": "polite" } });
  const nodeEls = new Map<string, SVGGElement>();
  const edgeEls: { e: { from: string; to: string }; p: SVGPathElement }[] = [];
  const canvas = svg("svg", { viewBox: `0 0 ${g.width} ${g.height}`, width: g.width, height: g.height, role: "img", "aria-label": "Граф зависимостей модулей", class: "mod-graph" },
    svg("defs", {}, svg("marker", { id: "arr", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, svg("path", { d: "M0 0L10 5L0 10z", class: "arrow" }))));
  for (const e of g.edges) {
    const a = byName.get(e.from)!, b = byName.get(e.to)!;
    const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2, mx = (x1 + x2) / 2;
    const p = svg("path", { d: `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2 - 2} ${y2}`, class: "edge", "marker-end": "url(#arr)" });
    edgeEls.push({ e, p }); canvas.append(p);
  }
  const paint = () => {
    const name = selected.name;
    const hit = name ? new Set([name, ...impactOf(items, name), ...needsOf(items, name)]) : null;
    const down = new Set(name ? impactOf(items, name) : []);
    const up = new Set(name ? needsOf(items, name) : []);
    for (const [n, node] of nodeEls) {
      node.setAttribute("class", `gnode ${byName.get(n)!.status}${n === name ? " sel" : ""}${down.has(n) ? " down" : ""}${up.has(n) ? " up" : ""}${hit && !hit.has(n) ? " dim" : ""}`);
      node.setAttribute("aria-pressed", String(n === name));
    }
    for (const { e, p } of edgeEls) {
      const on = !!hit && (e.from === name || e.to === name || (hit.has(e.from) && hit.has(e.to)));
      p.setAttribute("class", `edge${on ? " on" : ""}${hit && !on ? " dim" : ""}${down.has(e.to) && on ? " down" : ""}`);
    }
    const title = name ? items.find((m) => m.name === name)?.title ?? name : "";
    caption.textContent = !name ? "Нажмите на модуль, чтобы увидеть, что ему нужно и что сломается, если он остановится."
      : !down.size ? `«${title}»: от него никто не зависит, остановка ничего не затронет.` + (up.size ? ` Ему нужны: ${[...up].join(", ")}.` : "")
      : `Если «${title}» остановится, пострадают: ${[...down].join(", ")}.` + (up.size ? ` Ему самому нужны: ${[...up].join(", ")}.` : "");
  };
  for (const n of g.nodes) {
    const node = svg("g", { transform: `translate(${n.x} ${n.y})`, tabindex: 0, role: "button", "aria-label": `${n.title}: ${STATUS_TEXT[n.status]}` });
    node.append(svg("rect", { width: n.w, height: n.h, rx: 12 }), svg("circle", { cx: 16, cy: n.h / 2, r: 5, class: "dot" }),
      Object.assign(svg("text", { x: 30, y: n.h / 2 - 3, class: "t1" }), { textContent: n.title.length > 20 ? n.title.slice(0, 19) + "…" : n.title }),
      Object.assign(svg("text", { x: 30, y: n.h / 2 + 12, class: "t2" }), { textContent: STATUS_TEXT[n.status] }));
    const pick = () => { selected.name = selected.name === n.name ? null : n.name; paint(); };
    node.addEventListener("click", pick);
    node.addEventListener("keydown", (ev) => { if ((ev as KeyboardEvent).key === "Enter" || (ev as KeyboardEvent).key === " ") { ev.preventDefault(); pick(); } });
    nodeEls.set(n.name, node as SVGGElement); canvas.append(node);
  }
  paint();
  return el("div", { cls: "br-block" }, caption, el("div", { cls: "mod-graph-wrap" }, canvas),
    el("p", { cls: "mod-legend small muted" }, dot("ok"), "работает", dot("warn"), "ждёт", dot("bad"), "сбой", dot("off"), "остановлен", el("span", { cls: "lg-down", textContent: "красная рамка — пострадает" }), el("span", { cls: "lg-up", textContent: "пунктир — нужен ему" })));
}
