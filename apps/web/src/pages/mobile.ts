/** «Мобильное приложение»: open JUUNIBI on a phone over the home Wi-Fi (switch, QR pairing, paired devices). */
import { api, type MobileStatus } from "../api";
import { el, icon } from "../dom";
import { showToast } from "../toast";
import { whenShort } from "./brain-model";
import { btn, dot, emptyState, pageHead, section } from "./kit";
import "./mobile.css";

/** The address picked when the computer has more than one network (kept across re-renders). */
const UI = { ip: "" };
const fmtCode = (c: string) => c.slice(0, 4) + " " + c.slice(4);
const time = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

export function mobilePage(): HTMLElement {
  let st: MobileStatus | null = null;
  let error = "";
  let busy = false;
  let sig = "";
  const body = el("div", { attrs: { "aria-live": "polite" } }, el("p", { cls: "muted", textContent: "Загрузка…" }));
  const root = el("div", { cls: "page mob-page" },
    pageHead("phone", "Мобильное приложение", "JUUNIBI на телефоне через домашний Wi-Fi: тот же чат, дела и память, что и на компьютере."), body);

  const apply = (r: Awaited<ReturnType<typeof api.mobile>>) => {
    if (r.ok) { st = r.value; error = ""; } else error = r.error.message;
    render();
  };
  const act = async (run: () => ReturnType<typeof api.mobile>, done?: string) => {
    if (busy) return;
    busy = true; sig = ""; render();
    const r = await run();
    busy = false; sig = "";
    if (!r.ok) showToast(r.error.message); else if (done) showToast(done);
    apply(r);
  };

  const accessCard = (s: MobileStatus) => {
    const input = el("input", { type: "checkbox", checked: s.enabled, disabled: busy, attrs: { role: "switch" } });
    input.addEventListener("change", () => void act(() => api.mobileEnable(input.checked), input.checked ? "Доступ по Wi-Fi открыт" : "Доступ по Wi-Fi закрыт"));
    const state = s.error ? [dot("bad"), s.error]
      : s.running ? [dot("ok"), `Работает: телефоны в вашей сети могут подключиться (порт ${s.port}).`]
      : s.enabled ? [dot("warn"), "Включается…"]
      : [dot("off"), "Выключено: JUUNIBI открывается только на этом компьютере."];
    return section("Доступ по Wi-Fi",
      el("label", { cls: "set-row switch-row mob-first" },
        el("span", { cls: "grow" }, el("strong", { textContent: "Открыть доступ с телефона" }), el("small", { cls: "muted", textContent: "Подключиться смогут только устройства, которые вы добавите по коду." })),
        el("span", { cls: "switch" }, input)),
      el("p", { cls: "mob-state" }, ...state));
  };

  const pairCard = (s: MobileStatus) => {
    if (!s.addresses.length) return section("Подключить телефон", emptyState("alert", "Нет подключения к сети", "Компьютер сейчас не в локальной сети. Подключите его к домашнему Wi-Fi или роутеру, и адрес появится здесь."));
    if (!s.addresses.some((a) => a.ip === UI.ip)) UI.ip = s.addresses[0]!.ip;
    const url = `http://${UI.ip}:${s.port}`;
    const pick = s.addresses.length > 1 ? (() => {
      const sel = el("select", { cls: "mem-select", attrs: { "aria-label": "Сеть" } }, ...s.addresses.map((a) => el("option", { value: a.ip, textContent: `${a.ip} · ${a.iface}` })));
      sel.value = UI.ip;
      sel.addEventListener("change", () => { UI.ip = sel.value; sig = ""; render(); });
      return el("label", { cls: "mob-net" }, el("small", { cls: "muted", textContent: "Сеть, в которой телефон" }), sel);
    })() : null;
    const qr = el("img", { cls: "mob-qr", src: `/api/mobile/qr.svg?ip=${encodeURIComponent(UI.ip)}&v=${s.code ?? ""}`, alt: "QR-код для подключения телефона", width: 220, height: 220 });
    return section("Подключить телефон",
      el("div", { cls: "mob-pair" },
        el("div", { cls: "mob-qr-box" }, qr,
          el("div", { cls: "mob-code" }, el("small", { cls: "muted", textContent: "Код для ручного ввода" }),
            el("strong", { textContent: s.code ? fmtCode(s.code) : "—" }),
            el("small", { cls: "muted", textContent: s.codeExpiresAt ? `одноразовый, действует до ${time(s.codeExpiresAt)}` : "" })),
          btn("Новый код", () => void act(() => api.mobileNewCode(), "Старый код больше не действует"), { small: true, icon: "refresh", disabled: busy })),
        el("div", { cls: "mob-steps" },
          pick,
          el("ol", {},
            el("li", {}, "Подключите телефон к тому же Wi-Fi, что и компьютер."),
            el("li", {}, "Наведите камеру телефона на QR-код и откройте ссылку. Или откройте в браузере телефона адрес ", el("code", { textContent: url }), " и введите код."),
            el("li", {}, el("strong", { textContent: "Как приложение: " }), "в Chrome на Android — меню ⋮ → «Добавить на главный экран»; в Safari на iPhone — «Поделиться» → «На экран „Домой“». На iPhone значок открывается отдельно от Safari, поэтому в нём введите код ещё раз.")),
          el("p", { cls: "muted small mob-hint" }, icon("help", 16), "Телефон не открывает адрес? Windows могла спросить, разрешить ли Node.js доступ к сети: разрешите для частных сетей. Адрес компьютера может смениться после перезагрузки роутера, тогда отсканируйте код заново."))));
  };

  const devicesCard = (s: MobileStatus) => section("Подключённые устройства",
    s.devices.length
      ? el("ul", { cls: "mob-devices" }, ...[...s.devices].reverse().map((d) => el("li", {},
          el("span", { cls: "mob-dev-icon" }, icon("phone", 18)),
          el("span", { cls: "grow" }, el("strong", { textContent: d.name }), el("small", { cls: "muted", textContent: `подключено ${whenShort(d.pairedAt)} · в сети ${whenShort(d.lastSeen)}` })),
          btn("Отключить", () => void act(() => api.mobileRevoke(d.id), `${d.name} отключено`), { small: true, danger: true, disabled: busy }))))
      : el("p", { cls: "muted", textContent: "Пока ни одного. Устройство появится здесь после ввода кода." }),
    s.devices.length > 1 ? el("div", { cls: "mob-actions" }, btn("Отключить все", () => { if (confirm("Отключить все устройства? Им понадобится новый код.")) void act(() => api.mobileRevoke(), "Все устройства отключены"); }, { small: true, danger: true, disabled: busy })) : null);

  const safetyCard = () => section("Безопасность",
    el("ul", { cls: "mob-safety" },
      el("li", {}, "Работает только внутри вашей сети: из интернета JUUNIBI не видна."),
      el("li", {}, "Без кода с этого компьютера телефон не увидит ничего. Код одноразовый и меняется после нескольких неверных попыток."),
      el("li", {}, "Соединение без шифрования (HTTP), поэтому включайте доступ дома, а не в кафе или гостинице."),
      el("li", {}, "Открыть доступ, показать код и отключить устройства можно только на этом компьютере.")));

  function render() {
    const next = JSON.stringify([st, error, busy, UI.ip]);
    if (next === sig) return;
    sig = next;
    if (!st) { body.replaceChildren(error ? emptyState("alert", "Раздел недоступен", error) : el("p", { cls: "muted", textContent: "Загрузка…" })); return; }
    body.replaceChildren(accessCard(st), ...(st.enabled && st.running ? [pairCard(st)] : []), devicesCard(st), safetyCard());
  }

  void api.mobile().then(apply);
  // The code is single-use: refresh so a fresh QR shows up as soon as a phone used the old one.
  const timer = setInterval(() => {
    if (!root.isConnected) { clearInterval(timer); return; }
    if (!busy && document.visibilityState === "visible") void api.mobile().then(apply);
  }, 3000);
  return root;
}
