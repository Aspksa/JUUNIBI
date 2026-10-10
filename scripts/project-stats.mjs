#!/usr/bin/env node
/**
 * «Жизнь проекта»: 85 unusual figures about JUUNIBI computed from its git history and current files,
 * each with the data for a small chart (a line, bars, a ring of a share, a split bar, dots or colour swatches).
 * Runs on GitHub (workflow stats.yml publishes the result to the `stats` branch, which installs without
 * .git download) and locally when the folder is a git checkout. Read-only: it never changes the repo.
 *
 *   node scripts/project-stats.mjs [--out file.json]
 * GITHUB_TOKEN + GITHUB_REPOSITORY (set in Actions) add the CI figures.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DAY = 86_400_000;
/** Lockfiles, images and maps would drown every figure: they are left out everywhere. */
const IGNORED = /(^|\/)package-lock\.json$|\.(png|jpe?g|gif|ico|webp|map|zip|woff2?)$/i;
const CODE = /\.(ts|tsx|mjs|cjs|js|css|html|py)$/i;
const TEST = /(^|\/)(test|tests)\/|\.test\.[cm]?[jt]s$/;
const LOGIC = /^(apps\/server\/src|packages\/[^/]+\/src)\//;
const FIX = /(fix|исправ|ошибк|баг|bug|почин|сломал)/i;
const URGENT = /(hotfix|срочн|urgent|crash|падает|упал|не запуска)/i;
const CLEAN = /(удал|убра|remove|clean|чист|рефактор|refactor|упрост)/i;

const fmt = (n) => Math.round(n).toLocaleString("ru-RU");
const plural = (n, [one, few, many]) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many; };
const dayKey = (iso) => iso.slice(0, 10);
const ruDate = (iso) => new Date(iso.slice(0, 10) + "T12:00:00Z").toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
const shortDate = (iso) => new Date(iso.slice(0, 10) + "T12:00:00Z").toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
const age = (ms) => ms < DAY ? `${Math.max(1, Math.round(ms / 3_600_000))} ч` : `${Math.round(ms / DAY)} ${plural(Math.round(ms / DAY), ["день", "дня", "дней"])}`;
const cut = (s, n = 70) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const dir2 = (p) => p.split("/").slice(0, -1).slice(0, 3).join("/") || ".";
const words = (s) => s.match(/[\p{L}\p{N}_]+/gu)?.length ?? 0;

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 512 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
}

/** Every commit, oldest first: date, subject and per-file line counts (renames counted as delete + create). */
function readLog(cwd) {
  const out = git(cwd, ["log", "--reverse", "--no-renames", "--format=%x1e%H%x1f%aI%x1f%s", "--numstat", "--summary"]);
  const commits = [];
  for (const chunk of out.split("\x1e").slice(1)) {
    const [head, ...rest] = chunk.split("\n");
    const [sha, date, subject] = head.split("\x1f");
    const c = { sha, date, subject: subject ?? "", files: [], created: [], deleted: [], add: 0, del: 0 };
    for (const line of rest) {
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
      if (m) {
        if (IGNORED.test(m[3]) || m[1] === "-") continue;
        const add = Number(m[1]), del = Number(m[2]);
        c.files.push({ path: m[3], add, del }); c.add += add; c.del += del;
        continue;
      }
      const s = /^ (create|delete) mode \d+ (.+)$/.exec(line);
      if (s && !IGNORED.test(s[2])) (s[1] === "create" ? c.created : c.deleted).push(s[2]);
    }
    commits.push(c);
  }
  return commits;
}

/** Words on added and removed lines of each commit, and the function names that were removed. */
function readWords(cwd) {
  const out = git(cwd, ["log", "--reverse", "--no-renames", "--format=%x1e%H", "-p", "--unified=0", "--no-color", "--no-ext-diff"]);
  const perCommit = new Map();
  const removedFns = new Set(), addedFns = new Set();
  for (const chunk of out.split("\x1e").slice(1)) {
    const nl = chunk.indexOf("\n");
    const sha = chunk.slice(0, nl);
    let file = "", add = 0, del = 0;
    for (const line of chunk.slice(nl + 1).split("\n")) {
      if (line.startsWith("diff --git ")) { file = line.split(" b/").pop() ?? ""; continue; }
      if (IGNORED.test(file) || line.startsWith("+++") || line.startsWith("---")) continue;
      if (line[0] === "+") { add += words(line); const f = /function\s+([A-Za-z_$][\w$]*)/.exec(line); if (f) addedFns.add(f[1]); }
      else if (line[0] === "-") { del += words(line); const f = /function\s+([A-Za-z_$][\w$]*)/.exec(line); if (f) removedFns.add(f[1]); }
    }
    perCommit.set(sha, { add, del });
  }
  return { perCommit, removedFns, addedFns };
}

function treeSize(cwd, rev) {
  if (!rev) return 0;
  let total = 0;
  for (const line of git(cwd, ["ls-tree", "-r", "-l", rev]).split("\n")) {
    const m = /^\S+ blob \S+\s+(\d+)\t(.+)$/.exec(line);
    if (m && !IGNORED.test(m[2])) total += Number(m[1]);
  }
  return total;
}

/** Lines still unchanged since the first day of the project (git blame over the code files). */
function ancientLines(cwd, files, firstDay) {
  let old = 0, all = 0;
  for (const f of files) {
    if (!CODE.test(f.path)) continue;
    let out = "";
    try { out = git(cwd, ["blame", "-w", "--line-porcelain", "HEAD", "--", f.path]); } catch { continue; }
    for (const line of out.split("\n")) {
      if (!line.startsWith("author-time ")) continue;
      all++;
      if (new Date(Number(line.slice(12)) * 1000).toISOString().slice(0, 10) === firstDay) old++;
    }
  }
  return { old, all };
}

