/**
 * Java session client — what studio still owns after `@repo/auth-flow`.
 *
 * Signing IN is the package's job: it drives `/user/new/getCode` +
 * `/user/new/login` (with `type=pwd` as the legacy password path that replaced
 * this file's `/user/login` + `/user/email/login` calls) and writes the cookie
 * itself — including the host-derived `Domain=` rewrite the CN cell needs,
 * which now lives in one place only (`@repo/auth-flow`'s `session.ts`); the
 * copy that used to sit here went with the login call it served. What stays
 * here is everything AROUND a live session:
 *   me:    GET  /aurora/users/me   (Nest BFF — resolves the avatar for us)
 *   out:   GET  /user/logout
 * The session is the `satoken` cookie; every later call (including /aurora/*)
 * rides it via credentials: "include".
 */

import { resolveUserAvatarUrl } from "@repo/shared/avatar";

export interface AuthUser {
  id?: string | number;
  nickName?: string;
  email?: string;
  phone?: string;
  avatar?: string;
}

class AuthUnavailableError extends Error {}

export function isAuthUnavailableError(error: unknown): boolean {
  return error instanceof AuthUnavailableError;
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
      avatar: resolveUserAvatarUrl(data.avatar),
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
