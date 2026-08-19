import { cookies } from "next/headers";
import {
  ADMIN_SESSION_COOKIE,
  adminApiUrl,
  adminAuthHeaders,
  isAdminDevAuthBypassEnabled,
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
    if (!response.ok) return localDevAdminSession();
    const session = await parseAdminEnvelope<Omit<AdminSession, "site">>(response).catch(
      () => null
    );
    return session ? { ...session, site: currentAdminSite() } : localDevAdminSession();
  } catch {
    return localDevAdminSession();
  }
}

const LOCAL_DEV_ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const LOCAL_DEV_ADMIN_SESSION_ID = "00000000-0000-4000-8000-000000000002";

function localDevAdminSession(): AdminSession | null {
  if (!isAdminDevAuthBypassEnabled()) return null;
  return {
    site: localDevAdminSite(),
    user: {
      id: LOCAL_DEV_ADMIN_ID,
      email: process.env.ADMIN_DEV_AUTH_EMAIL?.trim() || "local-dev-admin@fizzdragon.test",
      displayName: process.env.ADMIN_DEV_AUTH_NAME?.trim() || "Local Dev Admin",
      avatarUrl: null,
      status: "active",
      siteScope: "all",
      roleKeys: ["super_admin"],
      requireMfa: false,
      mfaEnabledAt: null,
      permissions: LOCAL_DEV_ADMIN_PERMISSIONS,
    },
    session: {
      id: LOCAL_DEV_ADMIN_SESSION_ID,
      expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
    },
  };
}

function localDevAdminSite(): AdminSiteOption {
  const site = currentAdminSite();
  return {
    ...site,
    label: `${site.label} Local`,
    databaseLabel: "本地开发数据库",
  };
}

const LOCAL_DEV_ADMIN_PERMISSIONS = [
  "admin.manage",
  "audit.read",
  "ip.read",
  "ip.publish",
  "ip.moderate",
  "billing.read",
  "billing.write",
  "ai_model_ops.read",
  "ai_model_ops.write",
  "workspace.read",
  "media.read",
  "certificate.read",
  "certificate.manage",
  "user.read",
  "user.write",
  "crew.manage",
];
