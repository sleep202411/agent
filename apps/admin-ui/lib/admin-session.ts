import { cookies } from "next/headers";
import {
  ADMIN_SESSION_COOKIE,
  adminApiUrl,
  adminAuthHeaders,
  parseAdminEnvelope,
} from "./admin-api";
import { currentAdminSite, type AdminSiteOption } from "./admin-sites";

export type AdminSessionUser = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
  status: string;
  siteScope: "global" | "cn" | "all";
  /** Bound Web lecturer id; null means operator (all-courses) Academy scope. */
  platformUserId?: string | null;
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
  const headers = adminAuthHeaders(sessionToken);
  if (!headers) return null;

  try {
    const response = await fetch(adminApiUrl("/auth/me"), {
      headers,
      cache: "no-store",
    });
    if (!response.ok) return null;
    const session = await parseAdminEnvelope<Omit<AdminSession, "site">>(response).catch(
      () => null
    );
    return session ? { ...session, site: currentAdminSite() } : null;
  } catch {
    return null;
  }
}
