import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { z } from "zod";
import type { DurableRecord } from "@/lib/durable-record-key";

const manifest = z.object({
  count: z.number().int().min(1).max(100),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
});
/** Chunks stay below SecureStore's 2048-byte per-value limit even with non-ASCII recipient details.
 * A final manifest is the commit point. A torn write fails closed rather than silently losing a pending request.
 * Commands are immutable while pending, so rewriting a pending record cannot mix different requests.
 */
export function withdrawalSecureRecord(
  key: string,
  storage: { get(key: string): string | null; set(key: string, value: string): void }
): DurableRecord {
  return {
    read: () => {
      const raw = storage.get(key);
      if (raw === null || raw === "cleared") return null;
      const record = manifest.parse(JSON.parse(raw));
      const parts = Array.from({ length: record.count }, (_, i) => storage.get(`${key}.${i}`));
      if (parts.some((part) => part === null))
        throw Error("Pending withdrawal storage is incomplete.");
      const value = parts.join("");
      if (bytesToHex(sha256(value)) !== record.hash)
        throw Error("Pending withdrawal storage mismatch.");
      return value;
    },
    write: (value) => {
      // The pending controller uses an empty string as a tombstone.
      if (!value) {
        const raw = storage.get(key);
        const previous = raw && raw !== "cleared" ? manifest.parse(JSON.parse(raw)) : null;
        storage.set(key, "cleared");
        for (let i = 0; i < (previous?.count ?? 0); i++) storage.set(`${key}.${i}`, "");
        return;
      }
      const parts = Array.from(value).reduce<string[]>((chunks, char) => {
        if (!chunks.length || chunks[chunks.length - 1]!.length >= 300) chunks.push("");
        chunks[chunks.length - 1] += char;
        return chunks;
      }, []);
      if (parts.length > 100) throw Error("Pending withdrawal is too large.");
      // No network request is sent until every chunk and the final manifest are stored.
      parts.forEach((part, i) => storage.set(`${key}.${i}`, part));
      storage.set(key, JSON.stringify({ count: parts.length, hash: bytesToHex(sha256(value)) }));
    },
  };
}
