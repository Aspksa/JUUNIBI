/** Panels that open in a window from the Brain hub: assistant quality. */
import { api, type EvalStatus, type QualityReport } from "../api";
import { el } from "../dom";
import { block, empty, fold, progress, tag, tile, when } from "./brain-ui";
import { plural } from "./brain-model";
import { btn } from "./kit";

/** replaceChildren that tolerates null (a section that does not apply). */
const put = (host: HTMLElement, ...nodes: (Node | null)[]) => host.replaceChildren(...nodes.filter((n): n is Node => !!n));

// ---------- quality ----------
const dayLabel = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
export function qualityPanel(onChange: () => void): HTMLElement {
  const root = block("Качество помощницы", null, empty("Загрузка…"));
  const evalBox = el("div", { cls: "br-sub", attrs: { "aria-live": "polite" } });
  let timer: ReturnType<typeof setTimeout> | undefined;

  const renderEval = (s: EvalStatus) => {
    const start = btn(s.running ? "Идёт проверка…" : "Запустить проверку", async () => {
      if (!confirm(`Помощнице будет задано ${s.cases.length} контрольных вопросов. Это расходует токены Cloud.ru (обычно немного). Продолжить?`)) return;
      start.disabled = true;
      const r = await api.evalStart();
      if (!r.ok) { alert(r.error.message); }
      void pollEval();
    }, { primary: true, small: true, disabled: s.running });
    const cmp = s.compare;
    const diff = cmp && cmp.delta !== null
      ? el("p", { cls: cmp.regressed.length ? "mod-error" : "flash", textContent:
        (cmp.sameSetup ? "" : "Изменились модель или инструкции — сравнение приблизительное. ") +
        (cmp.delta === 0 && !cmp.improved.length && !cmp.regressed.length ? "Без изменений по сравнению с прошлым разом." : `${cmp.delta > 0 ? "Лучше" : cmp.delta < 0 ? "Хуже" : "По числу то же"}${cmp.delta ? ` на ${Math.abs(cmp.delta)}` : ""}.`) +
        (cmp.regressed.length ? " Стало хуже: " + cmp.regressed.map((id) => s.last?.results.find((r) => r.id === id)?.title ?? id).join(", ") + "." : "") +
        (cmp.improved.length ? " Стало лучше: " + cmp.improved.map((id) => s.last?.results.find((r) => r.id === id)?.title ?? id).join(", ") + "." : "") }) : null;
    put(evalBox, 
      el("h3", { textContent: "Контрольные вопросы" }),
      el("p", { cls: "muted small", textContent: "Запустите после смены модели или инструкций: проверка покажет, не стало ли хуже. Следов в истории чатов и памяти она не оставляет и никаких действий не выполняет." }),
      el("div", { cls: "br-row" }, start),
      s.running && s.progress ? progress(s.progress.done, s.progress.total, "Проверка") : null,
      s.error ? el("p", { cls: "mod-error", textContent: s.error }) : null,
      s.last ? el("div", { cls: "br-tiles" }, tile("Последняя проверка", `${s.last.passed} из ${s.last.total}`, `${when(s.last.at)} · ${s.last.model.split("/").pop()}`, s.last.passed === s.last.total ? "ok" : s.last.passed >= s.last.total * 0.7 ? "warn" : "off")) : null,
      diff,
      s.last ? el("ul", { cls: "eval-list" }, ...s.last.results.map((r) => el("li", { cls: r.passed ? "ok" : "bad" },
        el("span", { cls: "eval-mark", textContent: r.passed ? "✓" : "✕", attrs: { "aria-label": r.passed ? "пройден" : "не пройден" } }),
        el("div", {}, el("strong", { textContent: r.title }), el("span", { cls: "muted small", textContent: r.error ? "ошибка: " + r.error : r.answer ? "ответ: " + r.answer.replace(/\s+/g, " ").slice(0, 140) : "" }))))) : el("p", { cls: "br-empty muted", textContent: "Проверка ещё не запускалась." }));
  };
  const pollEval = async () => {
    clearTimeout(timer);
    const r = await api.evalStatus();
    if (!r.ok) { put(evalBox, empty("Проверка недоступна: " + r.error.message)); return; }
    renderEval(r.value);
    if (r.value.running) timer = setTimeout(() => { if (root.isConnected) void pollEval(); }, 2000); else onChange();
  };

  const renderReport = (q: QualityReport) => {
    const max = Math.max(1, ...q.byDay.map((d) => d.up + d.down));
    const bars = el("div", { cls: "q-bars", attrs: { role: "img", "aria-label": "Оценки за 14 дней" } }, ...q.byDay.map((d) => {
      const col = el("div", { cls: "q-col", title: `${dayLabel(d.day)}: 👍 ${d.up}, 👎 ${d.down}` });
      const up = el("i", { cls: "q-up" }), down = el("i", { cls: "q-down" });
      up.style.height = (60 * d.up) / max + "px"; down.style.height = (60 * d.down) / max + "px";
      col.append(up, down, el("span", { textContent: String(new Date(d.day + "T00:00:00").getDate()) }));
      return col;
    }));
    const download = el("a", { href: "/api/dataset", download: "juunibi-dataset.jsonl", cls: "btn sm", textContent: `Скачать набор для дообучения (${q.datasetReady})` });
    put(root, 
      el("header", { cls: "br-block-head" }, el("p", { cls: "muted", textContent: "Строится по вашим 👍 и 👎 в чате. Чем больше оценок, тем точнее картина." })),
      el("div", { cls: "br-tiles" },
        tile("Довольны", q.totals.satisfaction === null ? "—" : q.totals.satisfaction + "%", q.totals.rated ? `из ${q.totals.rated} ${plural(q.totals.rated, ["оценки", "оценок", "оценок"])}` : "оценок пока нет", q.totals.satisfaction === null ? "off" : q.totals.satisfaction >= 70 ? "ok" : "warn"),
        tile("👍", String(q.totals.up)), tile("👎", String(q.totals.down)), tile("Без оценки", String(q.totals.unrated), `всего ответов: ${q.totals.turns}`)),
      el("div", { cls: "br-sub" }, el("h3", { textContent: "Последние 14 дней" }), bars),
      q.byTool.length ? el("div", { cls: "br-sub" }, el("h3", { textContent: "По инструментам" }), el("ul", { cls: "br-links" }, ...q.byTool.map((t) => el("li", {},
        el("strong", { textContent: t.tool }), tag(`${t.uses} раз`), t.satisfaction === null ? el("span", { cls: "muted", textContent: "оценок нет" }) : tag(`${t.satisfaction}% довольны`, t.satisfaction < 50 ? "bad" : t.satisfaction < 80 ? "warn" : "ok"))))) : null,
      q.troubleWords.length ? el("div", { cls: "br-sub" }, el("h3", { textContent: "Где чаще ошибается" }),
        el("p", { cls: "muted small", textContent: "Слова, которые чаще встречаются в вопросах с 👎, чем с 👍." }),
        el("div", { cls: "chips" }, ...q.troubleWords.map((w) => el("span", { cls: "br-chip" }, w.word, el("b", { textContent: `${w.down}👎` }))))) : null,
      q.worst.length ? fold(`Последние неудачные ответы · ${q.worst.length}`, el("ul", { cls: "q-worst" }, ...q.worst.map((w) => el("li", {},
        el("strong", { textContent: w.user }), el("span", { cls: "muted small", textContent: w.reply }), el("span", { cls: "muted small", textContent: when(w.at) + (w.tools.length ? " · " + w.tools.join(", ") : "") }))))) : null,
      el("div", { cls: "br-sub" }, el("h3", { textContent: "Дообучение" }),
        el("p", { cls: "muted small", textContent: "Набор состоит из ответов с 👍. Ключи, почта, телефоны и пароли в нём замаскированы. Само дообучение JUUNIBI не запускает: это решение за вами и требует доступа к Cloud.ru." }),
        el("div", { cls: "br-row" }, download)),
      evalBox);
    void pollEval();
  };
  void api.quality().then((r) => { if (r.ok) renderReport(r.value); else put(root, empty("Не удалось загрузить: " + r.error.message)); });
  return root;
}
