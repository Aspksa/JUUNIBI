import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileAccessError, MAX_READ_BYTES, cleanRelative, deniedPath, listDir, readText, searchText, writeText } from "./safe-files";

let tmp: string, root: string, outside: string, backups: string;
beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "juunibi-files-"));
  root = path.join(tmp, "docs"); outside = path.join(tmp, "outside"); backups = path.join(tmp, "backups");
  await mkdir(path.join(root, "sub"), { recursive: true }); await mkdir(outside); await mkdir(path.join(root, ".git")); await mkdir(path.join(root, "node_modules"));
  await writeFile(path.join(root, "a.txt"), "Первая строка\nВторая про чай\n");
  await writeFile(path.join(root, "sub", "b.md"), "# Заметка\nчай и кофе");
  await writeFile(path.join(root, ".env"), "KEY=secret");
  await writeFile(path.join(root, "id_rsa"), "PRIVATE");
  await writeFile(path.join(root, ".git", "config"), "[core]");
  await writeFile(path.join(root, "node_modules", "x.js"), "чай");
  await writeFile(path.join(outside, "secret.txt"), "за пределами");
  await writeFile(path.join(root, "bin.dat"), Buffer.from([1, 2, 0, 3, 4]));
});
afterEach(() => rm(tmp, { recursive: true, force: true }));
const refused = (p: Promise<unknown>, status?: number) => expect(p).rejects.toSatisfy((e: unknown) => e instanceof FileAccessError && (status === undefined || e.status === status));

describe("пути", () => {
  it("cleanRelative отсекает абсолютные пути, .., NUL и секреты до обращения к диску", () => {
    for (const bad of ["/etc/passwd", "C:\\Windows", "~/x", "../x", "a/../../x", "a\\..\\x", ".env", "sub/.env.local", ".git/config", "node_modules/x", "data/x", "k.pem", "a\0b", 5, "x".repeat(401)])
      expect(() => cleanRelative(bad), String(bad)).toThrow(FileAccessError);
    expect(cleanRelative("./sub//b.md")).toBe("sub/b.md");
    expect(cleanRelative("")).toBe("");
    expect(cleanRelative("sub\\b.md")).toBe("sub/b.md");
    expect(deniedPath("docs/.env")).toBe(true);
    expect(deniedPath("docs/readme.md")).toBe(false);
  });
  it("без выбранной папки доступа нет", async () => { await refused(listDir("", ""), 403); await refused(readText("", "a.txt"), 403); });
  it("корень диска как папка не годится для чтения: несуществующая папка тоже отклоняется", async () => { await refused(listDir(path.join(tmp, "nope"), ""), 403); });
});

describe("чтение", () => {
  it("список папки без секретов, скрытых служебных папок и ссылок", async () => {
    if (process.platform !== "win32") await symlink(outside, path.join(root, "link"));
    const r = await listDir(root, "");
    expect(r.entries.map((e) => e.name)).toEqual(["a.txt", "bin.dat", "sub"]);
    expect((await listDir(root, "sub")).entries).toEqual([{ name: "b.md", type: "file", size: Buffer.byteLength("# Заметка\nчай и кофе") }]);
    await refused(listDir(root, "nope"), 404);
  });
  it("читает текст, режет большие файлы и отказывает бинарным, секретным и чужим", async () => {
    expect((await readText(root, "a.txt")).text).toContain("про чай");
    await writeFile(path.join(root, "big.txt"), "я".repeat(MAX_READ_BYTES));
    const big = await readText(root, "big.txt");
    expect(big.truncated).toBe(true);
    expect(Buffer.byteLength(big.text)).toBeLessThanOrEqual(MAX_READ_BYTES);
    await refused(readText(root, "bin.dat"));
    await refused(readText(root, ".env"), 403);
    await refused(readText(root, "id_rsa"), 403);
    await refused(readText(root, ".git/config"), 403);
    await refused(readText(root, "../outside/secret.txt"));
    await refused(readText(root, "sub"));
  });
  it.skipIf(process.platform === "win32")("символическая ссылка наружу не работает ни на файл, ни на папку", async () => {
    await symlink(path.join(outside, "secret.txt"), path.join(root, "leak.txt"));
    await symlink(outside, path.join(root, "leakdir"));
    await refused(readText(root, "leak.txt"), 403);
    await refused(readText(root, "leakdir/secret.txt"), 403);
    await refused(listDir(root, "leakdir"), 403);
  });
  it.skipIf(process.platform === "win32")("ссылка внутри папки на секрет тоже закрыта", async () => {
    await symlink(path.join(root, ".env"), path.join(root, "innocent.txt"));
    await refused(readText(root, "innocent.txt"), 403);
  });
});

