/**
 * Auth utilities — email login/register via Java backend
 */

export interface User {
  id: string;
  email: string;
  nickname: string;
  avatar?: string;
  userLevel?: string;
}

export const PUBLIC_PATHS = ["/login", "/register", "/forgot-password"];

// ─── API helpers (form-urlencoded for Java backend) ──

async function postForm<T = unknown>(path: string, data: Record<string, string>): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body: new URLSearchParams(data).toString(),
  });
  const json = await res.json();
  if (json.code !== 200) {
    throw new Error(json.msg || json.message || `Request failed (${json.code})`);
  }
  return json as T;
}

// ─── Login ───────────────────────────────────────────

export async function emailLogin(email: string, pwd: string): Promise<User> {
  await postForm("/user/email/login", { email, pwd });
  // Login sets cookie, now fetch user info
  return getCurrentUser() as Promise<User>;
}

// ─── Register ────────────────────────────────────────

export async function sendEmailCode(email: string): Promise<void> {
  const res = await fetch(`/user/email/getCode?email=${encodeURIComponent(email)}`, {
    credentials: "include",
  });
  const json = await res.json();
  if (json.code !== 200) {
    throw new Error(json.msg || "Failed to send code");
  }
}

export async function emailRegister(email: string, password: string, code: string): Promise<void> {
  await postForm("/user/email/regist", { email, password, code });
}

// ─── Password Reset ──────────────────────────────────

export async function resetPassword(email: string, password: string, code: string): Promise<void> {
  await postForm("/user/email/reset/password", { email, password, code });
}

// ─── User Info ───────────────────────────────────────

export async function getCurrentUser(): Promise<User | null> {
  try {
    const res = await fetch("/user/query/user/info", { credentials: "include" });
    if (!res.ok) return null;
    const json = await res.json();
    const info = json.data || json.info;
    if (!info) return null;
    return {
      id: String(info.userId || info.id || ""),
      email: info.email || "",
      nickname: info.nickName || info.userName || "",
      avatar: info.headImg || undefined,
      userLevel: info.userLevel || undefined,
    };
  } catch {
    return null;
  }
}

export async function isAuthenticated(): Promise<boolean> {
  const user = await getCurrentUser();
  return user !== null;
}

export async function logout(): Promise<void> {
  try {
    await fetch("/user/logout", { method: "POST", credentials: "include" });
  } catch {
    // ignore
  }
}
