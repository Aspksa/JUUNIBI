// JUUNIBI launcher: install -> checks (typecheck + tests) -> build -> free port -> serve -> open browser.
// Usage: node scripts/launch.mjs [--dev] [--no-open] [--skip-checks] [--port N]
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const dev = flag("--dev");
const wantPort = Number(opt("--port") ?? (dev ? 5173 : 4173));
const bin = (...p) => path.join(root, "node_modules", ...p);

const step = (t) => console.log(`\n\x1b[36m==> ${t}\x1b[0m`);
const fail = (t) => { console.error(`\n\x1b[31m[ОШИБКА] ${t}\x1b[0m`); process.exit(1); };

function run(label, cmd, cmdArgs, { shell = false, cwd = root } = {}) {
  step(label);
  const r = spawnSync(cmd, cmdArgs, { cwd, stdio: "inherit", shell });
  if (r.status !== 0) fail(`${label}: не удалось (код ${r.status ?? r.error?.message}).`);
}

// --- port check: a port is free only if we can bind it on every loopback family ---
function canListen(port, host) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", (e) => resolve(e.code === "EADDRNOTAVAIL" || e.code === "EAFNOSUPPORT"));
    s.listen({ port, host, exclusive: true }, () => s.close(() => resolve(true)));
  });
}
async function isFree(port) {
  for (const h of ["127.0.0.1", "::1", "0.0.0.0"]) if (!(await canListen(port, h))) return false;
  return true;
}
async function findPort(start) {
  for (let p = start; p < start + 100 && p <= 65535; p++) {
    if (await isFree(p)) return p;
    console.log(`Порт ${p} занят, пробую следующий...`);
  }
  fail(`Нет свободных портов в диапазоне ${start}-${start + 99}.`);
}

function waitReady(url, ms = 30000) {
  const end = Date.now() + ms;
  return new Promise((resolve) => {
    const tick = () => {
      http.get(url, (res) => { res.resume(); resolve(true); }).on("error", () => {
        if (Date.now() > end) resolve(false); else setTimeout(tick, 300);
      });
    };
    tick();
  });
}

function openBrowser(url) {
  const [cmd, a] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin" ? ["open", [url]]
    : ["xdg-open", [url]];
  try { spawn(cmd, a, { stdio: "ignore", detached: true }).on("error", () => {}).unref(); } catch { /* ignore */ }
}

// --- main ---
if (Number(process.versions.node.split(".")[0]) < 20) fail(`Нужен Node.js 20+, найден ${process.version}.`);

if (!existsSync(bin("vite", "bin", "vite.js"))) {
  const lock = existsSync(path.join(root, "package-lock.json"));
  run("Установка зависимостей", "npm", [lock ? "ci" : "install", "--no-audit", "--no-fund"], { shell: true });
}

const PKGS = ["packages/core", "packages/assistant", "apps/server", "apps/web"];
const TESTED = ["packages/core", "packages/assistant", "apps/server"];

if (!flag("--skip-checks")) {
  for (const p of PKGS) run(`Проверка типов: ${p}`, process.execPath, [bin("typescript", "bin", "tsc"), "-p", `${p}/tsconfig.json`]);
  for (const p of TESTED) run(`Тесты: ${p}`, process.execPath, [bin("vitest", "vitest.mjs"), "run"], { cwd: path.join(root, p) });
}

const web = path.join(root, "apps", "web");
run("Сборка сервера", process.execPath, [path.join(root, "scripts", "build-server.mjs")]);
if (!dev) run("Сборка веба", process.execPath, [bin("vite", "bin", "vite.js"), "build"], { cwd: web });

if (!existsSync(path.join(root, ".env"))) {
  console.log("\n\x1b[33m[!] Файл .env не найден: помощник будет выключен. Скопируйте .env.example в .env и впишите ключ Cloud.ru.\x1b[0m");
}

const port = await findPort(wantPort);
const url = `http://127.0.0.1:${port}/`;
step(`Запуск сервера на порту ${port}`);
const children = [];
const spawnChild = (cmd, a, o) => {
  const c = spawn(cmd, a, { stdio: "inherit", ...o });
  children.push(c);
  c.on("exit", (code) => { if (code) console.error(`Процесс завершился с кодом ${code}`); stop(code ?? 0); });
  return c;
};
function stop(code = 0) { for (const c of children) c.kill(); process.exit(code); }
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());

spawnChild(process.execPath, [path.join(root, "apps", "server", "dist", "server.mjs")], { cwd: root, env: { ...process.env, PORT: String(port) } });
let openUrl = url;
if (dev) {
  const vitePort = await findPort(port + 1);
  spawnChild(process.execPath, [bin("vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"], {
    cwd: web, env: { ...process.env, VITE_API_TARGET: `http://127.0.0.1:${port}` },
  });
  openUrl = `http://127.0.0.1:${vitePort}/`;
}

if (await waitReady(`${url}api/status`) && (!dev || await waitReady(openUrl))) {
  console.log(`\n\x1b[32mJUUNIBI работает: ${openUrl}\x1b[0m  (Ctrl+C — остановить)`);
  if (!flag("--no-open")) openBrowser(openUrl);
} else {
  fail("Сервер не ответил за 30 секунд.");
}
