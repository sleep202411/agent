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

import { clearSessionCookie } from "@repo/auth-flow";
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
export async function getAuthUser(
  input?: AbortSignal | { signal: AbortSignal }
): Promise<AuthUser | null> {
  const signal = input && "signal" in input ? input.signal : input;
  try {
    // Through the Nest BFF (not Java directly) so the avatar comes back as a
    // final, ready-to-use URL (resolved custom image, else a DiceBear face) —
    // user-info + avatar resolution is unified server-side.
    signal?.throwIfAborted();
    const response = await fetch("/aurora/users/me", {
      signal,
      credentials: "include",
      headers: { "accept-language": "en-US" },
    });
    signal?.throwIfAborted();
    if (response.status === 401 || response.status === 403) return null;
    if (!response.ok) {
      throw new AuthUnavailableError(`Auth session check failed: ${response.status}`);
    }
    const body = (await response.json()) as Record<string, unknown> | null;
    signal?.throwIfAborted();
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
    signal?.throwIfAborted();
    throw new AuthUnavailableError("Auth session check unavailable");
  }
}

export async function logout(): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    // Start revocation with the current cookie, then clear the local session
    // synchronously. Delayed completion must never clear a replacement login.
    let request: Promise<Response>;
    try {
      request = fetch("/user/logout", { credentials: "include", signal: controller.signal });
    } finally {
      clearSessionCookie();
    }
    const response = await request;
    // No body is consumed by this endpoint. Release any transport resources.
    void response.body?.cancel().catch(() => {});
  } catch {
    // Server revocation is best-effort; local logout has already completed.
  } finally {
    clearTimeout(timer);
  }
}
