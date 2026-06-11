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
    const response = await fetch("/user/query/user/info", {
      credentials: "include",
      headers: { "accept-language": "en-US" },
    });
    const json: {
      code?: number | string;
      info?: {
        id?: string | number;
        nickName?: string;
        userName?: string;
        name?: string;
        email?: string;
        phone?: string;
        avatar?: string;
        headImg?: string;
      };
    } = await response.json();
    if (Number(json.code) !== 200 || !json.info) return null;
    const info = json.info;
    return {
      id: info.id,
      nickName: info.nickName || info.userName || info.name,
      email: info.email,
      phone: info.phone,
      avatar: info.avatar || info.headImg,
    };
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch("/user/logout", { credentials: "include" });
  } catch {
    /* the cookie clear is best-effort */
  }
}
