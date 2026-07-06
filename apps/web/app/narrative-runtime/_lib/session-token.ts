/**
 * Stateless session codec. The whole session (bible + live state) is sealed
 * into an opaque, encrypted token that the client round-trips each turn — so
 * there is NO server-side session storage. Every web pod can therefore handle
 * every turn (no cross-pod session loss), and the bible (spoilers) stays opaque
 * to the client. Java owns the real, persisted, id-based sessions later.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Bible, LiveState } from "./types";

export interface SessionPayload {
  ipId: string;
  ipTitle: string;
  locale: string;
  bible: Bible;
  live: LiveState;
}

// Fixed key so all pods seal/open the same tokens. Prototype-grade (this is
// obfuscation to hide spoilers, not a security boundary); rotate/remove when
// Java takes over.
const KEY = createHash("sha256")
  .update(process.env.NARRATIVE_TOKEN_SECRET?.trim() || "fizzdragon-narrative-prototype-v1")
  .digest();

export function sealSession(payload: SessionPayload): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

export function openSession(token: string): SessionPayload | null {
  try {
    const buf = Buffer.from(token, "base64url");
    if (buf.length < 28) return null;
    const decipher = createDecipheriv("aes-256-gcm", KEY, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    const dec = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
    return JSON.parse(dec.toString("utf8")) as SessionPayload;
  } catch {
    return null;
  }
}
