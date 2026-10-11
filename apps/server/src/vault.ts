import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scrypt } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * «Пароли»: logins, passwords and mail kept in one file encrypted with the owner's master password
 * (scrypt → AES-256-GCM). The key lives only in memory while the vault is open and is wiped on lock,
 * after `lockMinutes` without use, and on restart. Nothing here is visible to the assistant: no chat tool,
 * memory or backup reads this file, and the server answers these requests only on the computer itself.
 */
export interface VaultItem {
  id: string; title: string; login?: string; password?: string; email?: string; url?: string; note?: string;
  createdAt: string; updatedAt: string;
}
interface VaultFile {
  v: 1;
  kdf: { salt: string; N: number; r: number; p: number };
  iv: string; tag: string; data: string;
  lockMinutes?: number;
}
const FIELDS: [keyof VaultItem, number][] = [["title", 100], ["login", 200], ["password", 500], ["email", 200], ["url", 500], ["note", 2000]];
const MAX_ITEMS = 1000;
const KDF = { N: 2 ** 15, r: 8, p: 1 };
export const LOCK_MINUTES = [1, 5, 15, 30];
const bad = (message: string, status = 400) => Object.assign(new Error(message), { status });

function derive(password: string, salt: Buffer, k: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password.normalize("NFC"), salt, 32, { ...k, maxmem: 256 * 1024 * 1024 }, (e, key) => (e ? reject(e) : resolve(key))));
}
function seal(key: Buffer, items: VaultItem[]): Pick<VaultFile, "iv" | "tag" | "data"> {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(JSON.stringify(items), "utf8"), c.final()]);
  return { iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: data.toString("base64") };
}
/** null when the key is wrong (the GCM tag does not match) or the file was changed. */
function open(key: Buffer, f: VaultFile): VaultItem[] | null {
  try {
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(f.iv, "base64"));
    d.setAuthTag(Buffer.from(f.tag, "base64"));
    const items = JSON.parse(Buffer.concat([d.update(Buffer.from(f.data, "base64")), d.final()]).toString("utf8")) as unknown;
    return Array.isArray(items) ? items.filter((x): x is VaultItem => !!x && typeof x.id === "string" && typeof x.title === "string") : null;
  } catch { return null; }
}
function validFile(v: unknown): v is VaultFile {
  const f = v as VaultFile | null;
  return !!f && f.v === 1 && !!f.kdf && typeof f.kdf.salt === "string" && Number.isInteger(f.kdf.N) && f.kdf.N >= 2 ** 14 && f.kdf.N <= 2 ** 20
    && Number.isInteger(f.kdf.r) && f.kdf.r >= 1 && f.kdf.r <= 32 && Number.isInteger(f.kdf.p) && f.kdf.p >= 1 && f.kdf.p <= 4
    && typeof f.iv === "string" && typeof f.tag === "string" && typeof f.data === "string";
}
const checkPassword = (v: unknown): string => {
  if (typeof v !== "string" || v.length < 8 || v.length > 200) throw bad("Мастер-пароль: от 8 до 200 символов");
  return v;
};

export class Vault {
  private file: VaultFile | null = null;
  private loaded = false;
  private key: Buffer | null = null;
  private items: VaultItem[] = [];
  private lastUse = 0;
  private fails = 0;
  private blockedUntil = 0;
  private writes: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setInterval>;
  constructor(private readonly path: string, private readonly now: () => number = Date.now) {
    this.timer = setInterval(() => this.idleCheck(), 15_000);
    this.timer.unref?.();
  }
  stop() { clearInterval(this.timer); this.lock(); }

