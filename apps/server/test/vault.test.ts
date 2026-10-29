import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { rm } from "./temp-files";
import os from "node:os";
import path from "node:path";
import { Vault } from "../src/vault";

const dirs: string[] = [];
const vaults: Vault[] = [];
afterEach(async () => {
  for (const v of vaults.splice(0)) v.stop();
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
async function make(now?: () => number) {
  const d = await mkdtemp(path.join(os.tmpdir(), "juunibi-vault-"));
  dirs.push(d);
  const file = path.join(d, "vault.json");
  const v = new Vault(file, now);
  vaults.push(v);
  return { v, file };
}

describe("«Пароли»", () => {
  it("keeps records encrypted on disk and opens them only with the master password", async () => {
    const { v, file } = await make();
    expect(await v.status()).toMatchObject({ exists: false, unlocked: false });
    await expect(v.setup("short")).rejects.toThrow(/от 8/);
    await v.setup("кицунэ-2026!");
    await v.add({ title: "Почта", login: "me@example.ru", password: "Секрет-12345", note: "двухфакторка в телефоне" });
    const raw = await readFile(file, "utf8");
    expect(raw).not.toContain("Секрет-12345");
    expect(raw).not.toContain("me@example.ru");
    expect(raw).not.toContain("Почта");
    v.lock();
    expect(() => v.list()).toThrow(/закрыты/);
    await expect(v.unlock("не тот пароль")).rejects.toThrow(/Неверный/);
    const again = new Vault(file);
    vaults.push(again);
    await again.unlock("кицунэ-2026!");
    expect(again.list()).toMatchObject([{ title: "Почта", login: "me@example.ru", password: "Секрет-12345" }]);
  });

  it("closes itself after the chosen minutes without use", async () => {
    let now = 1_000_000;
    const { v } = await make(() => now);
    await v.setup("кицунэ-2026!");
    await v.setLockMinutes(1);
    now += 30_000;
    expect(v.list()).toEqual([]);
    now += 61_000;
    expect(() => v.list()).toThrow(/закрыты/);
  });

  it("slows down guessing after five wrong passwords", async () => {
    let now = 5_000_000;
    const { v } = await make(() => now);
    await v.setup("кицунэ-2026!");
    v.lock();
    for (let i = 0; i < 5; i++) await expect(v.unlock("wrong-" + i)).rejects.toThrow(/Неверный/);
    await expect(v.unlock("кицунэ-2026!")).rejects.toThrow(/Подождите/);
    now += 31_000;
    await v.unlock("кицунэ-2026!");
    expect((await v.status()).unlocked).toBe(true);
  });

  it("edits, deletes and changes the master password", async () => {
    const { v, file } = await make();
    await v.setup("кицунэ-2026!");
    const a = await v.add({ title: "Госуслуги", login: "79990001122", password: "p1" });
    await expect(v.add({ login: "x" })).rejects.toThrow(/название/);
    await v.update(a.id, { password: "p2" });
    expect(v.list()[0]).toMatchObject({ login: "79990001122", password: "p2" });
    await expect(v.changePassword("не тот", "новый-пароль-1")).rejects.toThrow(/неверный/);
    await v.changePassword("кицунэ-2026!", "новый-пароль-1");
    const again = new Vault(file);
    vaults.push(again);
    await expect(again.unlock("кицунэ-2026!")).rejects.toThrow(/Неверный/);
    await again.unlock("новый-пароль-1");
    expect(again.list()[0]!.password).toBe("p2");
    await again.remove(a.id);
    expect(again.list()).toEqual([]);
  });

  it("restores a downloaded copy only with its own master password", async () => {
    const { v } = await make();
    await v.setup("кицунэ-2026!");
    await v.add({ title: "Wi-Fi", password: "домашний" });
    const copy = await v.exportFile();
    const { v: other } = await make();
    await expect(other.importFile(copy, "не тот")).rejects.toThrow(/не подходит/);
    await expect(other.importFile("{}", "кицунэ-2026!")).rejects.toThrow(/не копия/);
    await other.importFile(copy, "кицунэ-2026!");
    expect(other.list()).toMatchObject([{ title: "Wi-Fi", password: "домашний" }]);
  });
});
