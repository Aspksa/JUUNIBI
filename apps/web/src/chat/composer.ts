import { attempt } from "@juunibi/core";
import { el, icon, iconButton } from "../dom";
import { MAX_FILE_BYTES, checkFile, formatBytes, looksBinary, parseCommand, suggestCommands, type Attachment, type Command } from "./helpers";
import { Dictation, dictationSupported } from "./voice";

const DRAFTS_KEY = "juunibi:drafts:v1";
const ACCEPT = ".txt,.md,.json,.csv,.log,.js,.ts,.tsx,.jsx,.py,.html,.css,.xml,.yml,.yaml,.toml,.ini,.sql,.sh,.bat,.java,.c,.cpp,.cs,.go,.rs,.php,.rb,text/*";

export interface ComposerHandlers {
  onSubmit(text: string, files: Attachment[]): void;
  onCommand(command: Command, arg: string): void;
  onStop(): void;
  onEditLast(): void;
  /** Owner-defined quick commands (re-read on every keystroke, so a new one works at once). */
  quick?(): Command[];
}

/** Message input: auto-grow, drafts per chat, slash-command palette, text-file attachments, dictation. */
export class Composer {
  readonly root: HTMLElement;
  readonly input: HTMLTextAreaElement;
  private readonly send: HTMLButtonElement;
  private readonly attach: HTMLButtonElement;
  private readonly mic: HTMLButtonElement | null = null;
  private readonly chips: HTMLElement;
  private readonly palette: HTMLElement;
  private readonly note: HTMLElement;
  private readonly interim: HTMLElement;
  private readonly fileInput: HTMLInputElement;
  private files: Attachment[] = [];
  private busy = false;
  private configured = true;
  private paletteItems: Command[] = [];
  private sel = 0;
  private convId: string | null = null;
  private draftTimer: ReturnType<typeof setTimeout> | undefined;
  private dictation: Dictation | null = null;

  constructor(private readonly h: ComposerHandlers) {
    this.input = el("textarea", { rows: 1, placeholder: "Напишите сообщение JUUNIBI", cls: "composer-input", maxLength: 100000, attrs: { "aria-label": "Сообщение", "aria-autocomplete": "list", "aria-controls": "cmd-palette" } });
    this.send = el("button", { type: "submit", cls: "send-btn" });
    this.attach = iconButton("paperclip", "Прикрепить текстовые файлы (или перетащите в окно)", () => this.fileInput.click());
    this.fileInput = el("input", { type: "file", multiple: true, accept: ACCEPT, hidden: true, attrs: { "aria-hidden": "true", tabindex: "-1" } });
    this.fileInput.addEventListener("change", () => { void this.addFiles(this.fileInput.files); this.fileInput.value = ""; });
    this.chips = el("div", { cls: "chips-row" });
    this.note = el("div", { cls: "composer-note", attrs: { role: "status", "aria-live": "polite" } });
    this.interim = el("div", { cls: "interim", hidden: true });
    this.palette = el("ul", { cls: "palette", hidden: true, attrs: { role: "listbox", id: "cmd-palette", "aria-label": "Команды" } });

    const tools: HTMLElement[] = [this.attach];
    if (dictationSupported()) {
      this.mic = iconButton("mic", "Диктовка. Распознавание выполняет браузер; в Chrome и Edge звук обрабатывается на серверах Google/Microsoft", () => this.dictation?.toggle());
      this.dictation = new Dictation({
        onText: (t) => this.insert(t),
        onInterim: (t) => { this.interim.hidden = !t; this.interim.textContent = t; },
        onState: (on, err) => { this.mic!.classList.toggle("rec", on); this.mic!.setAttribute("aria-pressed", String(on)); if (err) this.say(err); },
      });
    }
    const form = el("form", { cls: "composer" }, this.attach, this.input, ...(this.mic ? [this.mic] : []), this.send);
    form.addEventListener("submit", (e) => { e.preventDefault(); if (this.busy) this.h.onStop(); else this.submit(); });
    void tools;

    this.input.addEventListener("input", () => { this.autosize(); this.refreshPalette(); this.scheduleDraft(); this.syncSend(); });
    this.input.addEventListener("keydown", (e) => this.keydown(e));
    this.input.addEventListener("paste", (e) => {
      const fs = e.clipboardData?.files;
      if (fs && fs.length) { e.preventDefault(); void this.addFiles(fs); }
    });
    this.root = el("div", { cls: "composer-wrap" }, this.chips, this.note, this.interim, el("div", { cls: "composer-box" }, this.palette, form), this.fileInput,
      el("p", { cls: "disclaimer", textContent: "JUUNIBI может ошибаться. Проверяйте важную информацию. Команды — «/», справка — Ctrl+/." }));
    this.syncSend();
  }

  // ---------- state ----------
  setState(o: { configured: boolean; busy: boolean }) {
    this.configured = o.configured; this.busy = o.busy;
    this.input.disabled = !o.configured;
    this.attach.disabled = !o.configured;
    this.input.placeholder = o.configured ? "Напишите сообщение JUUNIBI" : "Сначала добавьте ключ Cloud.ru в настройках";
    this.syncSend();
  }
  focus() { this.input.focus(); }
  isEmpty() { return !this.input.value.trim() && !this.files.length; }

