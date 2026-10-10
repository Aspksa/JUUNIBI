// JUUNIBI launcher: install -> checks (typecheck + tests) -> build -> free port -> serve -> open browser.
// Usage: node scripts/launch.mjs [--dev] [--no-open] [--skip-checks] [--port N]
import { spawn, spawnSync } from "node:child_process";
import { applyPreparedUpdate, applyRollbackRequest, confirmUpdate, rollbackFailedStart } from "./apply-update.mjs";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import net from "node:net";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(script), "..");
/** The server exits with this code when the user asks to install an update right away: the launcher starts everything again. */
const RESTART_CODE = 75;
let touched = false;        // an update or a rollback was applied during THIS start
let updateApplied = false;  // a new version was installed and has not proved yet that it starts
let rollingBack = false;
try { if (await applyRollbackRequest(root)) { touched = true; console.log("\n\x1b[36m==> Выполнен откат на предыдущую версию\x1b[0m"); } }
catch (e) { console.error(`\n\x1b[33m[!] Откат не выполнен: ${e?.message ?? e}. Запускается текущая версия.\x1b[0m`); }
try { if (await applyPreparedUpdate(root)) { touched = true; updateApplied = true; } }
catch (e) {
  // A failed (already rolled back) or damaged update must not block every later start: set it aside and run the current version.
  console.error(`\n\x1b[33m[!] Обновление не установлено: ${e?.message ?? e}. Запускается текущая версия.\x1b[0m`);
  const ready = path.join(root, ".updates", "ready.json");
  try { if (existsSync(ready)) renameSync(ready, path.join(root, ".updates", `ready.failed-${Date.now()}.json`)); } catch { /* keep going */ }
}
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const dev = flag("--dev");
const wantPort = Number(opt("--port") ?? (dev ? 5173 : 4173));
const bin = (...p) => path.join(root, "node_modules", ...p);

const step = (t) => console.log(`\n\x1b[36m==> ${t}\x1b[0m`);
const children = [];
let currentPort; // the port this launcher serves on once it is chosen; kept when everything is started again
let ending = false; // a restart or a rollback is in progress: children that exit now are expected, not a reason to stop
const killChildren = () => { for (const c of children) { try { c.kill(); } catch { /* already gone */ } } };

/**
 * Starts this launcher again (same options). This process stays only as a thin parent: signals are passed on
 * to the new launcher and its result becomes ours.
 */
function relaunch({ env = {}, extra = [], port } = {}) {
  ending = true;
  const base = [];
  const keep = port ?? currentPort;
  for (let i = 0; i < args.length; i++) { if (args[i] === "--port" && keep) { i++; continue; } base.push(args[i]); }
  killChildren();
  const next = spawn(process.execPath, [script, ...base, ...(keep ? ["--port", String(keep)] : []), ...extra], { stdio: "inherit", env: { ...process.env, ...env } });
  children.length = 0; children.push(next); // stop() now reaches the new launcher
  next.on("exit", (code) => process.exit(code ?? 1));
  next.on("error", (e) => { console.error(`[ОШИБКА] Не удалось перезапустить: ${e.message}`); process.exit(1); });
}

/** A new version that does not start is rolled back automatically; the launcher then starts the previous one. */
async function fail(t) {
  if (ending) await new Promise(() => {}); // a restart/rollback already owns the outcome of this process
  console.error(`\n\x1b[31m[ОШИБКА] ${t}\x1b[0m`);
  if (updateApplied && !rollingBack) {
    rollingBack = true; ending = true;
    killChildren();
    try {
      if (await rollbackFailedStart(root, t)) {
        console.error("\x1b[33m[!] Новая версия не запустилась — возвращена прежняя. Запускаю её заново.\x1b[0m");
        relaunch({ env: { JUUNIBI_REINSTALL: "1" } });
        await new Promise(() => {}); // the new launcher decides how this ends
      }
    } catch (e) { console.error(`\x1b[31m[ОШИБКА] Откат не удался: ${e?.message ?? e}\x1b[0m`); }
  }
  process.exit(1);
}

