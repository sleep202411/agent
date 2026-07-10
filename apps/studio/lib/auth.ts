/**
 * Java auth client — the same contract apps/web uses:
 *   email: POST /user/email/login   { email, pwd }   (form-urlencoded)
 *   phone: POST /user/login         { phone, pwd }
 *   me:    GET  /user/query/user/info
 *   out:   GET  /user/logout
 * The session is the `satoken` cookie the Java backend Set-Cookies on login;
 * every later call (including /aurora/*) rides it via credentials: "include".
 * Passwords go as-is (the backend contract — no client-side hashing).
 */

export interface AuthUser {
  id?: string | number;
  nickName?: string;
  email?: string;
  phone?: string;
  avatar?: string;
}

class JavaAuthError extends Error {}
class AuthUnavailableError extends Error {}

export function isAuthUnavailableError(error: unknown): boolean {
  return error instanceof AuthUnavailableError;
}

interface SessionToken {
  tokenName: string;
  tokenValue: string;
}

async function javaPostForm(path: string, body: Record<string, string>): Promise<SessionToken> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "accept-language": "en-US",
    },
    body: new URLSearchParams(body).toString(),
  });
  let json: {
    code?: number | string;
    msg?: string;
    message?: string;
    data?: unknown;
  } = {};
  try {
    json = await response.json();
  } catch {
    /* non-JSON → fall through to status check */
  }
  const code = Number(json.code ?? (response.ok ? 200 : response.status));
  if (code !== 200) {
    throw new JavaAuthError(json.msg || json.message || "Sign in failed");
  }
  return readSessionToken(json.data, json);
}

/** Extract satoken across Java's observed response shapes.
 *
 * The live email/phone controllers currently append `token` to the TOP-LEVEL
 * `{ code, msg }` envelope. Other auth clients have also seen the token inside
 * `data`, directly as `tokenValue`, or nested under `tokenInfo`. Keep all of
 * those contracts explicit: a code-200 response without a usable token is not
 * a successful browser login and must never close the dialog silently.
 */
function readSessionToken(data: unknown, envelope: unknown): SessionToken {
  const payload = objectRecord(data);
  const root = objectRecord(envelope);
  const payloadInfo = objectRecord(payload.tokenInfo);
  const rootInfo = objectRecord(root.tokenInfo);
  const tokenName =
    stringField(payloadInfo, "tokenName") ??
    stringField(payload, "tokenName") ??
    stringField(rootInfo, "tokenName") ??
    stringField(root, "tokenName") ??
    "satoken";
  const tokenValue =
    stringField(payloadInfo, "tokenValue") ??
    stringField(payload, "tokenValue") ??
    stringField(payload, "token") ??
    stringField(payload, "satoken") ??
    stringField(payload, tokenName) ??
    stringField(rootInfo, "tokenValue") ??
    stringField(root, "tokenValue") ??
    stringField(root, "token") ??
    stringField(root, "satoken") ??
    stringField(root, tokenName);

  if (!tokenValue) {
    throw new JavaAuthError("Sign in succeeded but no session token was returned");
  }
  return { tokenName, tokenValue };
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

/** Looks like a phone number (all digits, optionally +country). */
export function isPhoneIdentifier(identifier: string): boolean {
  return /^\+?\d{6,15}$/.test(identifier.replace(/[\s-]/g, ""));
}

/** Email/phone + password login. The backend sets the satoken cookie. */
export async function login(identifier: string, password: string): Promise<void> {
  const id = identifier.trim();
  const token = isPhoneIdentifier(id)
    ? await javaPostForm("/user/login", { phone: id.replace(/[\s-]/g, ""), pwd: password })
    : await javaPostForm("/user/email/login", { email: id, pwd: password });
  persistSessionCookie(token);

  // Do not dismiss the dialog until the exact cookie that the rest of Studio
  // relies on has passed the Nest → Java session check. This turns cookie
  // scope/proxy regressions into an actionable inline error instead of the
  // previous silent "dialog closed, still signed out" state.
  const user = await getAuthUser();
  if (!user) {
    throw new JavaAuthError("Sign in succeeded, but the new session could not be verified");
  }
}

/**
 * Re-write the satoken cookie with the domain derived from the CURRENT host
 * (`.fizzspace.cn` on CN, `.fizzdragon.com` on .com) so it is scoped correctly
 * and shared across subdomains. The Java backend Set-Cookies satoken with
 * Domain=.fizzdragon.com unconditionally — which a *.fizzspace.cn browser
 * REJECTS (domain mismatch), so the CN session never persists. We read the raw
 * token from the login body (not the rejected cookie) and re-set it host-derived,
 * mirroring apps/web's post-auth fix. Decoupled from Java; a no-op on .com where
 * the domain already matches. Temporary until Java sets the domain per host.
 */
function persistSessionCookie(token: SessionToken): void {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  const maxAge = 60 * 60 * 24 * 30; // 30d, refreshed on every login
  document.cookie = `${token.tokenName}=${token.tokenValue}; Path=/${sessionCookieDomain()}; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

/** `; Domain=.<registrable>` from the current host; empty on localhost / IPs. */
function sessionCookieDomain(): string {
  const host = window.location.hostname;
  if (host === "localhost" || /^[\d.]+$/.test(host)) return "";
  return `; Domain=.${host.split(".").slice(-2).join(".")}`;
}

/** Current session's user, or null when not signed in. */
export async function getAuthUser(): Promise<AuthUser | null> {
  try {
    // Through the Nest BFF (not Java directly) so the avatar comes back as a
    // final, ready-to-use URL (resolved custom image, else a DiceBear face) —
    // user-info + avatar resolution is unified server-side.
    const response = await fetch("/aurora/users/me", {
      credentials: "include",
      headers: { "accept-language": "en-US" },
    });
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) {
      throw new AuthUnavailableError(`Auth session check failed: ${response.status}`);
    }
    const body = (await response.json()) as Record<string, unknown> | null;
    const data = (body && typeof body === "object" && "data" in body ? body.data : body) as {
      id?: string | number;
      nickName?: string | null;
      email?: string | null;
      phone?: string | null;
      avatar?: string | null;
    } | null;
    if (!data || data.id == null) return null;
    return {
      id: data.id,
      nickName: data.nickName ?? undefined,
      email: data.email ?? undefined,
      phone: data.phone ?? undefined,
      avatar: data.avatar ?? undefined,
    };
  } catch {
    throw new AuthUnavailableError("Auth session check unavailable");
  }
}

export async function logout(): Promise<void> {
  try {
    // Server-side: invalidate the satoken on Java's side (best-effort).
    await fetch("/user/logout", { credentials: "include" });
  } catch {
    /* server-side invalidation is best-effort */
  }
  // Client-side: the satoken cookie is now shared across subdomains
  // (Domain=.fizzdragon.com) and is NOT HttpOnly (the legacy studio iframe reads
  // it). Java's /user/logout doesn't reliably expire the shared-domain cookie,
  // so without this the next /me refetch re-reads a live cookie and the user
  // stays logged in. Clear both the host-only and the shared-apex variants.
  clearSatokenCookie();
}

/** Expire the satoken cookie locally — host-only + the shared `.<apex>` domain. */
function clearSatokenCookie(): void {
  if (typeof document === "undefined") return;
  const expire = "path=/; max-age=0; SameSite=Lax";
  document.cookie = `satoken=; ${expire}`;
  const parts = window.location.hostname.split(".");
  if (parts.length >= 2) {
    const apex = parts.slice(-2).join(".");
    document.cookie = `satoken=; domain=.${apex}; ${expire}`;
  }
}