  private syncSend() {
    this.send.replaceChildren(icon(this.busy ? "stop" : "send", 18));
    this.send.title = this.busy ? "Остановить" : "Отправить";
    this.send.setAttribute("aria-label", this.send.title);
    this.send.classList.toggle("stop", this.busy);
    this.send.disabled = !this.configured || (!this.busy && this.isEmpty());
  }
  private autosize() { this.input.style.height = "auto"; this.input.style.height = Math.min(this.input.scrollHeight, 200) + "px"; }
  private say(text: string) { this.note.textContent = text; if (text) setTimeout(() => { if (this.note.textContent === text) this.note.textContent = ""; }, 6000); }
  private insert(t: string) {
    if (!t) return;
    const v = this.input.value;
    this.input.value = v + (v && !/\s$/.test(v) ? " " : "") + t;
    this.input.dispatchEvent(new Event("input"));
  }

  // ---------- drafts ----------
  private drafts(): Record<string, string> { const r = attempt(() => JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? "{}") as Record<string, string>); return r.ok && r.value && typeof r.value === "object" ? r.value : {}; }
  private saveDraft() {
    if (!this.convId) return;
    const d = this.drafts(); const v = this.input.value;
    if (v.trim()) d[this.convId] = v; else delete d[this.convId];
    attempt(() => localStorage.setItem(DRAFTS_KEY, JSON.stringify(d)));
  }
  private scheduleDraft() { clearTimeout(this.draftTimer); this.draftTimer = setTimeout(() => this.saveDraft(), 400); }
  /** Switching chats keeps what you had typed in each of them. */
  loadDraft(convId: string | null) {
    if (convId === this.convId) return;
    clearTimeout(this.draftTimer); this.saveDraft();
    this.convId = convId;
    this.input.value = convId ? (this.drafts()[convId] ?? "") : "";
    this.files = []; this.renderChips(); this.autosize(); this.refreshPalette(); this.syncSend();
  }

  // ---------- commands palette ----------
  private refreshPalette() {
    this.paletteItems = suggestCommands(this.input.value, this.h.quick?.() ?? []);
    this.sel = Math.min(this.sel, Math.max(0, this.paletteItems.length - 1));
    this.palette.hidden = this.paletteItems.length === 0;
    this.palette.replaceChildren(...this.paletteItems.map((c, i) => {
      const li = el("li", { cls: "palette-item" + (i === this.sel ? " sel" : ""), attrs: { role: "option", "aria-selected": String(i === this.sel) } },
        el("strong", { textContent: "/" + c.names[0] }), c.arg ? el("span", { cls: "muted", textContent: `<${c.arg}>` }) : null, el("span", { cls: "grow muted", textContent: c.hint }));
      li.addEventListener("mousedown", (e) => { e.preventDefault(); this.pick(c); });
      return li;
    }));
  }
  private pick(c: Command) {
    if (c.arg) { this.input.value = `/${c.names[0]} `; this.input.dispatchEvent(new Event("input")); this.input.focus(); return; }
    this.clear(); this.h.onCommand(c, "");
  }

  private keydown(e: KeyboardEvent) {
    if (!this.palette.hidden) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        this.sel = (this.sel + (e.key === "ArrowDown" ? 1 : -1) + this.paletteItems.length) % this.paletteItems.length;
        this.refreshPalette(); return;
      }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); const c = this.paletteItems[this.sel]; if (c) this.pick(c); return; }
      if (e.key === "Escape") { e.preventDefault(); this.palette.hidden = true; return; }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!this.busy) this.submit(); return; }
    if (e.key === "ArrowUp" && this.isEmpty() && !e.shiftKey) { e.preventDefault(); this.h.onEditLast(); }
  }

  private clear() {
    this.input.value = ""; this.files = []; this.renderChips(); this.autosize(); this.refreshPalette();
    clearTimeout(this.draftTimer); this.saveDraft(); this.syncSend();
  }
  private submit() {
    const text = this.input.value.trim();
    if (!text && !this.files.length) return;
    const parsed = parseCommand(text, this.h.quick?.() ?? []);
    const files = this.files;
    this.clear();
    if (parsed) this.h.onCommand(parsed.command, parsed.arg);
    else this.h.onSubmit(text, files);
  }

  // ---------- attachments ----------
  async addFiles(list: FileList | File[] | null) {
    if (!list || !this.configured) return;
    const rejected: string[] = [];
    for (const f of Array.from(list)) {
      const why = checkFile(f, this.files);
      if (why) { rejected.push(`${f.name}: ${why}`); continue; }
      try {
        const text = await f.text();
        if (looksBinary(text)) { rejected.push(`${f.name}: похоже на двоичный файл`); continue; }
        this.files = [...this.files, { name: f.name, size: f.size, text }];
      } catch { rejected.push(`${f.name}: не удалось прочитать`); }
    }
    this.renderChips(); this.syncSend();
    if (rejected.length) this.say("Не прикреплено — " + rejected.join("; "));
    else if (list.length) this.say(`Файлов прикреплено: ${this.files.length}. Лимит ${formatBytes(MAX_FILE_BYTES)} на файл.`);
  }
  private renderChips() {
    this.chips.hidden = this.files.length === 0;
    this.chips.replaceChildren(...this.files.map((f, i) => {
      const x = iconButton("x", `Убрать ${f.name}`, () => { this.files = this.files.filter((_, j) => j !== i); this.renderChips(); this.syncSend(); this.note.textContent = ""; }, "icon-btn sm");
      return el("span", { cls: "file-chip" }, icon("file", 14), el("span", { cls: "file-name", textContent: f.name, title: f.name }), el("span", { cls: "muted", textContent: formatBytes(f.size) }), x);
    }));
  }
  stopVoice() { this.dictation?.stop(); }
}
