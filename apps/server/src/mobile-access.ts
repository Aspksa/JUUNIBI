import type http from "node:http";
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import path from "node:path";
import qrcode from "qrcode-generator";

/**
 * «Мобильное приложение»: the same JUUNIBI opened from a phone over the home Wi-Fi.
 * Off by default. When on, a second server listens on the LAN port; the main server stays on 127.0.0.1.
 * Every LAN request must carry the cookie of a paired device; a device is paired with a short single-use code
 * shown on the computer (as a QR code or typed in). Pairing management itself is reachable only from the computer.
 */

export const DEFAULT_LAN_PORT = 4180;
const COOKIE = "jb_device";
const CODE_TTL_MS = 15 * 60_000;
const MAX_FAILS = 5;
const MAX_DEVICES = 10;
const COOKIE_MAX_AGE = 400 * 24 * 60 * 60; // the longest browsers keep a cookie
/** Public files the browser fetches without cookies when the page is added to the home screen. */
const PUBLIC_PATHS = new Set(["/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"]);

export interface MobileDevice { id: string; name: string; hash: string; pairedAt: string; lastSeen: string }
export interface MobileAddress { ip: string; iface: string }
export interface MobileStatus {
  enabled: boolean; running: boolean; port: number; error: string | null;
  addresses: MobileAddress[];
  /** Single-use pairing code (8 digits) and when it stops working; null while access is off. */
  code: string | null; codeExpiresAt: string | null;
  devices: { id: string; name: string; pairedAt: string; lastSeen: string }[];
}
type Ifaces = ReturnType<typeof networkInterfaces>;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const sameText = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const PRIVATE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
const VIRTUAL = /vethernet|virtualbox|vmware|docker|wsl|hyper-v|tailscale|zerotier|vpn|tun|utun|br-|veth/i;

/** Addresses of this computer that a phone on the same network can reach; home-network adapters first. */
export function lanAddresses(ifaces: Ifaces = networkInterfaces()): MobileAddress[] {
  const out: (MobileAddress & { rank: number })[] = [];
  for (const [iface, list] of Object.entries(ifaces)) for (const a of list ?? []) {
    if (a.family !== "IPv4" || a.internal || a.address.startsWith("169.254.")) continue;
    out.push({ ip: a.address, iface, rank: (PRIVATE.test(a.address) ? 0 : 2) + (VIRTUAL.test(iface) ? 1 : 0) + (a.address.startsWith("192.168.") ? 0 : 0.5) });
  }
  return out.sort((a, b) => a.rank - b.rank).map(({ ip, iface }) => ({ ip, iface }));
}

/** A readable name for the paired device, from its User-Agent. */
export function deviceName(ua = ""): string {
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile/i.test(ua))) return "iPad";
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "Android-телефон" : "Android-планшет";
  if (/Windows/i.test(ua)) return "Компьютер с Windows";
  if (/Macintosh/i.test(ua)) return "Mac";
  if (/Linux/i.test(ua)) return "Устройство с Linux";
  return "Устройство";
}

