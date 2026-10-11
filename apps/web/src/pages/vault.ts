/**
 * «Пароли»: logins, passwords and mail behind one master password. The records are encrypted on the server
 * (vault.ts) and shown only while the vault is open; it closes by itself after a few idle minutes.
 * The assistant never sees them, and the page works only on the computer itself.
 */
import { api, type VaultItem, type VaultStatus } from "../api";
import { el, icon, iconButton } from "../dom";
import { showToast } from "../toast";
import { btn, emptyState, pageHead } from "./kit";
import { filterItems, generatePassword, passwordStrength, safeUrl } from "./vault-model";
import "./vault.css";

const CLEAR_MS = 30_000;
const FIELDS: [keyof VaultItem, string, string][] = [["login", "Логин", "user"], ["email", "Почта", "mail@example.ru"], ["url", "Сайт", "gosuslugi.ru"]];

/** Copies text; over plain http (the phone) the old way is used. A copied password is wiped from the clipboard later. */
async function copy(text: string, what: string, secret = false) {
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch {
    const t = el("textarea", { value: text, attrs: { readonly: "", "aria-hidden": "true" } });
    t.style.cssText = "position:fixed;opacity:0;top:0;left:0";
    document.body.append(t); t.select();
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    t.remove();
  }
  if (!ok) { showToast("Не удалось скопировать: выделите текст вручную."); return; }
  showToast(secret ? `${what} скопирован. Через 30 секунд уберу его из буфера.` : `${what}: скопировано`, { ms: 3000 });
  if (secret) setTimeout(() => { void navigator.clipboard?.readText?.().then((cur) => { if (cur === text) void navigator.clipboard.writeText(""); }).catch(() => { void navigator.clipboard?.writeText("").catch(() => {}); }); }, CLEAR_MS);
}