async function ciFigures() {
  const token = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) return null;
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/actions/runs?per_page=100`, { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" } });
    if (!r.ok) return null;
    const runs = (await r.json()).workflow_runs.filter((x) => x.status === "completed" && x.name !== "Жизнь проекта");
    const finished = runs.filter((x) => x.conclusion === "success" || x.conclusion === "failure");
    const ok = finished.filter((x) => x.conclusion === "success").length;
    const times = runs.filter((x) => x.run_started_at).map((x) => (Date.parse(x.updated_at) - Date.parse(x.run_started_at)) / 1000).filter((s) => s > 0 && s < 3600);
    return { runs: finished.length, ok, avg: times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0, last: times.slice(0, 10).reverse() };
  } catch { return null; }
}

export async function computeStats(cwd = process.cwd(), now = Date.now()) {
  const commits = readLog(cwd);
  if (!commits.length) throw new Error("В репозитории нет коммитов");
  const { perCommit, removedFns, addedFns } = readWords(cwd);
  const tracked = git(cwd, ["ls-files"]).split("\n").filter((p) => p && !IGNORED.test(p));
  const files = [];
  for (const p of tracked) {
    try {
      const text = readFileSync(path.join(cwd, p), "utf8");
      files.push({ path: p, lines: text ? text.split("\n").length - (text.endsWith("\n") ? 1 : 0) : 0, bytes: statSync(path.join(cwd, p)).size, text });
    } catch { /* deleted locally or unreadable */ }
  }
  const present = new Set(files.map((f) => f.path));
  const first = commits[0], last = commits[commits.length - 1];
  const firstDay = dayKey(first.date);
  // the life of the project cut into 24 equal slices of time: the x axis of every «over time» chart
  const B = 24, t0 = Date.parse(first.date), span = Math.max(1, now - t0);
  const slot = (t) => Math.min(B - 1, Math.max(0, Math.floor(((t - t0) / span) * B)));
  const zeros = (n = B) => new Array(n).fill(0);
  const per = { commits: zeros(), words: zeros(), rewritten: zeros(), created: zeros(), deleted: zeros(), memory: zeros(), urgent: zeros(), cleanup: zeros(), fixes: zeros(), prs: zeros(), logicBorn: zeros(), pages: zeros(), testsBorn: zeros() };
  const weekdays = zeros(7), gaps = [], subjects = [];

  // per-file and per-day bookkeeping
  const touches = new Map(), lastChange = new Map(), net = new Map(), dirCommits = new Map(), dirFixes = new Map();
  const byDay = new Map(), hours = new Array(24).fill(0);
  let wordsAdded = 0, wordsRemoved = 0, wordsRewritten = 0, logicLines = 0, allLines = 0, memoryCommits = 0, nightCommits = 0, cleanupLines = 0;
  let fixes = 0, urgent = 0, prev = 0, bigBang = first, record = first;
  const prs = [];
  for (const c of commits) {
    const t = Date.parse(c.date);
    const w = perCommit.get(c.sha) ?? { add: 0, del: 0 };
    wordsAdded += w.add; wordsRemoved += w.del; wordsRewritten += Math.min(w.add, w.del);
    const k = slot(t);
    per.commits[k]++; per.words[k] += w.add; per.rewritten[k] += Math.min(w.add, w.del);
    per.created[k] += c.created.length; per.deleted[k] += c.deleted.length;
    per.logicBorn[k] += c.created.filter((p) => LOGIC.test(p) && !TEST.test(p)).length;
    per.pages[k] += c.created.filter((p) => /^apps\/web\/src\/pages\//.test(p) && !TEST.test(p)).length;
    per.testsBorn[k] += c.created.filter((p) => TEST.test(p)).length;
    weekdays[(new Date(dayKey(c.date) + "T12:00:00Z").getUTCDay() + 6) % 7]++;
    if (prev) gaps.push((t - prev) / 60_000);
    subjects.push(c.subject);
    const hour = Number(c.date.slice(11, 13));
    hours[hour]++;
    if (hour < 6) nightCommits++;
    const d = byDay.get(dayKey(c.date)) ?? { commits: 0, add: 0, del: 0 };
    d.commits++; d.add += c.add; d.del += c.del; byDay.set(dayKey(c.date), d);
    const isFix = FIX.test(c.subject);
    if (isFix) { fixes++; per.fixes[k]++; }
    if (isFix && (URGENT.test(c.subject) || (prev && t - prev < 3_600_000))) { urgent++; per.urgent[k]++; }
    if (CLEAN.test(c.subject)) { cleanupLines += c.del; per.cleanup[k] += c.del; }
    if (c.files.some((f) => /memory/i.test(f.path))) { memoryCommits++; per.memory[k]++; }
    if (c.files.length > bigBang.files.length) bigBang = c;
    if (c.add + c.del > record.add + record.del) record = c;
    const pr = /\(#(\d+)\)\s*$/.exec(c.subject);
    if (pr) { prs.push({ n: Number(pr[1]), title: c.subject.replace(/\s*\(#\d+\)\s*$/, ""), date: c.date }); per.prs[k]++; }
    const dirs = new Set();
    for (const f of c.files) {
      touches.set(f.path, (touches.get(f.path) ?? 0) + 1);
      lastChange.set(f.path, t);
      net.set(f.path, (net.get(f.path) ?? 0) + f.add - f.del);
      allLines += f.add + f.del;
      if (LOGIC.test(f.path) && !TEST.test(f.path)) logicLines += f.add + f.del;
      dirs.add(dir2(f.path));
    }
    for (const dir of dirs) {
      dirCommits.set(dir, (dirCommits.get(dir) ?? 0) + 1);
      if (isFix) dirFixes.set(dir, (dirFixes.get(dir) ?? 0) + 1);
    }
    prev = t;
  }
  const top = (m, keep = () => true) => [...m.entries()].filter(([k]) => keep(k)).sort((a, b) => b[1] - a[1])[0];
  const created = commits.flatMap((c) => c.created.map((p) => ({ p, t: Date.parse(c.date) })));
  const deleted = commits.flatMap((c) => c.deleted.map((p) => ({ p, t: Date.parse(c.date) })));
  const week = (t) => now - t < 7 * DAY;
  const code = files.filter((f) => CODE.test(f.path));
  const giant = [...code].sort((a, b) => b.lines - a.lines)[0];
  const tiny = code.filter((f) => f.lines > 0).sort((a, b) => a.lines - b.lines)[0];
  const oldest = [...lastChange.entries()].filter(([p]) => present.has(p)).sort((a, b) => a[1] - b[1])[0];
  const hot = top(touches, (p) => present.has(p));
  const grown = top(net, (p) => present.has(p));
  const sources = code.filter((f) => LOGIC.test(f.path) || /^apps\/web\/src\//.test(f.path)).filter((f) => !TEST.test(f.path));
  const testFiles = files.filter((f) => TEST.test(f.path));
  const tests = testFiles.reduce((n, f) => n + (f.text.match(/\b(it|test)(\.each\([^)]*\))?\(\s*["'`]/g)?.length ?? 0), 0);
  const tools = files.filter((f) => /assistant-tools\.ts$/.test(f.path)).reduce((n, f) => n + (f.text.match(/\bname:\s*"[a-z_]+"/g)?.length ?? 0), 0);
  const guards = sources.reduce((n, f) => n + (f.text.match(/throw\s+(bad\(|new Error|Object\.assign\(new Error)/g)?.length ?? 0), 0);
  const imports = sources.reduce((n, f) => n + (f.text.match(/from\s+["'](\.{1,2}\/|@juunibi\/)[^"']+["']/g)?.length ?? 0), 0);
  const packages = new Set(sources.map((f) => f.path.split("/").slice(0, 2).join("/"))).size;
  const ghosts = [...removedFns].filter((n) => !addedFns.has(n) || !files.some((f) => CODE.test(f.path) && f.text.includes("function " + n)));
  const days = [...byDay.keys()].sort();
  let best = 1, run = 1;
  for (let i = 1; i < days.length; i++) {
    run = Date.parse(days[i]) - Date.parse(days[i - 1]) === DAY ? run + 1 : 1;
    best = Math.max(best, run);
  }
  let current = 0;
  for (let t = Date.parse(new Date(now).toISOString().slice(0, 10)); byDay.has(new Date(t).toISOString().slice(0, 10)); t -= DAY) current++;
  const busiest = [...byDay.entries()].sort((a, b) => b[1].commits - a[1].commits)[0];
  const upheaval = [...byDay.entries()].sort((a, b) => b[1].del - a[1].del)[0];
  const leap = [...byDay.entries()].sort((a, b) => (b[1].add - b[1].del) - (a[1].add - a[1].del))[0];
  const peakHour = hours.indexOf(Math.max(...hours));
  const calendar = [];
  for (let i = 34; i >= 0; i--) calendar.push(byDay.get(new Date(now - i * DAY).toISOString().slice(0, 10))?.commits ?? 0);
  const thisWeek = commits.filter((c) => now - Date.parse(c.date) < 7 * DAY).length;
  const lastWeek = commits.filter((c) => now - Date.parse(c.date) >= 7 * DAY && now - Date.parse(c.date) < 14 * DAY).length;
  const weekAgo = git(cwd, ["rev-list", "-1", `--before=${new Date(now - 7 * DAY).toISOString()}`, "HEAD"]).trim();
  const weightNow = treeSize(cwd, "HEAD"), weightBefore = treeSize(cwd, weekAgo || first.sha);
  const ancient = ancientLines(cwd, files, firstDay);
  const frozen = files.filter((f) => lastChange.has(f.path) && now - lastChange.get(f.path) > 7 * DAY).length;
  const king = top(dirCommits);
  const hardest = top(dirFixes);
  const ci = await ciFigures();
  let branches = 0, tags = 0;
  try { branches = git(cwd, ["branch", "-r"]).split("\n").filter((l) => l.trim() && !l.includes("->")).length; tags = git(cwd, ["tag"]).split("\n").filter(Boolean).length; } catch { /* no remotes */ }
  const totalLines = files.reduce((n, f) => n + f.lines, 0);
  const birthday = new Date(first.date);
  const nextBirthday = new Date(Date.UTC(new Date(now).getUTCFullYear(), birthday.getUTCMonth(), birthday.getUTCDate()));
  if (nextBirthday.getTime() < now - DAY) nextBirthday.setUTCFullYear(nextBirthday.getUTCFullYear() + 1);
  const toBirthday = Math.ceil((nextBirthday.getTime() - now) / DAY);
  const years = nextBirthday.getUTCFullYear() - birthday.getUTCFullYear();
  const exts = new Set(code.map((f) => f.path.split(".").pop()));

  const achievements = [
    ["Первый коммит", true], ["Ночная сова", nightCommits > 0], ["Марафонец: 3 дня подряд", best >= 3], ["Сто коммитов", commits.length >= 100],
    ["Десять тысяч строк", totalLines >= 10_000], ["Большой взрыв: 50 файлов разом", bigBang.files.length >= 50],
    ["Чистюля: удалено больше, чем добавлено", commits.some((c) => c.del > c.add && c.del >= 200)], ["Тестировщик: 300 тестов", tests >= 300],
    ["Полиглот: 4 языка", exts.size >= 4], ["Сто PR", prs.length >= 100],
  ];
  const unlocked = achievements.filter(([, ok]) => ok).map(([t]) => t);
  const book = [{ date: first.date, text: "Рождение: " + cut(first.subject, 60) }, ...prs.slice(-7).map((p) => ({ date: p.date, text: `#${p.n} ${cut(p.title, 60)}` }))];

  // ---- data for the small charts and the 35 newer figures
  const cum = (s) => { let a = 0; return s.map((v) => (a += v)); };
  const ring = (a, b) => (b > 0 ? Math.round(1000 * Math.min(1, Math.max(0, a / b))) / 1000 : 0);
  const base = (p) => p.split("/").pop();
  const ranked = (entries, n = 8, name = base, asc = false) => {
    const e = [...entries].sort((a, b) => (asc ? a[1] - b[1] : b[1] - a[1])).slice(0, n);
    return { series: e.map((x) => x[1]), labels: e.map((x) => name(x[0])) };
  };
  const bars = (r) => ({ kind: "spark", series: r.series, labels: r.labels });
  const split = (r) => ({ kind: "split", series: r.series, labels: r.labels });
  const line = (series) => ({ kind: "line", series });
  const hist = (values, edges, unit = "") => {
    const s = zeros(edges.length + 1);
    for (const v of values) { const i = edges.findIndex((e) => v <= e); s[i < 0 ? edges.length : i]++; }
    return { kind: "spark", series: s, labels: [...edges.map((e) => `до ${e}${unit}`), `больше ${edges[edges.length - 1]}${unit}`] };
  };
  const lived = Math.min(14, Math.max(1, Math.round((Date.parse(new Date(now).toISOString().slice(0, 10)) - Date.parse(firstDay)) / DAY) + 1));
  const days14 = Array.from({ length: lived }, (_, i) => new Date(now - (lived - 1 - i) * DAY).toISOString().slice(0, 10)); // the last two weeks, or every day of a younger project
  const byDay14 = (fn) => ({ kind: "spark", series: days14.map((d) => fn(byDay.get(d) ?? { commits: 0, add: 0, del: 0 })), labels: days14.map(shortDate) });
  const part = (p) => (/^(apps|packages)\//.test(p) ? p.split("/").slice(0, 2).join("/") : p.includes("/") ? p.split("/")[0] : "корень");
  const partName = (k) => k.split("/")[1] ?? k;
  const perPart = (list, count) => {
    const m = new Map();
    for (const f of list) m.set(part(f.path), (m.get(part(f.path)) ?? 0) + count(f));
    return ranked(m, 8, partName);
  };
  const countIn = (re) => (f) => f.text.match(re)?.length ?? 0;
  const total = (list, count) => list.reduce((n, f) => n + count(f), 0);
  const lineCount = (list) => list.reduce((n, f) => n + f.lines, 0);

  // over time
  const weightSeries = [];
  for (let i = 1; i <= 12; i++) {
    const at = t0 + (span * i) / 12;
    const rev = i === 12 ? "HEAD" : git(cwd, ["rev-list", "-1", `--before=${new Date(at).toISOString()}`, "HEAD"]).trim();
    weightSeries.push(Math.round(treeSize(cwd, rev) / 1024));
  }
  // files and languages
  const byExt = new Map();
  for (const f of files) { const e = f.path.includes(".") ? f.path.split(".").pop().toLowerCase() : "без расширения"; byExt.set(e, (byExt.get(e) ?? 0) + f.lines); }
  const extFiles = new Map();
  for (const f of files) { const e = f.path.includes(".") ? f.path.split(".").pop().toLowerCase() : "—"; extFiles.set(e, (extFiles.get(e) ?? 0) + 1); }
  const topExt = ranked(byExt, 5, (k) => k);
  const allFileLines = lineCount(files);
  const codeLines = lineCount(code);
  const dirs = new Set(files.map((f) => f.path.split("/").slice(0, -1).join("/")).filter(Boolean));
  const topDirs = new Map();
  for (const f of files) { const seg = f.path.split("/"); const k = seg.length < 2 ? "корень" : /^(apps|packages)$/.test(seg[0]) && seg.length > 2 ? seg.slice(0, 2).join("/") : seg[0]; topDirs.set(k, (topDirs.get(k) ?? 0) + 1); }
  const docs = files.filter((f) => /\.md$/i.test(f.path));
  const data = files.filter((f) => /\.json$/i.test(f.path));
  const allBytes = files.reduce((n, f) => n + f.bytes, 0), dataBytes = data.reduce((n, f) => n + f.bytes, 0);
  // the app itself
  const web = sources.filter((f) => /^apps\/web\/src\//.test(f.path));
  const server = sources.filter((f) => /^apps\/server\/src\//.test(f.path));
  const pages = web.filter((f) => /^apps\/web\/src\/pages\//.test(f.path));
  const methods = new Map();
  for (const f of server) for (const m of f.text.matchAll(/req\.method === "(GET|POST|PUT|PATCH|DELETE)"/g)) methods.set(m[1], (methods.get(m[1]) ?? 0) + 1);
  const endpoints = [...methods.values()].reduce((a, b) => a + b, 0);
  const ruStrings = total(web, countIn(/(["'`])(?:(?!\1)[^\n\\])*[А-Яа-яЁё](?:(?!\1)[^\n\\])*\1/g));
  const ruLines = web.reduce((n, f) => n + f.text.split("\n").filter((l) => /[А-Яа-яЁё]/.test(l)).length, 0);
  const chat = web.filter((f) => /^apps\/web\/src\/chat\//.test(f.path));
  const awaits = total(sources, countIn(/\bawait\b/g));
  // rhythm
  const ordered = [...gaps].sort((a, b) => a - b);
  const medianGap = ordered.length ? ordered[Math.floor(ordered.length / 2)] : 0;
  const subjLen = subjects.map((x) => [...x].length);
  const ruSubjects = subjects.filter((x) => /[А-Яа-яЁё]/.test(x)).length;
  const activeDays = [...byDay.keys()].sort();
  // care
  const sourceLines = lineCount(sources), testLines = lineCount(testFiles);
  const anyUse = countIn(/:\s*any\b|\bas any\b|<any>/g), todo = countIn(/\b(TODO|FIXME|HACK|XXX)\b/g), catches = countIn(/\bcatch\b/g);
  const testsPerPart = perPart(testFiles, countIn(/\b(it|test)(\.each\([^)]*\))?\(\s*["'`]/g));
  // fun
  const emojis = new Map();
  for (const f of sources) for (const m of f.text.matchAll(/\p{Extended_Pictographic}/gu)) emojis.set(m[0], (emojis.get(m[0]) ?? 0) + 1);
  const emojiCount = [...emojis.values()].reduce((a, b) => a + b, 0);
  let longest = { len: 0, path: "" };
  const lineLens = [];
  for (const f of code) for (const l of f.text.split("\n")) { lineLens.push(l.length); if (l.length > longest.len) longest = { len: l.length, path: f.path }; }
  const names = new Map();
  for (const f of sources) for (const m of f.text.matchAll(/\b(?:function|const|let|class|interface|type)\s+([A-Za-z_$][\w$]*)/g)) names.set(m[1], m[1].length);
  const longNames = ranked(names, 8, (k) => k);
  const STOP = new Set(["чтобы", "после", "когда", "теперь", "только", "также", "через", "более", "этого", "который", "которые", "можно", "нужно", "больше", "сразу"]);
  const wordFreq = new Map();
  for (const x of subjects) for (const w of x.toLowerCase().match(/[а-яё]{5,}/g) ?? []) if (!STOP.has(w)) wordFreq.set(w, (wordFreq.get(w) ?? 0) + 1);
  const favWords = ranked(wordFreq, 8, (k) => k);
  const MAGIC = ["cafe", "face", "bead", "dead", "beef", "fade", "feed", "deed", "abba", "c0de", "babe", "d00d", "f00d", "0000", "1234", "aaaa"];
  const magic = commits.map((c) => ({ sha: c.sha.slice(0, 8), word: MAGIC.find((w) => c.sha.slice(0, 8).includes(w)) })).filter((x) => x.word);
  // code under the microscope
  const fnCount = countIn(/\bfunction\b|=>/g);
  const classes = total(sources, countIn(/\bclass\s+[A-Z]\w*/g));
  const interfaces = total(sources, countIn(/\binterface\s+[A-Z]\w*/g)), typeAliases = total(sources, countIn(/(^|\n)\s*(export\s+)?type\s+[A-Z]\w*\s*(<[^=]*>)?\s*=/g));
  const exported = total(sources, countIn(/(^|\n)export\s/g)), topDecls = total(sources, countIn(/(^|\n)(export\s+)?(default\s+)?(async\s+)?(function|const|let|class|interface|type|enum)\s/g));
  let commentLines = 0, blankLines = 0, codeAll = 0;
  for (const f of code) for (const l of f.text.split("\n")) { codeAll++; const x = l.trim(); if (!x) blankLines++; else if (/^(\/\/|\/\*|\*|<!--)/.test(x)) commentLines++; }
  const css = files.filter((f) => /\.css$/i.test(f.path));
  const cssRules = new Map(css.map((f) => [f.path, f.text.match(/\{/g)?.length ?? 0]));
  const cssVars = new Set(css.flatMap((f) => [...f.text.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]))).size;
  const colors = new Map();
  for (const f of [...css, ...web]) for (const m of f.text.matchAll(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi)) { const c = m[0].toLowerCase(); colors.set(c, (colors.get(c) ?? 0) + 1); }
  const regexes = countIn(/\/[^/\n*][^/\n]*\/[dgimsuy]*\.(test|exec)\(|\.(match|matchAll|replace|replaceAll|split|search)\(\s*\/|new RegExp\(/g);
  let deps = 0, devDeps = 0;
  for (const f of files.filter((x) => /(^|\/)package\.json$/.test(x.path))) {
    try { const j = JSON.parse(f.text); deps += Object.keys(j.dependencies ?? {}).length; devDeps += Object.keys(j.devDependencies ?? {}).length; } catch { /* not json */ }
  }

  const M = [];
  const fmtLines = (n) => `${fmt(n)} ${plural(Math.round(n), ["строка", "строки", "строк"])}`;
  const add = (group, id, emoji, title, hint, value, detail = "", extra = {}) => M.push({ id, group, emoji, title, hint, value, detail, ...extra });
  // ---- Анатомия файлов
  add("anatomy", "words_added", "📜", "Сколько слов родилось", "Все добавленные слова", fmt(wordsAdded), `за ${commits.length} ${plural(commits.length, ["коммит", "коммита", "коммитов"])}`, line(cum(per.words)));
  add("anatomy", "words_removed", "✂️", "Сколько слов исчезло", "Удалённые слова", fmt(wordsRemoved), wordsAdded ? `${Math.round((100 * wordsRemoved) / wordsAdded)}% от родившихся` : "", { ring: ring(wordsRemoved, wordsAdded) });
  add("anatomy", "words_rewritten", "🔄", "Переписанная история", "Сколько слов заменили", fmt(wordsRewritten), "слова, ушедшие ради новых", { kind: "spark", series: per.rewritten });
  add("anatomy", "files_born", "🍼", "Новорождённые файлы", "Создано за период", fmt(created.length), `за неделю: ${created.filter((x) => week(x.t)).length}`, line(cum(per.created)));
  add("anatomy", "files_graveyard", "💀", "Кладбище файлов", "Сколько удалено", fmt(deleted.length), deleted.slice(-3).map((x) => x.p.split("/").pop()).join(", "), { kind: "spark", series: per.deleted });
  add("anatomy", "giant", "🏋️", "Файл-гигант", "Самый большой файл", giant ? `${fmt(giant.lines)} ${plural(giant.lines, ["строка", "строки", "строк"])}` : "—", giant?.path ?? "", bars(ranked(code.map((f) => [f.path, f.lines]))));
  add("anatomy", "tiny", "🐜", "Самый маленький", "Минимум строк", tiny ? `${fmt(tiny.lines)} ${plural(tiny.lines, ["строка", "строки", "строк"])}` : "—", tiny?.path ?? "", bars(ranked(code.filter((f) => f.lines > 0).map((f) => [f.path, f.lines]), 8, base, true)));
  add("anatomy", "oldtimer", "🏚️", "Старожил проекта", "Дольше всех без изменений", oldest ? age(now - oldest[1]) : "—", oldest?.[0] ?? "", { kind: "spark", series: (() => { const s = zeros(); for (const [p, t] of lastChange) if (present.has(p)) s[slot(t)]++; return s; })() });
  add("anatomy", "hot", "🔥", "Горячий файл", "Чаще всего редактировали", hot ? `${hot[1]} ${plural(hot[1], ["правка", "правки", "правок"])}` : "—", hot?.[0] ?? "", bars(ranked([...touches].filter(([p]) => present.has(p)))));
  add("anatomy", "grown", "🌱", "Самый выросший", "Максимальный прирост строк", grown ? `+${fmt(grown[1])}` : "—", grown?.[0] ?? "", bars(ranked([...net].filter(([p]) => present.has(p)))));
  add("anatomy", "languages", "🎨", "Языки проекта", "Строки по типам файлов", topExt.labels[0] ? `${Math.round((100 * topExt.series[0]) / Math.max(1, allFileLines))}% ${topExt.labels[0]}` : "—", `всего ${fmtLines(allFileLines)}`, split(topExt));
  add("anatomy", "avg_file", "📏", "Средний файл", "Строк в файле кода", fmtLines(code.length ? codeLines / code.length : 0), `медиана: ${fmt([...code].sort((a, b) => a.lines - b.lines)[Math.floor(code.length / 2)]?.lines ?? 0)}`, hist(code.map((f) => f.lines), [50, 100, 200, 400, 800], " строк"));
  add("anatomy", "folders", "🗂️", "Папки", "Сколько разных папок", fmt(dirs.size), `файлов в среднем: ${(files.length / Math.max(1, dirs.size)).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}`, bars(ranked(topDirs, 8, (k) => k)));
  add("anatomy", "docs", "📝", "Документация", "Строки в файлах .md", fmtLines(lineCount(docs)), `${docs.length} ${plural(docs.length, ["файл", "файла", "файлов"])}, ${Math.round((100 * lineCount(docs)) / Math.max(1, allFileLines))}% всех строк`, { ring: ring(lineCount(docs), allFileLines) });
  add("anatomy", "data", "🗃️", "Данные", "Файлы JSON", `${(dataBytes / 1048576).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ`, `${data.length} ${plural(data.length, ["файл", "файла", "файлов"])}, ${Math.round((100 * dataBytes) / Math.max(1, allBytes))}% веса`, { ring: ring(dataBytes, allBytes) });
  // ---- Интеллект и возможности
  add("mind", "brain", "🧠", "Рост мозга", "Изменения файлов логики", `${fmt(logicLines)} ${plural(logicLines, ["строка", "строки", "строк"])}`, allLines ? `${Math.round((100 * logicLines) / allLines)}% всех правок` : "", { ring: ring(logicLines, allLines) });
  add("mind", "abilities", "🧩", "Новые способности", "Добавленные модули", fmt(created.filter((x) => LOGIC.test(x.p) && !TEST.test(x.p) && present.has(x.p)).length), `за неделю: ${created.filter((x) => LOGIC.test(x.p) && !TEST.test(x.p) && week(x.t)).length}`, line(cum(per.logicBorn)));
  add("mind", "library", "📚", "Библиотека знаний", "Объём базы знаний", "—", "считает работающий JUUNIBI");
  add("mind", "links", "🔗", "Новые связи", "Рост графа знаний", "—", "считает работающий JUUNIBI");
  add("mind", "memory", "💭", "Развитие памяти", "Новые функции памяти", `${memoryCommits} ${plural(memoryCommits, ["коммит", "коммита", "коммитов"])}`, `файлов памяти: ${files.filter((f) => /memory/i.test(f.path) && !TEST.test(f.path)).length}`, { kind: "spark", series: per.memory });
  add("mind", "tools", "🦾", "Новые инструменты", "Подключённые действия", fmt(tools), "инструментов у помощницы", { kind: "dots", series: [tools] });
  add("mind", "guards", "🛡️", "Защитные механизмы", "Новые проверки", fmt(guards), "проверок входных данных в коде", bars(perPart(sources, countIn(/throw\s+(bad\(|new Error|Object\.assign\(new Error)/g))));
  add("mind", "organs", "⚙️", "Внутренние органы", "Активные подсистемы", fmt(sources.length), `файлов кода в ${packages} ${plural(packages, ["части", "частях", "частях"])}`, split(perPart(sources, () => 1)));
  add("mind", "age", "🦊", "Возраст JUUNIBI", "Дней с первого коммита", age(now - Date.parse(first.date)), "с " + ruDate(first.date), line(cum(per.commits)));
  add("mind", "experiments", "🧪", "Эксперименты", "Проверенные изменения", fmt(prs.length), prs.length ? `последний: #${prs[prs.length - 1].n}` : "PR ещё не было", line(cum(per.prs)));
  add("mind", "pages", "🖼️", "Экраны интерфейса", "Файлы страниц", fmt(pages.length), `за неделю: ${created.filter((x) => /^apps\/web\/src\/pages\//.test(x.p) && !TEST.test(x.p) && present.has(x.p) && week(x.t)).length}`, line(cum(per.pages)));
  add("mind", "endpoints", "🔌", "Точки API", "Адреса, на которые отвечает сервер", fmt(endpoints), [...methods].map(([m, n]) => `${m} ${n}`).join(", "), split(ranked(methods, 5, (k) => k)));
  add("mind", "russian_ui", "🗣️", "Русская речь", "Русские фразы в интерфейсе", fmt(ruStrings), `${Math.round((100 * ruLines) / Math.max(1, lineCount(web)))}% строк интерфейса по-русски`, { ring: ring(ruLines, lineCount(web)) });
  add("mind", "chat_code", "💬", "Код чата", "Строк в окне чата", fmtLines(lineCount(chat)), `${chat.length} ${plural(chat.length, ["файл", "файла", "файлов"])}, ${Math.round((100 * lineCount(chat)) / Math.max(1, lineCount(web)))}% интерфейса`, { ring: ring(lineCount(chat), lineCount(web)) });
  add("mind", "async", "⏳", "Ожидания", "Сколько раз код ждёт ответа (await)", fmt(awaits), "сеть, диск, модель", bars(perPart(sources, countIn(/\bawait\b/g))));
  // ---- Жизнь и история
  add("life", "night", "🌙", "Ночные обновления", "Изменения после полуночи", fmt(nightCommits), `${Math.round((100 * nightCommits) / commits.length)}% коммитов с 00 до 06`, { ring: ring(nightCommits, commits.length) });
  add("life", "best_day", "☀️", "Самый продуктивный день", "Максимум изменений", `${busiest[1].commits} ${plural(busiest[1].commits, ["коммит", "коммита", "коммитов"])}`, ruDate(busiest[0]), byDay14((d) => d.commits));
  add("life", "record", "🏆", "Рекорд разработки", "Крупнейший коммит", `${fmt(record.add + record.del)} ${plural(record.add + record.del, ["строка", "строки", "строк"])}`, cut(record.subject), bars(ranked(commits.map((c) => [c.subject, c.add + c.del]), 8, (x) => cut(x, 40))));
  add("life", "streak", "🔥", "Серия активности", "Дней подряд с коммитами", `${best} ${plural(best, ["день", "дня", "дней"])}`, `текущая: ${current}`, byDay14((d) => (d.commits ? 1 : 0)));
  add("life", "hours", "🕰️", "Часы развития", "Когда чаще обновляется", `${String(peakHour).padStart(2, "0")}:00`, "пик по времени автора", { kind: "hours", series: hours });
  add("life", "upheaval", "🌪️", "День переворота", "Максимум переписанного кода", `−${fmt(upheaval[1].del)}`, ruDate(upheaval[0]), byDay14((d) => d.del));
  add("life", "hardest", "🛠️", "Самый трудный модуль", "Чаще всего исправлялся", hardest ? `${hardest[1]} ${plural(hardest[1], ["исправление", "исправления", "исправлений"])}` : "0", hardest?.[0] ?? "", bars(ranked(dirFixes, 8, (k) => k)));
  add("life", "calendar", "🗓️", "История по дням", "Календарь активности", `${calendar.filter(Boolean).length} из 35`, "активных дней за 5 недель", { kind: "calendar", series: calendar });
  add("life", "week", "📈", "Рост за неделю", "Сравнение с предыдущей", lastWeek ? `${thisWeek >= lastWeek ? "+" : "−"}${Math.abs(Math.round((100 * (thisWeek - lastWeek)) / lastWeek))}%` : `+${thisWeek}`, `${thisWeek} ${plural(thisWeek, ["коммит", "коммита", "коммитов"])} против ${lastWeek} неделей раньше`, { kind: "spark", series: [lastWeek, thisWeek], labels: ["прошлая неделя", "эта неделя"] });
  add("life", "birthday", "🎂", "День рождения", "Годовщина создания", shortDate(first.date), `через ${toBirthday} ${plural(toBirthday, ["день", "дня", "дней"])} исполнится ${years} ${plural(years, ["год", "года", "лет"])}`, { ring: ring(365 - Math.min(365, toBirthday), 365) });
  add("life", "weekend", "🛋️", "Выходные", "Коммиты в субботу и воскресенье", fmt(weekdays[5] + weekdays[6]), `${Math.round((100 * (weekdays[5] + weekdays[6])) / commits.length)}% всех коммитов`, { kind: "spark", series: weekdays, labels: ["пн", "вт", "ср", "чт", "пт", "сб", "вс"] });
  add("life", "gap", "⏱️", "Перерыв", "Обычная пауза между коммитами", medianGap < 60 ? `${Math.round(medianGap)} мин` : `${(medianGap / 60).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} ч`, "медиана пауз", hist(gaps, [5, 15, 30, 60, 180], " мин"));
  add("life", "subject_len", "✍️", "Длина подписей", "Символов в названии коммита", fmt(subjLen.reduce((a, b) => a + b, 0) / commits.length), `самое длинное: ${fmt(Math.max(...subjLen))}`, hist(subjLen, [20, 40, 60, 80, 100]));
  add("life", "russian_commits", "📮", "Коммиты по-русски", "Названия на русском", `${Math.round((100 * ruSubjects) / commits.length)}%`, `${ruSubjects} из ${commits.length}`, { ring: ring(ruSubjects, commits.length) });
  add("life", "tempo", "⚡", "Темп", "Коммитов в активный день", (commits.length / Math.max(1, activeDays.length)).toLocaleString("ru-RU", { maximumFractionDigits: 1 }), `${activeDays.length} ${plural(activeDays.length, ["активный день", "активных дня", "активных дней"])}`, { kind: "line", series: activeDays.slice(-30).map((d) => byDay.get(d).commits) });
  // ---- Надёжность и скорость
  add("care", "bugs", "🐛", "Охота на ошибки", "Подтверждённые исправления", fmt(fixes), `${Math.round((100 * fixes) / commits.length)}% коммитов`, { ring: ring(fixes, commits.length) });
  add("care", "urgent", "🚨", "Аварийные обновления", "Срочные исправления", fmt(urgent), "исправления меньше чем через час", { kind: "spark", series: per.urgent });
  add("care", "rescued", "🧯", "Спасённые установки", "Успешные откаты", "—", "считает работающий JUUNIBI");
  add("care", "green", "💚", "Зелёные проверки", "Доля успешного CI", ci?.runs ? `${Math.round((100 * ci.ok) / ci.runs)}%` : "—", ci?.runs ? `${ci.ok} из ${ci.runs} запусков` : "считается на GitHub", ci?.runs ? { ring: ring(ci.ok, ci.runs) } : {});
  add("care", "build", "🚀", "Скорость сборки", "Средняя длительность", ci?.avg ? `${Math.round(ci.avg)} с` : "—", ci?.avg ? "проверка на Windows и Linux" : "считается на GitHub", ci?.last?.length ? { kind: "spark", series: ci.last.map(Math.round) } : {});
  add("care", "weight", "📦", "Вес программы", "Изменение размера", `${(weightNow / 1048576).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ`, `${weightNow >= weightBefore ? "+" : "−"}${fmt(Math.abs(weightNow - weightBefore) / 1024)} КБ за неделю`, line(weightSeries));
  add("care", "startup", "💨", "Ускорение запуска", "До и после", "—", "считает работающий JUUNIBI");
  add("care", "tests", "🔍", "Глубина проверок", "Число тестов", fmt(tests), `в ${testFiles.length} ${plural(testFiles.length, ["файле", "файлах", "файлах"])}`, bars(testsPerPart));
  add("care", "cleanup", "🧹", "Генеральная уборка", "Удалённый устаревший код", `${fmt(cleanupLines)} ${plural(cleanupLines, ["строка", "строки", "строк"])}`, "в коммитах про уборку", { kind: "spark", series: per.cleanup });
  add("care", "integrity", "🔐", "Контроль целостности", "Проверенные файлы", fmt(files.length), "файлов под контролем версий", split(ranked(extFiles, 5, (k) => k)));
  add("care", "test_share", "🧫", "Код тестов", "Доля строк в тестах", `${Math.round((100 * testLines) / Math.max(1, testLines + sourceLines))}%`, `${fmtLines(testLines)} тестов на ${fmtLines(sourceLines)} кода`, { ring: ring(testLines, testLines + sourceLines) });
  add("care", "test_files", "🧪", "Тестовые файлы", "Сколько файлов с тестами", fmt(testFiles.length), `на ${sources.length} ${plural(sources.length, ["файл", "файла", "файлов"])} кода`, line(cum(per.testsBorn)));
  add("care", "any", "🧷", "Слабые типы", "Сколько раз написано any", fmt(total(sources, anyUse)), "чем меньше, тем надёжнее", bars(perPart(sources, anyUse)));
  add("care", "todo", "📌", "Отложенные дела", "TODO и FIXME в коде", fmt(total(sources, todo)), "заметки «доделать потом»", bars(perPart(sources, todo)));
  add("care", "catches", "🪂", "Страховки", "Перехваченные ошибки (catch)", fmt(total(sources, catches)), "места, где сбой не роняет программу", bars(perPart(sources, catches)));
  // ---- Секретные и забавные рекорды
  add("fun", "king", "👑", "Король изменений", "Самый редактируемый модуль", king ? `${king[1]} ${plural(king[1], ["коммит", "коммита", "коммитов"])}` : "—", king?.[0] ?? "", bars(ranked(dirCommits, 8, (k) => k)));
  add("fun", "ancient", "🦖", "Древнейший код", "Старейшие неизменные строки", fmt(ancient.old), ancient.all ? `${Math.round((100 * ancient.old) / ancient.all)}% кода живёт с ${shortDate(first.date)}` : "", { ring: ring(ancient.old, ancient.all) });
  add("fun", "ghosts", "👻", "Призраки прошлого", "Удалённые старые функции", fmt(ghosts.length), ghosts.slice(0, 3).join(", "), { kind: "dots", series: [ghosts.length] });
  add("fun", "leap", "🧬", "Эволюционный скачок", "Резкий рост проекта", `+${fmt(leap[1].add - leap[1].del)}`, ruDate(leap[0]), byDay14((d) => Math.max(0, d.add - d.del)));
  add("fun", "frozen", "🧊", "Замороженные файлы", "Давно не менялись", fmt(frozen), `из ${files.length}, без правок больше недели`, { ring: ring(frozen, files.length) });
  add("fun", "big_bang", "🧨", "Большой взрыв", "Самое масштабное обновление", `${bigBang.files.length} ${plural(bigBang.files.length, ["файл", "файла", "файлов"])}`, cut(bigBang.subject), bars(ranked(commits.map((c) => [c.subject, c.files.length]), 8, (x) => cut(x, 40))));
  add("fun", "universe", "🌌", "Вселенная зависимостей", "Связи между модулями", fmt(imports), `импортов в ${sources.length} файлах`, bars(perPart(sources, countIn(/from\s+["'](\.{1,2}\/|@juunibi\/)[^"']+["']/g))));
  add("fun", "rare", "💎", "Редкие достижения", "Необычные рекорды", `${unlocked.length} из ${achievements.length}`, unlocked.slice(-2).join(", "), { ring: ring(unlocked.length, achievements.length), kind: "list", list: achievements.map(([t, ok]) => (ok ? "✓ " : "· ") + t) });
  add("fun", "tree", "🌳", "Дерево поколений", "История версий и веток", `${prs.length} PR`, `веток: ${branches}, выпусков: ${tags}`, split({ series: [prs.length, branches, tags], labels: ["PR", "ветки", "выпуски"] }));
  add("fun", "book", "📖", "Книга жизни", "Автоматическая хроника", `${book.length} глав`, "от рождения до сегодня", { kind: "list", list: book.map((b) => `${shortDate(b.date)} · ${b.text}`) });
  add("fun", "emoji", "😀", "Эмодзи в коде", "Сколько эмодзи в исходниках", fmt(emojiCount), ranked(emojis, 5, (k) => k).labels.join(" "), bars(ranked(emojis, 8, (k) => k)));
  add("fun", "longest_line", "📐", "Самая длинная строка", "Символов в одной строке", fmt(longest.len), longest.path, hist(lineLens.filter((n) => n > 0), [40, 80, 120, 160, 200]));
  add("fun", "longest_name", "🐍", "Самое длинное имя", "Имя функции или переменной", longNames.labels[0] ? `${longNames.series[0]} букв` : "—", longNames.labels[0] ?? "", bars(longNames));
  add("fun", "fav_word", "🔤", "Любимое слово", "Чаще всего в названиях коммитов", favWords.labels[0] ?? "—", favWords.series[0] ? `${favWords.series[0]} ${plural(favWords.series[0], ["раз", "раза", "раз"])}` : "", bars(favWords));
  add("fun", "magic", "🔮", "Магия хешей", "Слова в номерах коммитов", fmt(magic.length), magic.slice(-3).map((x) => `${x.sha} (${x.word})`).join(", ") || "пока ни одного", { kind: "dots", series: [magic.length] });
  // ---- Код под микроскопом
  add("code", "functions", "🧮", "Функции", "Объявленные функции и стрелки", fmt(total(sources, fnCount)), `в среднем ${fmt(total(sources, fnCount) / Math.max(1, sources.length))} на файл`, bars(perPart(sources, fnCount)));
  add("code", "classes", "🏛️", "Классы", "Объявления class", fmt(classes), "большие подсистемы с состоянием", { kind: "dots", series: [classes] });
  add("code", "types", "📐", "Типы", "Интерфейсы и псевдонимы типов", fmt(interfaces + typeAliases), `interface: ${interfaces}, type: ${typeAliases}`, split({ series: [interfaces, typeAliases], labels: ["interface", "type"] }));
  add("code", "exports", "📤", "Экспорты", "Что видно другим модулям", fmt(exported), `${Math.round((100 * exported) / Math.max(1, topDecls))}% объявлений верхнего уровня`, { ring: ring(exported, topDecls) });
  add("code", "comments", "💬", "Комментарии", "Строки-пояснения в коде", fmtLines(commentLines), `${Math.round((100 * commentLines) / Math.max(1, codeAll - blankLines))}% непустых строк`, { ring: ring(commentLines, codeAll - blankLines) });
  add("code", "blank", "🌫️", "Воздух", "Пустые строки", fmtLines(blankLines), `${Math.round((100 * blankLines) / Math.max(1, codeAll))}% всех строк кода`, { ring: ring(blankLines, codeAll) });
  add("code", "css_rules", "🖌️", "Стили", "Правила CSS", fmt([...cssRules.values()].reduce((a, b) => a + b, 0)), `переменных оформления: ${cssVars}`, bars(ranked(cssRules)));
  add("code", "colors", "🌈", "Палитра", "Разные цвета в коде", fmt(colors.size), ranked(colors, 3, (k) => k).labels.join(" "), { kind: "swatches", list: ranked(colors, 24, (k) => k).labels });
  add("code", "regex", "🧵", "Регулярные выражения", "Поиск по шаблону", fmt(total(sources, regexes)), "разбор дат, команд и текста", bars(perPart(sources, regexes)));
  add("code", "deps", "📦", "Зависимости", "Пакеты npm", fmt(deps + devDeps), `для работы: ${deps}, для разработки: ${devDeps}`, split({ series: [deps, devDeps], labels: ["для работы", "для разработки"] }));

  return {
    version: 1, generatedAt: new Date(now).toISOString(), head: last.sha, commits: commits.length,
    groups: [
      { id: "anatomy", title: "Анатомия файлов" }, { id: "mind", title: "Интеллект и возможности" }, { id: "life", title: "Жизнь и история" },
      { id: "care", title: "Надёжность и скорость" }, { id: "fun", title: "Секретные и забавные рекорды" }, { id: "code", title: "Код под микроскопом" },
    ],
    metrics: M,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outAt = process.argv.indexOf("--out");
  const cwd = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const stats = await computeStats(cwd);
  const json = JSON.stringify(stats, null, outAt > 0 ? 1 : 0);
  if (outAt > 0) writeFileSync(process.argv[outAt + 1], json + "\n"); else process.stdout.write(json);
}