/** QR code as a standalone SVG (dark modules on white, with a quiet zone, so any camera reads it). */
export function qrSvg(text: string): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount(), m = 4, size = n + m * 2;
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** The page an unpaired phone sees: a form for the code (no scripts, so the strict CSP stays as is). */
export function pairPage(message = "", bad = false): string {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="light dark"><meta name="theme-color" content="#1b1b1f"><link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="JUUNIBI">
<title>JUUNIBI — подключение</title><style>
:root{color-scheme:light dark;--bg:#fff;--fg:#0f0f12;--muted:#5a5a63;--line:rgba(0,0,0,.12);--brand:#ad7a12;--bad:#c5221f}
@media (prefers-color-scheme:dark){:root{--bg:#1b1b1f;--fg:#ececf1;--muted:#b4b4bd;--line:rgba(255,255,255,.14);--brand:#d9a441;--bad:#f87171}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding:24px max(16px,env(safe-area-inset-right)) 24px max(16px,env(safe-area-inset-left))}
main{width:100%;max-width:360px;text-align:center}h1{font-size:26px;letter-spacing:.12em;color:var(--brand);margin:0 0 8px}p{color:var(--muted);margin:0 0 20px}
input{width:100%;font:600 28px/1 ui-monospace,monospace;letter-spacing:.2em;text-align:center;padding:14px;border-radius:14px;border:1px solid var(--line);background:transparent;color:var(--fg)}
button{margin-top:12px;width:100%;padding:14px;border:0;border-radius:14px;font:600 16px system-ui,sans-serif;background:var(--fg);color:var(--bg)}
.msg{color:var(--bad);font-weight:600}.ok{color:var(--muted)}</style></head><body><main>
<h1>JUUNIBI</h1><p>Откройте на компьютере раздел «Мобильное приложение» и отсканируйте QR-код или введите код из 8 цифр.</p>
${message ? `<p class="${bad ? "msg" : "ok"}" role="alert">${escapeHtml(message)}</p>` : ""}
<form method="post" action="/pair"><input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{8,9}" maxlength="9" placeholder="0000 0000" aria-label="Код подключения" required autofocus>
<button type="submit">Подключить</button></form></main></body></html>`;
}

function readForm(req: http.IncomingMessage, limit = 2048): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    let body = "", size = 0;
    req.on("data", (c: Buffer) => { size += c.length; if (size <= limit) body += c.toString("utf8"); });
    req.on("end", () => (size > limit ? reject(Object.assign(new Error("Слишком большой запрос"), { status: 413 })) : resolve(new URLSearchParams(body))));
    req.on("error", reject);
  });
}

function cookieOf(req: http.IncomingMessage): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return part.slice(i + 1).trim();
  }
  return undefined;
}

export class MobileAccess {
  private enabled = false;
  private devices: MobileDevice[] = [];
  private code: string | null = null;
  private codeExpires = 0;
  private fails = 0;
  private server: http.Server | null = null;
  private error: string | null = null;
  private active = true;
  private writes: Promise<void> = Promise.resolve();
  private seenSaveTimer: NodeJS.Timeout | undefined;
  private hostCache = { at: 0, hosts: new Set<string>() };

  constructor(private readonly file: string, private readonly opts: {
    port: number;
    /** Builds the LAN server around this gate (the same app as on 127.0.0.1, with LAN checks). */
    makeServer: (gate: MobileAccess) => http.Server;
    log?: { info(m: string): void; warn(m: string, d?: unknown): void };
    interfaces?: () => Ifaces;
    now?: () => number;
    bindHost?: string;
  }) {}

  private now() { return (this.opts.now ?? Date.now)(); }
  private addrs() { return lanAddresses(this.opts.interfaces?.() ?? networkInterfaces()); }

  async load() {
    try {
      const raw = JSON.parse(await readFile(this.file, "utf8")) as { enabled?: unknown; devices?: unknown };
      this.enabled = raw.enabled === true;
      if (Array.isArray(raw.devices)) this.devices = raw.devices.filter((d): d is MobileDevice => !!d && typeof d.id === "string" && typeof d.hash === "string" && /^[0-9a-f]{64}$/.test(d.hash) && typeof d.name === "string" && typeof d.pairedAt === "string").slice(-MAX_DEVICES).map((d) => ({ ...d, lastSeen: typeof d.lastSeen === "string" ? d.lastSeen : d.pairedAt }));
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
  private save() {
    const data = JSON.stringify({ enabled: this.enabled, devices: this.devices }, null, 2);
    this.writes = this.writes.catch(() => {}).then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const tmp = this.file + "." + randomUUID() + ".tmp";
      await writeFile(tmp, data, { mode: 0o600 });
      await rename(tmp, this.file);
    });
    return this.writes;
  }
  flush() {
    if (!this.seenSaveTimer) return this.writes;
    clearTimeout(this.seenSaveTimer);
    this.seenSaveTimer = undefined;
    return this.save();
  }

  status(): MobileStatus {
    const code = this.enabled ? this.currentCode() : null;
    return {
      enabled: this.enabled, running: !!this.server?.listening, port: this.opts.port, error: this.error,
      addresses: this.addrs(), code, codeExpiresAt: code ? new Date(this.codeExpires).toISOString() : null,
      devices: this.devices.map(({ id, name, pairedAt, lastSeen }) => ({ id, name, pairedAt, lastSeen })),
    };
  }
  /** The address the phone opens; the code in it is single-use. */
  pairUrl(ip: string): string | null {
    const code = this.enabled ? this.currentCode() : null;
    return code && this.addrs().some((a) => a.ip === ip) ? `http://${ip}:${this.opts.port}/pair?code=${code}` : null;
  }
  private currentCode(): string {
    if (!this.code || this.now() >= this.codeExpires) this.newCode();
    return this.code!;
  }
  newCode() {
    this.code = String(randomInt(0, 100_000_000)).padStart(8, "0");
    this.codeExpires = this.now() + CODE_TTL_MS;
    this.fails = 0;
  }

  // ---------- on / off ----------
  async setEnabled(on: boolean) {
    this.enabled = on;
    if (on) this.newCode();
    await this.save();
    if (on && this.active) await this.listen(); else await this.close();
  }
  /** Module started (also at boot): listen if access was left on. */
  async resume() { this.active = true; if (this.enabled) await this.listen(); }
  /** Module stopped: phones lose access, the setting stays. */
  async pause() { this.active = false; await this.close(); }

  private async listen() {
    if (this.server?.listening) return;
    this.error = null;
    const server = this.opts.makeServer(this);
    await new Promise<void>((resolve) => {
      server.once("error", (e: NodeJS.ErrnoException) => {
        this.error = e.code === "EADDRINUSE" ? `Порт ${this.opts.port} занят другой программой` : `Не удалось открыть доступ: ${e.message}`;
        this.opts.log?.warn("Мобильное приложение: " + this.error);
        this.server = null;
        resolve();
      });
      server.listen(this.opts.port, this.opts.bindHost ?? "0.0.0.0", () => {
        this.server = server;
        this.opts.log?.info(`Мобильное приложение: доступ по Wi-Fi открыт на порту ${this.opts.port}`);
        resolve();
      });
    });
  }
  private async close() {
    const s = this.server;
    this.server = null;
    this.error = null;
    if (!s) return;
    await new Promise<void>((resolve) => { s.close(() => resolve()); s.closeAllConnections(); });
  }

  // ---------- devices ----------
  async revoke(id: string) {
    const before = this.devices.length;
    this.devices = this.devices.filter((d) => d.id !== id);
    if (this.devices.length === before) throw Object.assign(new Error("Устройство не найдено"), { status: 404 });
    await this.save();
  }
  async revokeAll() { this.devices = []; await this.save(); }

  private deviceFor(req: http.IncomingMessage): MobileDevice | undefined {
    const raw = cookieOf(req);
    const m = raw ? /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(raw) : null;
    if (!m) return undefined;
    const d = this.devices.find((x) => x.id === m[1]);
    return d && sameText(d.hash, sha(m[2]!)) ? d : undefined;
  }
  private touch(d: MobileDevice) {
    const now = this.now();
    if (now - Date.parse(d.lastSeen) < 60_000) return;
    d.lastSeen = new Date(now).toISOString();
    if (!this.seenSaveTimer) this.seenSaveTimer = setTimeout(() => { this.seenSaveTimer = undefined; void this.save(); }, 30_000);
    this.seenSaveTimer.unref?.();
  }
  /** Checks a code; a wrong one counts, and after a few the code is replaced so it cannot be guessed. */
  private takeCode(input: string): boolean {
    const given = input.replace(/\s+/g, "");
    if (!this.enabled || !this.code || this.now() >= this.codeExpires) return false;
    if (/^\d{8}$/.test(given) && sameText(given, this.code)) { this.code = null; return true; }
    if (++this.fails >= MAX_FAILS) this.newCode();
    return false;
  }
  private async pair(req: http.IncomingMessage, res: http.ServerResponse, code: string) {
    if (!this.takeCode(code)) return this.page(res, 403, "Код не подошёл или устарел. Посмотрите новый код на компьютере.", true);
    const secret = randomBytes(32).toString("base64url");
    const d: MobileDevice = { id: randomUUID(), name: deviceName(req.headers["user-agent"]), hash: sha(secret), pairedAt: new Date(this.now()).toISOString(), lastSeen: new Date(this.now()).toISOString() };
    this.devices = [...this.devices, d].slice(-MAX_DEVICES);
    await this.save();
    res.writeHead(303, {
      location: "/", "cache-control": "no-store", "referrer-policy": "no-referrer",
      "set-cookie": `${COOKIE}=${d.id}.${secret}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax`,
    });
    res.end();
  }
  private page(res: http.ServerResponse, status: number, message = "", bad = false) {
    res.writeHead(status, {
      "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; form-action 'self'",
    });
    res.end(pairPage(message, bad));
  }

  // ---------- the gate used by the LAN server ----------
  /** Only this computer's own LAN addresses on the LAN port: a foreign name (DNS rebinding) is refused. */
  hostAllowed(host: string | undefined): boolean {
    if (!host) return false;
    const now = this.now();
    if (now - this.hostCache.at > 5000) this.hostCache = { at: now, hosts: new Set(this.addrs().map((a) => `${a.ip}:${this.opts.port}`)) };
    return this.hostCache.hosts.has(host.toLowerCase());
  }
  /** Answers pairing and refusals itself (true); lets paired devices through to the app (false). */
  async intercept(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
    const p = url.pathname;
    if (p === "/pair") {
      const known = this.deviceFor(req);
      if (req.method === "POST") {
        const origin = req.headers.origin;
        if (origin && origin !== "null" && (() => { try { return new URL(origin).host !== req.headers.host; } catch { return true; } })()) { this.page(res, 403, "Чужой адрес страницы.", true); return true; }
        await this.pair(req, res, (await readForm(req)).get("code") ?? "");
        return true;
      }
      if (req.method === "GET" && url.searchParams.has("code") && !known) { await this.pair(req, res, url.searchParams.get("code")!); return true; }
      if (known) { res.writeHead(303, { location: "/", "cache-control": "no-store" }); res.end(); return true; }
      this.page(res, 200);
      return true;
    }
    const d = this.deviceFor(req);
    if (!d) {
      if ((req.method === "GET" || req.method === "HEAD") && PUBLIC_PATHS.has(p)) return false;
      if (p.startsWith("/api/")) {
        res.writeHead(401, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify({ error: "Устройство не подключено к JUUNIBI", pair: true }));
      } else this.page(res, 401);
      return true;
    }
    this.touch(d);
    // Pairing is managed only on the computer: a phone cannot add devices or open access for others.
    if (p === "/api/mobile" || p.startsWith("/api/mobile/")) {
      res.writeHead(403, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify({ error: "Управление доступом — только на компьютере" }));
      return true;
    }
    return false;
  }
}
