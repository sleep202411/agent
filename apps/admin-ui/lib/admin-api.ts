export const ADMIN_SESSION_COOKIE = "fd_admin_session";

export function adminUiBasePath(): string {
  const raw = process.env.NEXT_PUBLIC_ADMIN_UI_BASE_PATH?.trim() ?? "";
  if (!raw || raw === "/") return "";
  return raw.startsWith("/") ? raw.replace(/\/+$/, "") : `/${raw.replace(/\/+$/, "")}`;
}

export function adminUiPath(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (normalizedPath === "/") return adminUiBasePath() || "/";
  return `${adminUiBasePath()}${normalizedPath}`;
}

export function adminUiApiPath(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${adminUiBasePath()}${normalizedPath}`;
}

export function adminCookiePath(): string {
  return adminUiBasePath() || "/";
}

export function adminApiUrl(path: string): string {
  const base = adminApiBaseUrl();
  const normalizedBase = base.replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

export function adminApiBaseUrl(): string {
  const base =
    process.env.ADMIN_API_BASE_URL?.trim() || process.env.ADMIN_GLOBAL_API_BASE_URL?.trim();
  if (base) return base;
  throw new Error("Missing admin API base URL (set ADMIN_API_BASE_URL).");
}

export function adminAuthHeaders(sessionToken?: string): HeadersInit | null {
  if (sessionToken) return cookieHeader(sessionToken);
  return null;
}

export async function parseAdminEnvelope<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as {
    code?: number;
    msg?: string;
    message?: string;
    data?: T;
  } | null;
  if (!response.ok || !payload || payload.code !== 200) {
    throw new Error(payload?.msg ?? payload?.message ?? `后台服务请求失败：${response.status}`);
  }
  return payload.data as T;
}

export function cookieHeader(sessionToken?: string): HeadersInit {
  if (!sessionToken) return {};
  return {
    cookie: `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(sessionToken)}`,
  };
}
