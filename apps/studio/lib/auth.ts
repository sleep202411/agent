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

async function javaPostForm(path: string, body: Record<string, string>): Promise<void> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "accept-language": "en-US",
    },
    body: new URLSearchParams(body).toString(),
  });
  let json: { code?: number | string; msg?: string; message?: string } = {};
  try {
    json = await response.json();
  } catch {
    /* non-JSON → fall through to status check */
  }
  const code = Number(json.code ?? (response.ok ? 200 : response.status));
  if (code !== 200) {
    throw new JavaAuthError(json.msg || json.message || "Sign in failed");
  }
}

/** Looks like a phone number (all digits, optionally +country). */
export function isPhoneIdentifier(identifier: string): boolean {
  return /^\+?\d{6,15}$/.test(identifier.replace(/[\s-]/g, ""));
}

/** Email/phone + password login. The backend sets the satoken cookie. */
export async function login(identifier: string, password: string): Promise<void> {
  const id = identifier.trim();
  if (isPhoneIdentifier(id)) {
    await javaPostForm("/user/login", { phone: id.replace(/[\s-]/g, ""), pwd: password });
    return;
  }
  await javaPostForm("/user/email/login", { email: id, pwd: password });
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
    if (!response.ok) return null;
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
    return null;
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
