import {
  ADMIN_SITE_COOKIE,
  adminSiteByKey,
  normalizeAdminSiteKey,
  type AdminSiteKey,
} from "./admin-sites";

export const ADMIN_SESSION_COOKIE = "fd_admin_session";

export { ADMIN_SITE_COOKIE, adminSiteByKey, normalizeAdminSiteKey };

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

export function adminApiUrl(path: string, siteKey: AdminSiteKey = "global"): string {
  const base = adminApiBaseUrl(siteKey);
  const normalizedBase = base.replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

export function adminApiBaseUrl(siteKey: AdminSiteKey): string {
  const base =
    siteKey === "cn"
      ? (process.env.ADMIN_CN_API_BASE_URL ?? process.env.NEXT_PUBLIC_ADMIN_CN_API_BASE_URL)
      : (process.env.ADMIN_GLOBAL_API_BASE_URL ??
        process.env.NEXT_PUBLIC_ADMIN_GLOBAL_API_BASE_URL ??
        process.env.ADMIN_API_BASE_URL ??
        process.env.NEXT_PUBLIC_ADMIN_API_BASE_URL);
  if (base) return base;

  const localFallback =
    process.env.ADMIN_API_BASE_URL ??
    process.env.NEXT_PUBLIC_ADMIN_API_BASE_URL ??
    "http://localhost:4399/admin";
  if (process.env.NODE_ENV !== "production") return localFallback;

  const site = adminSiteByKey(siteKey);
  throw new Error(`Missing admin API base URL for ${site.label}.`);
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

export function adminSiteCookie(siteKey: AdminSiteKey): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${ADMIN_SITE_COOKIE}=${siteKey}; Path=${adminCookiePath()}; Max-Age=31536000; SameSite=Lax; HttpOnly${secure}`;
}