export function vaultPage(deps: { back(): void }): HTMLElement {
  let st: VaultStatus | null = null;
  let items: VaultItem[] = [];
  let error = "";
  let query = "";
  /** The record being edited ("new" for a new one) and the passwords shown in clear. */
  let editing: string | null = null;
  const shown = new Set<string>();
  let settingsOpen = false;
  const body = el("div", { cls: "vault-body", attrs: { "aria-live": "polite" } }, el("p", { cls: "muted", textContent: "Загрузка…" }));
  const lockBtn = btn("Закрыть", () => void lock(), { small: true, icon: "lock", title: "Закрыть пароли сейчас" });
  lockBtn.hidden = true;
  const root = el("div", { cls: "page vault-page" },
    pageHead("lock", "Пароли", "Логины, пароли и почта под одним мастер-паролем. Хранятся зашифрованными только на этом компьютере, помощница их не видит.",
      el("div", { cls: "row" }, btn("К делам", () => deps.back(), { small: true, icon: "chevronLeft" }), lockBtn)),
    body);

  const load = async () => {
    const s = await api.vault();
    if (!s.ok) { error = s.error.message; st = null; render(); return; }
    st = s.value; error = "";
    if (st.unlocked) {
      const r = await api.vaultItems();
      if (r.ok) items = r.value; else { items = []; const again = await api.vault(); if (again.ok) st = again.value; }
    } else { items = []; shown.clear(); editing = null; }
    render();
  };
  /** Runs a change; when the vault closed meanwhile, the lock screen comes back. */
  const act = async (run: () => Promise<{ ok: boolean; error?: { message: string } }>, done?: string) => {
    const r = await run();
    if (!r.ok) showToast(r.error?.message ?? "Не получилось", { ms: 6000 });
    else if (done) showToast(done, { ms: 2500 });
    await load();
    return r.ok;
  };
  const lock = async () => { await api.vaultLock(); items = []; shown.clear(); editing = null; showToast("Пароли закрыты"); await load(); };

  // the vault closes on the server after idle minutes: look now and then, and hide everything when it did
  const poll = setInterval(() => {
    if (!root.isConnected) { clearInterval(poll); return; }
    if (st?.unlocked) void api.vault().then((r) => { if (r.ok && !r.value.unlocked) { st = r.value; items = []; shown.clear(); editing = null; render(); } });
  }, 20_000);

  function passwordField(value: string, label: string, autocomplete: string): { wrap: HTMLElement; input: HTMLInputElement } {
    const input = el("input", { type: "password", value, cls: "mem-input", attrs: { "aria-label": label, autocomplete, spellcheck: "false" } });
    const eye = iconButton("eye", "Показать", () => {
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      eye.replaceChildren(icon(show ? "eyeOff" : "eye", 16));
      eye.title = show ? "Скрыть" : "Показать";
      eye.setAttribute("aria-label", eye.title);
    }, "icon-btn sm");
    return { wrap: el("div", { cls: "vault-pw" }, input, eye), input };
  }

  function render() {
    lockBtn.hidden = !st?.unlocked;
    if (error) {
      body.replaceChildren(emptyState("lock", error.includes("компьютере") ? "Только на компьютере" : "Пароли недоступны", error.includes("компьютере") ? "Пароли не передаются по Wi-Fi: откройте их в JUUNIBI на компьютере." : error,
        btn("Повторить", () => void load(), { small: true })));
      return;
    }
    if (!st) return;
    if (!st.exists) return renderSetup();
    if (!st.unlocked) return renderUnlock();
    renderList();
  }

  function renderSetup() {
    const a = passwordField("", "Мастер-пароль", "new-password");
    const b = passwordField("", "Мастер-пароль ещё раз", "new-password");
    const meter = el("div", { cls: "vault-meter" }, el("i"), el("span"));
    const sync = () => { const s = passwordStrength(a.input.value); meter.dataset.score = String(s.score); meter.querySelector("span")!.textContent = s.label; meter.hidden = !a.input.value; };
    a.input.addEventListener("input", sync); sync();
    const create = btn("Создать хранилище", async () => {
      if (a.input.value.length < 8) { showToast("Мастер-пароль: не короче 8 символов."); a.input.focus(); return; }
      if (a.input.value !== b.input.value) { showToast("Пароли не совпадают."); b.input.focus(); return; }
      create.disabled = true;
      if (!(await act(() => api.vaultSetup(a.input.value), "Хранилище создано и открыто"))) create.disabled = false;
    }, { primary: true, icon: "lock" });
    const f = el("form", { cls: "pg-card vault-gate" },
      el("span", { cls: "vault-gate-ic", attrs: { "aria-hidden": "true" } }, icon("shield", 30)),
      el("h2", { textContent: "Придумайте мастер-пароль" }),
      el("ul", { cls: "vault-facts small" },
        el("li", { textContent: "Им шифруются все записи. Без него их не откроет никто, даже JUUNIBI." }),
        el("li", { textContent: "Восстановить забытый мастер-пароль нельзя: запишите его на бумаге и храните дома." }),
        el("li", { textContent: "Пароли открываются только на этом компьютере и закрываются сами через 5 минут без дела." })),
      el("label", {}, el("span", { textContent: "Мастер-пароль" }), a.wrap), meter,
      el("label", {}, el("span", { textContent: "Ещё раз" }), b.wrap),
      create);
    f.addEventListener("submit", (e) => { e.preventDefault(); create.click(); });
    body.replaceChildren(f);
    queueMicrotask(() => a.input.focus());
  }

  function renderUnlock() {
    const p = passwordField("", "Мастер-пароль", "current-password");
    const open = btn("Открыть", async () => {
      if (!p.input.value) { p.input.focus(); return; }
      open.disabled = true;
      const r = await api.vaultUnlock(p.input.value);
      p.input.value = "";
      if (!r.ok) { showToast(r.error.message, { ms: 6000 }); open.disabled = false; p.input.focus(); return; }
      await load();
    }, { primary: true, icon: "key" });
    const f = el("form", { cls: "pg-card vault-gate" },
      el("span", { cls: "vault-gate-ic", attrs: { "aria-hidden": "true" } }, icon("lock", 30)),
      el("h2", { textContent: "Пароли закрыты" }),
      el("p", { cls: "muted small", textContent: st?.waitSeconds ? `Слишком много попыток. Подождите ${st.waitSeconds} с.` : "Введите мастер-пароль, чтобы открыть записи." }),
      p.wrap, open);
    f.addEventListener("submit", (e) => { e.preventDefault(); open.click(); });
    body.replaceChildren(f);
    queueMicrotask(() => p.input.focus());
  }

  function editor(item: VaultItem | null): HTMLElement {
    const title = el("input", { type: "text", maxLength: 100, value: item?.title ?? "", cls: "mem-input", placeholder: "Например: Почта Яндекс", attrs: { "aria-label": "Название", autocomplete: "off" } });
    const fields = FIELDS.map(([k, label, ph]) => ({ k, input: el("input", { type: k === "email" ? "email" : "text", maxLength: k === "url" ? 500 : 200, value: (item?.[k] as string | undefined) ?? "", cls: "mem-input", placeholder: ph, attrs: { "aria-label": label, autocomplete: "off", spellcheck: "false" } }), label }));
    const pw = passwordField(item?.password ?? "", "Пароль", "new-password");
    const meter = el("div", { cls: "vault-meter" }, el("i"), el("span"));
    const sync = () => { const s = passwordStrength(pw.input.value); meter.dataset.score = String(s.score); meter.querySelector("span")!.textContent = s.label; meter.hidden = !pw.input.value; };
    pw.input.addEventListener("input", sync); sync();
    const gen = btn("Придумать", () => { pw.input.value = generatePassword(16); pw.input.type = "text"; sync(); }, { small: true, icon: "wand", title: "Случайный пароль из 16 символов" });
    const note = el("textarea", { maxLength: 2000, value: item?.note ?? "", cls: "mem-input", rows: 3, placeholder: "Ответ на секретный вопрос, коды восстановления…", attrs: { "aria-label": "Заметка" } });
    const close = () => { editing = null; render(); };
    const save = btn(item ? "Сохранить" : "Добавить", async () => {
      if (!title.value.trim()) { showToast("Укажите название."); title.focus(); return; }
      save.disabled = true;
      const rec: Partial<VaultItem> = { title: title.value.trim(), password: pw.input.value, note: note.value };
      for (const f of fields) (rec as Record<string, string>)[f.k] = f.input.value.trim();
      const ok = await act(() => item ? api.vaultUpdate(item.id, rec) : api.vaultAdd(rec), item ? "Сохранено" : "Запись добавлена");
      if (ok) { editing = null; render(); } else save.disabled = false;
    }, { small: true, primary: true });
    const f = el("form", { cls: "pg-card vault-editor" },
      el("label", { cls: "wide" }, el("span", { textContent: "Название" }), title),
      ...fields.map((x) => el("label", {}, el("span", { textContent: x.label }), x.input)),
      el("label", { cls: "wide" }, el("span", { textContent: "Пароль" }), el("div", { cls: "vault-pw-row" }, pw.wrap, gen), meter),
      el("label", { cls: "wide" }, el("span", { textContent: "Заметка" }), note),
      el("div", { cls: "row wide" }, save, btn("Отмена", close, { small: true })));
    f.addEventListener("submit", (e) => { e.preventDefault(); save.click(); });
    f.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); close(); } });
    queueMicrotask(() => title.focus());
    return f;
  }

  function card(x: VaultItem): HTMLElement {
    if (editing === x.id) return editor(x);
    const link = safeUrl(x.url);
    const line = (label: string, value: string | undefined, secret = false) => {
      if (!value) return null;
      const show = !secret || shown.has(x.id);
      return el("div", { cls: "vault-line" },
        el("span", { cls: "vault-k", textContent: label }),
        el("span", { cls: "vault-v" + (secret ? " secret" : ""), textContent: show ? value : "•".repeat(Math.min(12, Math.max(8, value.length))) }),
        secret ? iconButton(show ? "eyeOff" : "eye", show ? "Скрыть пароль" : "Показать пароль", () => { if (shown.has(x.id)) shown.delete(x.id); else shown.add(x.id); render(); }, "icon-btn sm") : null,
        iconButton("copy", "Скопировать: " + label.toLowerCase(), () => void copy(value, label, secret), "icon-btn sm"));
    };
    return el("article", { cls: "pg-card vault-card" },
      el("div", { cls: "vault-card-head" },
        el("span", { cls: "vault-avatar", attrs: { "aria-hidden": "true" }, textContent: x.title.trim()[0]?.toUpperCase() ?? "•" }),
        el("div", { cls: "grow vault-title" }, el("strong", { textContent: x.title }),
          link ? el("a", { href: link, target: "_blank", rel: "noopener noreferrer", cls: "small", textContent: new URL(link).host }) : null),
        iconButton("edit", "Изменить: " + x.title, () => { editing = x.id; render(); }, "icon-btn sm"),
        iconButton("trash", "Удалить: " + x.title, () => {
          if (!confirm(`Удалить запись «${x.title}»? Вернуть её будет нельзя.`)) return;
          void act(() => api.vaultRemove(x.id), "Запись удалена");
        }, "icon-btn sm")),
      line("Логин", x.login), line("Почта", x.email), line("Пароль", x.password, true),
      x.note ? el("p", { cls: "vault-note small", textContent: x.note }) : null);
  }

  function settingsBox(): HTMLElement {
    const box = el("details", { cls: "pg-card vault-settings", open: settingsOpen });
    box.addEventListener("toggle", () => { settingsOpen = box.open; });
    const minutes = el("select", { cls: "mem-select", attrs: { "aria-label": "Закрывать пароли через" } }, ...[1, 5, 15, 30].map((m) => el("option", { value: String(m), textContent: `через ${m} мин без дела` })));
    minutes.value = String(st?.lockMinutes ?? 5);
    minutes.addEventListener("change", () => void act(() => api.vaultSettings(Number(minutes.value)), "Сохранено"));
    const oldPw = passwordField("", "Текущий мастер-пароль", "current-password");
    const newPw = passwordField("", "Новый мастер-пароль", "new-password");
    const change = btn("Сменить мастер-пароль", async () => {
      if (newPw.input.value.length < 8) { showToast("Новый мастер-пароль: не короче 8 символов."); newPw.input.focus(); return; }
      change.disabled = true;
      if (await act(() => api.vaultPassword(oldPw.input.value, newPw.input.value), "Мастер-пароль сменён")) { oldPw.input.value = newPw.input.value = ""; }
      change.disabled = false;
    }, { small: true });
    const file = el("input", { type: "file", accept: ".juunibi-vault,application/json", attrs: { "aria-label": "Файл копии паролей" } });
    file.hidden = true;
    const restorePw = passwordField("", "Мастер-пароль копии", "current-password");
    const restore = btn("Восстановить из копии…", () => file.click(), { small: true, icon: "arrowUp" });
    file.addEventListener("change", async () => {
      const f = file.files?.[0];
      file.value = "";
      if (!f) return;
      if (!restorePw.input.value) { showToast("Сначала введите мастер-пароль копии."); restorePw.input.focus(); return; }
      if (!confirm("Записи из копии заменят текущие. Продолжить?")) return;
      await act(async () => api.vaultImport(await f.text(), restorePw.input.value), "Пароли восстановлены из копии");
      restorePw.input.value = "";
    });
    box.append(el("summary", {}, icon("settings", 16), el("span", { textContent: "Защита и копия" })),
      el("div", { cls: "vault-set-rows" },
        el("label", { cls: "vault-set-row" }, el("span", { cls: "grow" }, el("span", { textContent: "Закрывать пароли" }), el("small", { cls: "muted", textContent: "после стольких минут без действий на этой странице" })), minutes),
        el("div", { cls: "vault-set-row col" }, el("span", { textContent: "Мастер-пароль" }), el("div", { cls: "vault-set-fields" }, oldPw.wrap, newPw.wrap, change)),
        el("div", { cls: "vault-set-row col" }, el("span", { cls: "grow" }, el("span", { textContent: "Копия" }), el("small", { cls: "muted", textContent: "Файл зашифрован тем же мастер-паролем. Храните его на флешке или в облаке." })),
          el("div", { cls: "vault-set-fields" },
            el("a", { cls: "btn sm", href: "/api/vault/export", attrs: { download: "JUUNIBI-passwords.juunibi-vault" } }, icon("download", 16), "Скачать копию"),
            restorePw.wrap, restore, file))));
    return box;
  }

  function renderList() {
    const search = el("input", { type: "search", value: query, cls: "mem-search", placeholder: "Поиск по названию, логину, сайту", attrs: { "aria-label": "Поиск по паролям" } });
    search.addEventListener("input", () => { query = search.value; paint(); });
    const add = btn("Добавить", () => { editing = "new"; render(); }, { primary: true, icon: "plus", small: true });
    const listHost = el("div", { cls: "vault-list" });
    const paint = () => {
      const list = filterItems(items, query);
      listHost.replaceChildren(...(list.length ? list.map(card)
        : [items.length ? emptyState("search", "Ничего не найдено", "Измените запрос.") : emptyState("key", "Записей пока нет", "Добавьте первую: почта, Госуслуги, Wi-Fi дома, банк. Пароль можно придумать кнопкой «Придумать».")]));
    };
    paint();
    body.replaceChildren(
      el("div", { cls: "vault-tools" }, search, el("span", { cls: "grow" }), el("small", { cls: "muted", textContent: `записей: ${items.length}` }), add),
      ...(editing === "new" ? [editor(null)] : []),
      listHost, settingsBox());
  }

  void load();
  return root;
}
