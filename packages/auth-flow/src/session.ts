/**
 * Java envelope + Sa-Token handling.
 *
 * Java answers `{ code, msg, ... }` inside HTTP 200; `code !== 200` is a
 * business failure even when the transport succeeded. The session token
 * has been observed in FOUR different positions across the auth
 * controllers, and a code-200 response with no usable token is NOT a
 * successful browser login — it must surface as an error instead of
 * silently closing the dialog on a signed-out user.
 */

import type { SessionToken } from "./types";

/** Sa-Token's cookie name unless a response says otherwise. */
export const SESSION_COOKIE_NAME = "satoken";

export interface JavaEnvelope {
  ok: boolean;
  /** Numeric business code; falls back to the HTTP status. */
  code: number;
  /** Chinese message straight from Java. Shown verbatim when unmapped. */
  msg?: string;
  /** The envelope itself, for token extraction. */
  body: unknown;
}

/**
 * Normalize any Java auth response into `{ ok, code, msg }`.
 *
 * `httpStatus` is only a fallback, for an envelope that omits `code`
 * entirely. It cannot rescue a response that is not the envelope at all
 * — an HTML error page or an empty body never reaches here, because
 * `createFetchTransport` rejects it and `AuthClient` re-checks the shape
 * before calling this (see `invalid_response`).
 */
export function readEnvelope(body: unknown, httpStatus: number): JavaEnvelope {
  const root = objectRecord(body);
  const httpOk = httpStatus >= 200 && httpStatus < 300;
  // An HTTP rejection cannot become a successful login/code send because of
  // a contradictory body. Preserve the transport status for diagnostics.
  const rawCode = httpOk ? (root.code ?? 200) : httpStatus;
  const code = Number(rawCode);
  const msg = stringField(root, "msg") ?? stringField(root, "message");
  return { ok: httpOk && Number.isFinite(code) && code === 200, code, msg, body };
}

/**
 * Extract the Sa-Token across every shape Java has been seen to return.
 *
 * 1. top-level `token` — what `/user/new/login` and the live email/phone
 *    controllers append to the `{ code, msg }` envelope today;
 * 2. inside `data` — the documented envelope shape;
 * 3. `tokenValue` directly (either level);
 * 4. nested under `tokenInfo` (either level) — Sa-Token's own DTO.
 *
 * `tokenName` is resolved first because shape 2 sometimes keys the value
 * by that name (`{ data: { tokenName: "satoken", satoken: "…" } }`).
 * Returns null when nothing usable is present; callers map that to the
 * `token_missing` error rather than assuming the cookie landed.
 */
export function readSessionToken(envelope: unknown): SessionToken | null {
  const root = objectRecord(envelope);
  const payload = objectRecord(root.data);
  const payloadInfo = objectRecord(payload.tokenInfo);
  const rootInfo = objectRecord(root.tokenInfo);

  const name =
    stringField(payloadInfo, "tokenName") ??
    stringField(payload, "tokenName") ??
    stringField(rootInfo, "tokenName") ??
    stringField(root, "tokenName") ??
    SESSION_COOKIE_NAME;

  const value =
    stringField(payloadInfo, "tokenValue") ??
    stringField(payload, "tokenValue") ??
    stringField(payload, "token") ??
    stringField(payload, "satoken") ??
    stringField(payload, name) ??
    stringField(rootInfo, "tokenValue") ??
    stringField(root, "tokenValue") ??
    stringField(root, "token") ??
    stringField(root, "satoken") ??
    stringField(root, name);

  return value ? { name, value } : null;
}

/** `isNewUser` decides whether onboarding runs; Java sends it loosely typed. */
export function readIsNewUser(envelope: unknown): boolean {
  const root = objectRecord(envelope);
  const payload = objectRecord(root.data);
  const raw = root.isNewUser ?? payload.isNewUser;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw === 1;
  if (typeof raw === "string") return raw === "true" || raw === "1";
  return false;
}

export function readUserId(envelope: unknown): string | undefined {
  const root = objectRecord(envelope);
  const payload = objectRecord(root.data);
  const raw = root.userId ?? payload.userId ?? payload.id;
  if (typeof raw === "string" && raw.length > 0) return raw;
  if (typeof raw === "number") return String(raw);
  return undefined;
}

/**
 * Re-write the session cookie with a host-derived domain.
 *
 * Two independent bugs make this mandatory, and both apps had their own
 * copy of the fix:
 *   1. Java `Set-Cookie`s `Domain=.fizzdragon.com` unconditionally, which
 *      a `*.fizzspace.cn` browser rejects outright — the CN session never
 *      persisted.
 *   2. Safari commits a fetch() `Set-Cookie` asynchronously, so a
 *      navigation fired right after login can race ahead of it and land
 *      back on the sign-in gate.
 * Writing the token we already have in the response body, scoped to the
 * current host's registrable domain, fixes both and stays decoupled from
 * whatever Java is configured with.
 */
export function persistSessionCookie(token: SessionToken): void {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  const maxAge = 60 * 60 * 24 * 30; // 30d, refreshed on every login
  document.cookie = `${token.name}=${token.value}; Path=/${sessionCookieDomain()}; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

/**
 * Expire the session cookie locally — both the host-only and the shared
 * `.<apex>` variants, because Java's logout does not reliably expire the
 * domain-wide one and the next `/me` would re-read a live cookie.
 */
export function clearSessionCookie(name: string = SESSION_COOKIE_NAME): void {
  if (typeof document === "undefined") return;
  const expire = "path=/; max-age=0; SameSite=Lax";
  document.cookie = `${name}=; ${expire}`;
  const parts = window.location.hostname.split(".");
  if (parts.length >= 2) {
    document.cookie = `${name}=; domain=.${parts.slice(-2).join(".")}; ${expire}`;
  }
}

/** `; Domain=.<registrable>` for the current host; empty on localhost / IPs. */
function sessionCookieDomain(): string {
  const host = window.location.hostname;
  if (host === "localhost" || /^[\d.]+$/.test(host)) return "";
  return `; Domain=.${host.split(".").slice(-2).join(".")}`;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