describe("поиск", () => {
  it("находит строки, пропуская секреты, node_modules, бинарные и ссылки", async () => {
    await symlink(outside, path.join(root, "link"));
    const r = await searchText(root, "ЧАЙ");
    expect(r.hits.map((h) => h.path).sort()).toEqual(["a.txt", "sub/b.md"]);
    expect(r.hits.find((h) => h.path === "a.txt")).toMatchObject({ line: 2 });
    expect(r.complete).toBe(true);
    expect((await searchText(root, "secret")).hits).toEqual([]); // .env и ссылка наружу не просматриваются
    await refused(searchText(root, "x"));
  });
});

describe("запись", () => {
  it("создаёт файл и недостающие папки, перезаписывает с резервной копией", async () => {
    const created = await writeText(root, "новое/заметки.md", "# Привет", backups);
    expect(created).toMatchObject({ path: "новое/заметки.md", created: true });
    expect(await readFile(path.join(root, "новое", "заметки.md"), "utf8")).toBe("# Привет");
    const again = await writeText(root, "новое/заметки.md", "# Новая версия", backups);
    expect(again.created).toBe(false);
    expect(await readFile(again.backup!, "utf8")).toBe("# Привет");
    expect(await readFile(path.join(root, "новое", "заметки.md"), "utf8")).toBe("# Новая версия");
    expect((await readdir(path.join(root, "новое"))).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });
  it("запрещает скрипты и исполняемые, секреты, обход, ссылки и большие файлы", async () => {
    for (const bad of ["run.sh", "x.bat", "x.exe", "a.js", "a.py", "noext", ".env", "k.pem", "../x.txt", "/abs.txt", ".git/hook.txt", "node_modules/x.txt"])
      await refused(writeText(root, bad, "x", backups));
    await refused(writeText(root, "ok.txt", "x".repeat(200_001), backups));
    await refused(writeText(root, "ok.txt", "a\0b", backups));
    await refused(writeText(root, "ok.txt", 5 as never, backups));
    await refused(writeText(root, "", "x", backups));
    if (process.platform !== "win32") {
      await symlink(path.join(outside, "secret.txt"), path.join(root, "link.txt"));
      await refused(writeText(root, "link.txt", "перезапись", backups), 403);
      expect(await readFile(path.join(outside, "secret.txt"), "utf8")).toBe("за пределами");
      await symlink(outside, path.join(root, "outdir"));
      await refused(writeText(root, "outdir/new.txt", "x", backups), 403);
      await expect(readdir(outside)).resolves.toEqual(["secret.txt"]);
    }
  });
  it.skipIf(process.platform === "win32")("не позволяет записывать через ссылки наружу", async () => {
    await symlink(path.join(outside, "secret.txt"), path.join(root, "link.txt"));
    await refused(writeText(root, "link.txt", "перезапись", backups), 403);
    expect(await readFile(path.join(outside, "secret.txt"), "utf8")).toBe("за пределами");
    await symlink(outside, path.join(root, "outdir"));
    await refused(writeText(root, "outdir/new.txt", "x", backups), 403);
    await expect(readdir(outside)).resolves.toEqual(["secret.txt"]);
  });
  it("без выбранной папки запись невозможна", async () => { await refused(writeText("", "a.txt", "x", backups), 403); });
});
