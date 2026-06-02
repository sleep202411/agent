import { cookies } from "next/headers";
import {
  ADMIN_SESSION_COOKIE,
  adminApiUrl,
  cookieHeader,
  parseAdminEnvelope,
} from "@/lib/admin-api";
import type { AdminCertificatesData } from "@/components/admin/certificates/types";

export type AdminCertificatesLoadResult = {
  data: AdminCertificatesData | null;
  error: string | null;
};

export async function fetchAdminCertificates(
  searchParams?: Record<string, string | undefined>
): Promise<AdminCertificatesLoadResult> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  if (!sessionToken) return { data: null, error: "后台登录已失效，请重新登录。" };

  try {
    const response = await fetch(adminApiUrl(`/certificates${toSearch(searchParams)}`), {
      headers: cookieHeader(sessionToken),
      cache: "no-store",
    });
    return { data: await parseAdminEnvelope<AdminCertificatesData>(response), error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "证书数据加载失败。",
    };
  }
}

function toSearch(params?: Record<string, string | undefined>): string {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, value);
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : "";
}
