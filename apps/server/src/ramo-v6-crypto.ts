import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { StorageAdapter } from "@juunibi/assistant";

const PREFIX = "RAMO6:AES256GCM:";
/** Opt-in at-rest encryption. Key must be 32 random bytes, hex encoded. No key is logged or stored. */
export function encryptedEvolutionStore(inner: StorageAdapter, hexKey?: string): StorageAdapter {
  if (!hexKey) return inner;
  if (!/^[a-f0-9]{64}$/i.test(hexKey)) throw new Error("RAMO_EVOLUTION_KEY must be 64 hex digits");
  const key = Buffer.from(hexKey, "hex");
  return {
    async load() {
      const raw = await inner.load();
      if (raw === null || !raw.startsWith(PREFIX)) return raw; // migration: legacy plaintext is read once, then encrypted on save
      const bytes = Buffer.from(raw.slice(PREFIX.length), "base64");
      if (bytes.length < 28) throw new Error("Invalid encrypted RAMO state");
      const iv = bytes.subarray(0, 12), tag = bytes.subarray(12, 28), data = bytes.subarray(28);
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    },
    async save(raw) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const data = Buffer.concat([cipher.update(raw, "utf8"), cipher.final()]);
      await inner.save(PREFIX + Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64"));
    },
  };
}
