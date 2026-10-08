import { el, icon, ICON_NAMES, iconButton } from "../dom";
import { contrast } from "../design/contrast";
import { renderMarkdown } from "../markdown";
import { alert, badge, button, field, input, panel, segmented, switchField, tag } from "../ui";

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** [token, role, text-on token for contrast, min ratio] */
const COLORS: [string, string, string?, number?][] = [
  ["--bg", "Фон страницы", "--fg", 4.5], ["--surface", "Панели, меню", "--fg", 4.5], ["--surface-2", "Пузыри, поле ввода", "--fg", 4.5],
  ["--fg", "Основной текст", "--bg", 4.5], ["--muted", "Вторичный текст", "--bg", 4.5],
  ["--accent", "Главная кнопка", "--accent-fg", 4.5], ["--accent-fg", "Текст на главной кнопке"],
  ["--brand", "Фирменный золотой: кольцо, фокус", "--bg", 3], ["--brand-text", "Золото как текст", "--bg", 4.5], ["--brand-fg", "Текст на золоте"],
  ["--danger", "Ошибка, удаление", "--bg", 4.5], ["--ok", "Успех", "--bg", 4.5], ["--warn", "Предупреждение", "--bg", 4.5], ["--info", "Информация", "--bg", 4.5],
  ["--line", "Границы"], ["--hover", "Наведение"], ["--hover-2", "Активный элемент"],
  ["--code-bg", "Блок кода", "--code-fg", 4.5], ["--code-head", "Шапка блока кода", "--code-muted", 4.5],
];
const SPACING = ["--sp-1", "--sp-2", "--sp-3", "--sp-4", "--sp-5", "--sp-6", "--sp-8", "--sp-10", "--sp-12"];
const RADII = ["--r-sm", "--r-md", "--r-lg", "--r-xl", "--r-pill"];
const SHADOWS = ["--sh-1", "--sh-2", "--sh-3"];
const TYPE: [string, string][] = [["--fs-3xl", "Заголовок экрана"], ["--fs-2xl", "Заголовок страницы"], ["--fs-xl", "Крупный подзаголовок"], ["--fs-lg", "Подзаголовок"], ["--fs-md", "Основной текст"], ["--fs-sm", "Мелкий текст"], ["--fs-xs", "Подписи"]];

function swatch([name, role, on, min]: [string, string, string?, number?]): HTMLElement {
  const value = css(name);
  const ratio = on ? contrast(value, css(on)) : null;
  const pass = ratio !== null && min !== undefined ? ratio >= min : null;
  const chip = el("div", { cls: "swatch-chip", textContent: on ? "Аа" : "" });
  chip.style.background = `var(${name})`;
  if (on) chip.style.color = `var(${on})`;
  return el("div", { cls: "swatch" }, chip, el("div", { cls: "swatch-meta" },
    el("strong", { textContent: name }), el("span", { textContent: role }), el("code", { textContent: value }),
    ratio !== null ? el("span", { cls: pass ? "" : "bad", textContent: `контраст ${ratio.toFixed(1)}:1 ${pass ? "✓ AA" : "✕ ниже нормы"}` }) : null));
}

const SAMPLE_MD = "### Заголовок\n\nОбычный текст с **жирным**, *курсивом*, `кодом` и [ссылкой](https://example.com).\n\n- пункт один\n- пункт два\n\n```ts\nconst answer = 42;\n```";

