import { afterEach, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/app";
import { LocalDisk } from "../src/local-disk";

let root: string, disk: LocalDisk, server: http.Server, base: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "juunibi-backup-api-")); disk = new LocalDisk(path.join(root, "source"));
  server = createApp({ modules: () => [], configured: {}, disk });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); });

describe("Disk backup HTTP", () => {
  it("exports a deleted branch through HTTP and restores its content", async () => {
    await disk.createFolder("A"); const file = await disk.uploadBytes("x.txt", "A", Buffer.from("bytes")); await disk.trashFolder("A");
    const response = await fetch(base + "/api/disk/backup"); expect(response.status).toBe(200);
    const lines = (await response.text()).trim().split("\n");
    const restored = new LocalDisk(path.join(root, "target")); await restored.importBackup((async function* () { yield* lines; })());
    await restored.restoreFolder("A"); expect(Buffer.from((await restored.download(file.id)).base64, "base64").toString()).toBe("bytes");
  });
  it("releases the Disk queue when a client disconnects during archive download", async () => {
    await disk.uploadBytes("large.txt", "", Buffer.alloc(8 * 1024 * 1024, 65));
    await new Promise<void>((resolve, reject) => {
      const request = http.get(base + "/api/disk/backup", response => {
        response.once("data", () => { response.destroy(); resolve(); });
        response.once("error", reject);
      });
      request.once("error", reject);
    });
    // If export leaves its mutation lock held after close, this operation never completes.
    await disk.createFolder("After disconnect");
    expect(disk.list().folders).toEqual(["After disconnect"]);
  }, 5000);
});
