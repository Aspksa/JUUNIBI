import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createApp, type AppDeps } from "../src/app";
import { MobileAccess, deviceName, lanAddresses, qrSvg } from "../src/mobile-access";

const iface = (address: string) => ({ address, family: "IPv4" as const, internal: false, netmask: "255.255.255.0", mac: "00:00:00:00:00:00", cidr: null });
const freePort = () => new Promise<number>((r) => { const s = http.createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as AddressInfo).port; s.close(() => r(p)); }); });

interface Res { status: number; headers: http.IncomingHttpHeaders; body: string }
function request(port: number, p: string, o: { method?: string; host?: string; cookie?: string; body?: string; type?: string; origin?: string } = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: p, method: o.method ?? "GET", headers: {
      host: o.host ?? `127.0.0.1:${port}`, ...(o.cookie ? { cookie: o.cookie } : {}), ...(o.origin ? { origin: o.origin } : {}),
      ...(o.body !== undefined ? { "content-type": o.type ?? "application/json", "content-length": Buffer.byteLength(o.body) } : {}),
    } }, (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: b })); });
    req.on("error", reject);
    req.end(o.body);
  });
}

describe("helpers", () => {
  it("lists home-network addresses first and skips loopback and link-local", () => {
    const list = lanAddresses({
      "vEthernet (WSL)": [iface("172.20.0.1")], "Wi-Fi": [iface("192.168.1.42")], lo: [{ ...iface("127.0.0.1"), internal: true }],
      eth9: [iface("169.254.3.3")], v6: [{ address: "fe80::1", family: "IPv6", internal: false, netmask: "", mac: "", cidr: null, scopeid: 0 }],
    });
    expect(list.map((a) => a.ip)).toEqual(["192.168.1.42", "172.20.0.1"]);
  });
  it("names devices", () => {
    expect(deviceName("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("iPhone");
    expect(deviceName("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari")).toBe("Android-телефон");
    expect(deviceName(undefined)).toBe("Устройство");
  });
  it("draws a QR code as SVG", () => {
    expect(qrSvg("http://192.168.1.42:4180/pair?code=12345678")).toMatch(/^<svg [^>]+viewBox="0 0 \d+ \d+".*<path d="M/);
  });
});

describe("LAN access", () => {
  let dir: string, lanPort: number, local: http.Server, localPort: number, mobile: MobileAccess;
  const host = () => `127.0.0.1:${lanPort}`;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "jb-mobile-"));
    lanPort = await freePort();
    const deps: AppDeps = { modules: () => [], configured: { model: "m" } };
    // The test machine's "Wi-Fi address" is 127.0.0.1 so the LAN server can be reached here.
    mobile = new MobileAccess(path.join(dir, "mobile.json"), { port: lanPort, bindHost: "127.0.0.1", interfaces: () => ({ wlan0: [iface("127.0.0.1")] }), makeServer: (gate) => createApp(deps, gate) });
    deps.mobile = mobile;
    local = createApp(deps);
    localPort = await new Promise<number>((r) => local.listen(0, "127.0.0.1", () => r((local.address() as AddressInfo).port)));
  });
  afterAll(async () => { await mobile.pause(); local.close(); });

  it("is off by default and opens only when turned on from the computer", async () => {
    expect((await request(localPort, "/api/mobile")).body).toContain('"enabled":false');
    await expect(request(lanPort, "/")).rejects.toThrow(); // nothing listens yet
    const on = JSON.parse((await request(localPort, "/api/mobile", { method: "POST", body: JSON.stringify({ enabled: true }) })).body);
    expect(on).toMatchObject({ enabled: true, running: true, port: lanPort });
    expect(on.code).toMatch(/^\d{8}$/);
    const qr = await request(localPort, "/api/mobile/qr.svg?ip=127.0.0.1");
    expect(qr.headers["content-type"]).toBe("image/svg+xml");
    expect((await request(localPort, "/api/mobile/qr.svg?ip=10.9.9.9")).status).toBe(404);
    expect(JSON.parse(await readFile(path.join(dir, "mobile.json"), "utf8")).enabled).toBe(true);
  });

  it("lets nothing through before pairing, except the files needed to install the app", async () => {
    expect((await request(lanPort, "/")).status).toBe(401);
    expect((await request(lanPort, "/")).body).toContain('action="/pair"');
    const api = await request(lanPort, "/api/status");
    expect(api.status).toBe(401);
    expect(JSON.parse(api.body).pair).toBe(true);
    expect((await request(lanPort, "/manifest.webmanifest")).status).not.toBe(401);
    expect((await request(lanPort, "/api/status", { host: "evil.example:" + lanPort })).status).toBe(403);
    expect((await request(lanPort, "/api/status", { host: "localhost:" + lanPort })).status).toBe(403);
  });

  it("pairs with the single-use code and keeps phone sessions away from pairing management", async () => {
    const code = mobile.status().code!;
    const paired = await request(lanPort, "/pair?code=" + code);
    expect(paired.status).toBe(303);
    const cookie = String(paired.headers["set-cookie"]).split(";")[0]!;
    expect(String(paired.headers["set-cookie"])).toMatch(/HttpOnly; SameSite=Lax/);
    expect((await request(lanPort, "/api/status", { cookie })).status).toBe(200);
    expect((await request(lanPort, "/api/mobile", { cookie })).status).toBe(403);
    expect((await request(lanPort, "/api/mobile/code", { cookie, method: "POST", body: "{}" })).status).toBe(403);
    // A state change from another site is still refused for a paired phone.
    expect((await request(lanPort, "/api/feedback", { cookie, method: "POST", body: "{}", origin: "http://evil.example" })).status).toBe(403);
    // The code worked once only.
    expect((await request(lanPort, "/pair?code=" + code)).status).toBe(403);
    expect(mobile.status().code).not.toBe(code);
    expect(mobile.status().devices).toHaveLength(1);

    // Typed in on the phone (form post, spaces allowed).
    const typed = mobile.status().code!;
    const form = await request(lanPort, "/pair", { method: "POST", type: "application/x-www-form-urlencoded", body: "code=" + typed.slice(0, 4) + "+" + typed.slice(4), origin: `http://${host()}` });
    expect(form.status).toBe(303);
    expect(mobile.status().devices).toHaveLength(2);

    // Revoked: the phone is back at the pairing page.
    await mobile.revoke(mobile.status().devices[0]!.id);
    expect((await request(lanPort, "/api/status", { cookie })).status).toBe(401);
    expect((await request(lanPort, "/api/status", { cookie: cookie.replace(/.$/, (c) => (c === "A" ? "B" : "A")) })).status).toBe(401);
  });

  it("replaces the code after a few wrong guesses", async () => {
    const code = mobile.status().code!;
    for (let i = 0; i < 5; i++) expect((await request(lanPort, "/pair?code=00000000")).status).toBe(403);
    expect(mobile.status().code).not.toBe(code);
    expect((await request(lanPort, "/pair?code=" + code)).status).toBe(403);
  });

  it("closes the LAN server when turned off, and keeps devices for next time", async () => {
    await request(localPort, "/api/mobile", { method: "POST", body: JSON.stringify({ enabled: false }) });
    await expect(request(lanPort, "/")).rejects.toThrow();
    expect(mobile.status()).toMatchObject({ enabled: false, running: false, code: null });
    expect(mobile.status().devices).toHaveLength(1);
    expect((await request(localPort, "/api/mobile/qr.svg?ip=127.0.0.1")).status).toBe(404);
  });
});