  private async load() {
    if (this.loaded) return;
    try {
      const raw = JSON.parse(await readFile(this.path, "utf8")) as unknown;
      if (!validFile(raw)) throw bad("Файл паролей повреждён", 500);
      this.file = raw;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    this.loaded = true;
  }
  private save(): Promise<void> {
    const body = JSON.stringify(this.file);
    this.writes = this.writes.catch(() => {}).then(async () => {
      await mkdir(path.dirname(this.path), { recursive: true });
      const tmp = this.path + "." + randomUUID() + ".tmp";
      await writeFile(tmp, body, { mode: 0o600 });
      // the previous file stays as .bak: a failed write never leaves the owner without passwords
      try { await rename(this.path, this.path + ".bak"); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      await rename(tmp, this.path);
    });
    return this.writes;
  }
  private idleCheck() {
    if (this.key && this.now() - this.lastUse > this.lockMinutes() * 60_000) this.lock();
  }
  private lockMinutes() { return LOCK_MINUTES.includes(this.file?.lockMinutes ?? 0) ? this.file!.lockMinutes! : 5; }
  /** The open key, or 423 «Пароли закрыты». Each use moves the auto-lock further. */
  private need(): Buffer {
    this.idleCheck();
    if (!this.key) throw bad("Пароли закрыты. Введите мастер-пароль.", 423);
    this.lastUse = this.now();
    return this.key;
  }
  private async persist() {
    const key = this.need();
    this.file = { ...this.file!, ...seal(key, this.items) };
    await this.save();
  }

  async status() {
    await this.load();
    this.idleCheck();
    return { exists: !!this.file, unlocked: !!this.key, lockMinutes: this.lockMinutes(), count: this.key ? this.items.length : null,
      ...(this.blockedUntil > this.now() ? { waitSeconds: Math.ceil((this.blockedUntil - this.now()) / 1000) } : {}) };
  }
  async setup(password: unknown) {
    await this.load();
    if (this.file) throw bad("Хранилище уже создано", 409);
    const pw = checkPassword(password);
    const salt = randomBytes(16);
    const key = await derive(pw, salt, KDF);
    this.file = { v: 1, kdf: { salt: salt.toString("base64"), ...KDF }, ...seal(key, []), lockMinutes: 5 };
    await this.save();
    this.key = key; this.items = []; this.lastUse = this.now();
    return this.status();
  }
  async unlock(password: unknown) {
    await this.load();
    if (!this.file) throw bad("Хранилище ещё не создано", 404);
    if (this.blockedUntil > this.now()) throw bad(`Слишком много попыток. Подождите ${Math.ceil((this.blockedUntil - this.now()) / 1000)} с.`, 429);
    if (typeof password !== "string" || !password) throw bad("Введите мастер-пароль");
    const key = await derive(password, Buffer.from(this.file.kdf.salt, "base64"), this.file.kdf);
    const items = open(key, this.file);
    if (!items) {
      key.fill(0);
      // after five wrong tries each next one waits longer: 30 s, 1 min, 2 min… up to 15 min
      if (++this.fails >= 5) this.blockedUntil = this.now() + Math.min(15 * 60_000, 30_000 * 2 ** (this.fails - 5));
      throw bad("Неверный мастер-пароль", 401);
    }
    this.fails = 0; this.blockedUntil = 0;
    this.key = key; this.items = items; this.lastUse = this.now();
    return this.status();
  }
  lock() {
    this.key?.fill(0);
    this.key = null;
    this.items = [];
  }
  list(): VaultItem[] {
    this.need();
    return this.items.map((x) => ({ ...x })).sort((a, b) => a.title.localeCompare(b.title, "ru"));
  }
  private clean(body: Record<string, unknown>, base?: VaultItem): Omit<VaultItem, "id" | "createdAt" | "updatedAt"> {
    const out: Record<string, string> = {};
    for (const [k, max] of FIELDS) {
      const v = k in body ? body[k] : base?.[k];
      if (v === undefined || v === null || v === "") continue;
      if (typeof v !== "string" || v.length > max) throw bad(`Поле «${k}»: до ${max} символов`);
      out[k] = k === "password" ? v : v.trim();
    }
    if (!out.title) throw bad("Укажите название, например «Почта Яндекс»");
    return out as unknown as Omit<VaultItem, "id" | "createdAt" | "updatedAt">;
  }
  async add(body: Record<string, unknown>): Promise<VaultItem> {
    this.need();
    if (this.items.length >= MAX_ITEMS) throw bad(`Достигнут предел: ${MAX_ITEMS} записей`, 409);
    const at = new Date(this.now()).toISOString();
    const item: VaultItem = { id: randomUUID(), ...this.clean(body), createdAt: at, updatedAt: at };
    this.items.push(item);
    await this.persist();
    return { ...item };
  }
  async update(id: string, body: Record<string, unknown>): Promise<VaultItem> {
    this.need();
    const i = this.items.findIndex((x) => x.id === id);
    if (i < 0) throw bad("Запись не найдена", 404);
    const item: VaultItem = { id, ...this.clean(body, this.items[i]), createdAt: this.items[i]!.createdAt, updatedAt: new Date(this.now()).toISOString() };
    this.items[i] = item;
    await this.persist();
    return { ...item };
  }
  async remove(id: string) {
    this.need();
    if (!this.items.some((x) => x.id === id)) throw bad("Запись не найдена", 404);
    this.items = this.items.filter((x) => x.id !== id);
    await this.persist();
  }
  /** A new master password: the same records sealed with a new salt and key. */
  async changePassword(oldPassword: unknown, next: unknown) {
    this.need();
    const pw = checkPassword(next);
    const check = await derive(String(oldPassword ?? ""), Buffer.from(this.file!.kdf.salt, "base64"), this.file!.kdf);
    const ok = !!open(check, this.file!);
    check.fill(0);
    if (!ok) throw bad("Текущий мастер-пароль неверный", 401);
    const salt = randomBytes(16);
    const key = await derive(pw, salt, KDF);
    this.key!.fill(0);
    this.key = key;
    this.file = { ...this.file!, kdf: { salt: salt.toString("base64"), ...KDF } };
    await this.persist();
    return this.status();
  }
  async setLockMinutes(m: unknown) {
    this.need();
    if (!LOCK_MINUTES.includes(m as number)) throw bad("Закрывать через: " + LOCK_MINUTES.join(", ") + " мин");
    this.file = { ...this.file!, lockMinutes: m as number };
    await this.save();
    return this.status();
  }
  /** The encrypted file as it is on disk: a copy that opens only with the master password. */
  async exportFile(): Promise<string> {
    this.need();
    return JSON.stringify(this.file);
  }
  /** Puts back a copy made by «Скачать копию» after checking that `password` opens it; the vault is then open with it. */
  async importFile(content: unknown, password: unknown) {
    await this.load();
    if (this.file) this.need(); // replacing existing passwords needs them open first
    let f: unknown;
    try { f = JSON.parse(String(content ?? "")); } catch { throw bad("Это не копия паролей JUUNIBI"); }
    if (!validFile(f)) throw bad("Это не копия паролей JUUNIBI");
    if (typeof password !== "string" || !password) throw bad("Введите мастер-пароль копии");
    const key = await derive(password, Buffer.from(f.kdf.salt, "base64"), f.kdf);
    const items = open(key, f);
    if (!items) { key.fill(0); throw bad("Мастер-пароль не подходит к этой копии", 401); }
    this.key?.fill(0);
    this.file = f; this.key = key; this.items = items; this.lastUse = this.now();
    await this.save();
    return this.status();
  }
}