export function designPage(): HTMLElement {
  const section = (title: string, ...kids: Node[]) => el("section", {}, el("h2", { cls: "section", textContent: title }), ...kids);
  const demo = (...kids: Node[]) => el("div", { cls: "ds-demo" }, ...kids);
  const dis = (b: HTMLButtonElement) => { b.disabled = true; return b; };

  const spacing = el("div", { cls: "stack" }, ...SPACING.map((n) => {
    const bar = el("div", { cls: "ds-space" }); bar.style.width = `var(${n})`;
    return el("div", { cls: "row" }, el("code", { textContent: `${n} · ${css(n)}`, style: "min-width:150px" }), bar);
  }));
  const radii = demo(...RADII.map((n) => { const b = el("div", { cls: "ds-box", textContent: n.replace("--r-", "") }); b.style.borderRadius = `var(${n})`; return b; }));
  const shadows = demo(...SHADOWS.map((n) => { const b = el("div", { cls: "ds-box", textContent: n.replace("--", "") }); b.style.boxShadow = `var(${n})`; b.style.background = "var(--bg)"; return b; }));
  const type = el("div", { cls: "ds-type" }, ...TYPE.map(([n, label]) => { const p = el("p", { textContent: `${label} — ${n} · ${css(n)}` }); p.style.fontSize = `var(${n})`; return p; }));

  return el("div", { cls: "page" },
    el("h1", { textContent: "Дизайн-система" }),
    el("p", { cls: "muted lead", textContent: "Единый источник всех цветов, отступов, шрифтов и компонентов JUUNIBI. Значения ниже читаются из живых токенов и меняются вместе с темой — переключите тему в меню слева. Контраст проверяется тестами (WCAG AA) для светлой и тёмной тем." }),

    section("Принципы", el("ul", { cls: "list" },
      ...["Токены, а не числа: в стилях запрещены «зашитые» цвета и z-index — это проверяет автотест.",
        "Нейтральная основа, золотой акцент только для образа и фокуса.",
        "Контраст текста ≥ 4.5:1, крупных элементов ≥ 3:1 в обеих темах.",
        "Фокус клавиатуры всегда виден; уважаем «уменьшить анимацию».",
        "Один компонент — одно место: классы знает только ui.ts."].map((t) => el("li", { cls: "list-row", textContent: t })))),

    section("Цвета", el("div", { cls: "ds-grid" }, ...COLORS.map(swatch))),
    section("Типографика", el("div", { cls: "panel" }, type)),
    section("Отступы (шаг 4 px)", el("div", { cls: "panel" }, spacing)),
    section("Скругления", radii),
    section("Тени", shadows),

    section("Кнопки",
      demo(button({ label: "Основная", variant: "primary" }), button({ label: "Обычная" }), button({ label: "Призрачная", variant: "ghost" }), button({ label: "Опасная", variant: "danger" }),
        button({ label: "С иконкой", icon: "plus", variant: "primary" }), button({ label: "Малая", size: "sm" }), dis(button({ label: "Отключена", variant: "primary" }))),
      demo(iconButton("copy", "Копировать", () => {}), iconButton("edit", "Изменить", () => {}), iconButton("trash", "Удалить", () => {}), iconButton("refresh", "Обновить", () => {}, "icon-btn sm"))),

    section("Поля и переключатели",
      demo(el("div", { cls: "stack", style: "min-width:260px" }, field({ id: "ds-in", label: "Поле ввода", control: input({ placeholder: "Текст…" }), hint: "Подсказка под полем" }),
        field({ id: "ds-ta", label: "Многострочное", control: el("textarea", { rows: 2, placeholder: "Сообщение…" }) })),
        el("div", { cls: "stack" }, switchField({ id: "ds-sw", label: "Переключатель", checked: true, onChange: () => {} }),
          el("label", { cls: "check", htmlFor: "ds-cb" }, el("input", { type: "checkbox", id: "ds-cb", checked: true }), el("span", { textContent: "Флажок" })),
          segmented({ label: "Пример", options: [["a", "Один"], ["b", "Два"], ["c", "Три"]] as const, value: "b", onChange: () => {} })))),

    section("Метки и уведомления",
      demo(tag("нейтральная"), tag("успех", "ok"), tag("внимание", "warn"), tag("ошибка", "danger"), tag("инфо", "info"), badge("3"), badge("!", "danger")),
      el("div", { cls: "stack" }, alert({ text: "Нейтральное сообщение." }), alert({ tone: "ok", text: "Операция выполнена." }), alert({ tone: "warn", text: "Проверьте настройки перед продолжением." }),
        alert({ tone: "danger", text: "Не удалось подключиться к серверу." }), alert({ tone: "info", text: "Доступна новая версия." }))),

    section("Карточки и списки",
      el("div", { cls: "grid" },
        el("div", { cls: "stat good" }, el("div", { cls: "stat-head" }, icon("chat", 18), el("h2", { textContent: "Статус" })), el("p", { cls: "stat-value", textContent: "Подключён" }), el("p", { cls: "muted", textContent: "Подпись под значением" })),
        panel("Панель", el("p", { cls: "muted", textContent: "Контейнер для группы настроек." })),
        el("ul", { cls: "list" }, el("li", { cls: "list-row" }, el("span", { cls: "grow", textContent: "Строка списка" }), tag("ok", "ok")), el("li", { cls: "list-row" }, el("span", { cls: "grow", textContent: "Ещё строка" }), iconButton("trash", "Удалить", () => {}, "icon-btn sm")))),
      demo(el("progress", { cls: "progress", max: 100, value: 62, style: "width:260px", attrs: { "aria-label": "Пример прогресса" } }), el("span", { cls: "muted" }, "Горячие клавиши: ", el("kbd", { cls: "kbd", textContent: "Ctrl" }), " + ", el("kbd", { cls: "kbd", textContent: "K" })))),

    section("Текст ответа (Markdown)", el("div", { cls: "panel" }, (() => { const p = el("div", { cls: "prose" }); p.append(renderMarkdown(SAMPLE_MD)); return p; })())),

    section("Иконки", el("div", { cls: "ds-icons" }, ...ICON_NAMES.map((n) => el("div", { cls: "ds-icon" }, icon(n, 22), el("span", { textContent: n }))))));
}