async function run(label, cmd, cmdArgs, { shell = false, cwd = root } = {}) {
  step(label);
  const r = spawnSync(cmd, cmdArgs, { cwd, stdio: "inherit", shell });
  if (r.status !== 0) await fail(`${label}: не удалось (код ${r.status ?? r.error?.message}).`);
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
  return fail(`Нет свободных портов в диапазоне ${start}-${start + 99}.`);
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
if (Number(process.versions.node.split(".")[0]) < 20) await fail(`Нужен Node.js 20+, найден ${process.version}.`);

// Dependencies are reinstalled when they are missing, when an update/rollback changed package-lock.json,
// or after an automatic rollback. Scripts of dependencies are not run for code that has just been updated.
const lockFile = path.join(root, "package-lock.json");
const lockStamp = bin(".juunibi-lock");
const lockNow = existsSync(lockFile) ? createHash("sha1").update(readFileSync(lockFile)).digest("hex") : "";
const stamped = (() => { try { return readFileSync(lockStamp, "utf8").trim(); } catch { return ""; } })();
const forced = process.env.JUUNIBI_REINSTALL === "1";
if (!existsSync(bin("vite", "bin", "vite.js")) || forced || (touched && stamped !== lockNow)) {
  const safeMode = touched || forced;
  await run("Установка зависимостей", "npm", [lockNow ? "ci" : "install", "--no-audit", "--no-fund", ...(safeMode ? ["--ignore-scripts"] : [])], { shell: true });
  try { writeFileSync(lockStamp, lockNow + "\n"); } catch { /* the stamp only saves time */ }
}

const PKGS = ["packages/core", "packages/assistant", "apps/server", "apps/web"];
const TESTED = ["packages/core", "packages/assistant", "apps/server", "apps/web"];

if (!flag("--skip-checks")) {
  for (const p of PKGS) await run(`Проверка типов: ${p}`, process.execPath, [bin("typescript", "bin", "tsc"), "-p", `${p}/tsconfig.json`]);
  for (const p of TESTED) await run(`Тесты: ${p}`, process.execPath, [bin("vitest", "vitest.mjs"), "run"], { cwd: path.join(root, p) });
}

const web = path.join(root, "apps", "web");
await run("Сборка сервера", process.execPath, [path.join(root, "scripts", "build-server.mjs")]);
if (!dev) await run("Сборка веба", process.execPath, [bin("vite", "bin", "vite.js"), "build"], { cwd: web });

if (!existsSync(path.join(root, ".env"))) {
  console.log("\n\x1b[33m[!] Файл .env не найден: помощник будет выключен. Скопируйте .env.example в .env и впишите ключ Cloud.ru.\x1b[0m");
}

const port = await findPort(wantPort);
currentPort = port;
const url = `http://127.0.0.1:${port}/`;
step(`Запуск сервера на порту ${port}`);
let serverReady = false;
const spawnChild = (cmd, a, o) => {
  const c = spawn(cmd, a, { stdio: "inherit", ...o });
  children.push(c);
  c.on("exit", (code) => {
    if (ending) return;
    if (code === RESTART_CODE) { // "install the update now": start everything again, the page is already open
      console.log("\n\x1b[36m==> Перезапуск для установки обновления\x1b[0m");
      return relaunch({ extra: ["--no-open"], port });
    }
    if (code) console.error(`Процесс завершился с кодом ${code}`);
    // A freshly installed version that dies before it ever answered is rolled back instead of ending the launcher.
    if (code && updateApplied && !serverReady && !rollingBack) return void fail(`Новая версия завершилась с кодом ${code} сразу после запуска.`);
    stop(code ?? 0);
  });
  return c;
};
function stop(code = 0) { for (const c of children) c.kill(); process.exit(code); }
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());

spawnChild(process.execPath, [path.join(root, "apps", "server", "dist", "server.mjs")], { cwd: root, env: { ...process.env, PORT: String(port), JUUNIBI_SUPERVISED: "1" } });
let openUrl = url;
if (dev) {
  const vitePort = await findPort(port + 1);
  spawnChild(process.execPath, [bin("vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"], {
    cwd: web, env: { ...process.env, VITE_API_TARGET: `http://127.0.0.1:${port}` },
  });
  openUrl = `http://127.0.0.1:${vitePort}/`;
}

if (await waitReady(`${url}api/status`) && (!dev || await waitReady(openUrl))) {
  if (ending) await new Promise(() => {}); // another launcher took over (rollback/restart): it reports readiness
  serverReady = true;
  if (updateApplied) await confirmUpdate(root); // the new version really started: the install is final
  console.log(`\n\x1b[32mJUUNIBI работает: ${openUrl}\x1b[0m  (Ctrl+C — остановить)`);
  if (!flag("--no-open")) openBrowser(openUrl);
} else {
  await fail("Сервер не ответил за 30 секунд.");
}
