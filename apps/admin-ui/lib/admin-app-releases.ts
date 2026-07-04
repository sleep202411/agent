import { cookies } from "next/headers";
import {
  ADMIN_SESSION_COOKIE,
  adminApiUrl,
  adminAuthHeaders,
  parseAdminEnvelope,
} from "@/lib/admin-api";
import { currentAdminSite } from "@/lib/admin-sites";
import type { AppReleasesData } from "@/components/admin/releases/releases-types";

export type AdminAppReleasesLoadResult = {
  data: AppReleasesData | null;
  error: string | null;
};

export async function fetchAdminAppReleases(): Promise<AdminAppReleasesLoadResult> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  const headers = adminAuthHeaders(sessionToken);
  if (!headers) return { data: null, error: "后台登录已失效，请重新登录。" };

  try {
    const response = await fetch(adminApiUrl("/app-releases"), { headers, cache: "no-store" });
    return { data: await parseAdminEnvelope<AppReleasesData>(response), error: null };
  } catch (error) {
    return {
      data: null,
      error:
        error instanceof Error
          ? error.message
          : `${currentAdminSite().label} 应用版本数据加载失败。`,
    };
  }
}
