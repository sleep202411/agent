import { cookies } from "next/headers";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SITE_COOKIE,
  adminApiUrl,
  adminSiteByKey,
  cookieHeader,
  normalizeAdminSiteKey,
  parseAdminEnvelope,
} from "./admin-api";
import type { AdminSiteOption } from "./admin-sites";

export type AdminSessionUser = {
  id: string;
  email: string;
  displayName: string;
  status: string;
  siteScope: "global" | "cn" | "all";
  roleKeys: string[];
  requireMfa: boolean;
  mfaEnabledAt: string | null;
  permissions: string[];
};

export type AdminSession = {
  site: AdminSiteOption;
  user: AdminSessionUser;
  session: {
    id: string;
    expiresAt?: string;
  };
};

export async function getAdminSession(): Promise<AdminSession | null> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  const siteKey = normalizeAdminSiteKey(cookieStore.get(ADMIN_SITE_COOKIE)?.value);
  if (!sessionToken) return null;

  try {
    const response = await fetch(adminApiUrl("/auth/me", siteKey), {
      headers: cookieHeader(sessionToken),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const session = await parseAdminEnvelope<Omit<AdminSession, "site">>(response).catch(
      () => null
    );
    return session ? { ...session, site: adminSiteByKey(siteKey) } : null;
  } catch {
    return null;
  }
}
