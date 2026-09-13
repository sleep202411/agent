import { cookies } from "next/headers";
import {
  ADMIN_SESSION_COOKIE,
  adminApiUrl,
  adminAuthHeaders,
  parseAdminEnvelope,
} from "@/lib/admin-api";
import { currentAdminSite } from "@/lib/admin-sites";
import type {
  AdminIpDiscoveryData,
  AdminIpEntitlementsData,
  AdminIpOrdersData,
  AdminIpOverviewData,
  AdminIpsData,
  AdminIpTaxonomyData,
  AdminRevenueEntriesData,
  IpCommerceSettingsData,
} from "@/components/admin/ip/types";

export type AdminIpLoadResult<T> = {
  data: T | null;
  error: string | null;
};

export type IpProductionEvidence = {
  ipId: string;
  publicationStatus: string;
  humanIpLikes: string;
  episodes: { episodeId: string; episodeNo: number; likes: string; dislikes: string }[];
};

export async function fetchIpProductionEvidence(
  ipId: string
): Promise<AdminIpLoadResult<IpProductionEvidence>> {
  return fetchAdminIpResource(
    `/ip-commerce/ips/${encodeURIComponent(ipId)}/production-evidence`,
    "Production evidence could not be loaded."
  );
}

export async function fetchAdminIpOverview(): Promise<AdminIpLoadResult<AdminIpOverviewData>> {
  return fetchAdminIpResource("/ip-commerce/overview", "IP 总览数据加载失败。");
}

export async function fetchAdminIps(
  searchParams?: Record<string, string | undefined>
): Promise<AdminIpLoadResult<AdminIpsData>> {
  return fetchAdminIpResource(`/ip-commerce/ips${toSearch(searchParams)}`, "IP 列表数据加载失败。");
}

export async function fetchAdminIpOrders(
  searchParams?: Record<string, string | undefined>
): Promise<AdminIpLoadResult<AdminIpOrdersData>> {
  return fetchAdminIpResource(
    `/ip-commerce/orders${toSearch({ limit: "30", ...searchParams })}`,
    "IP 订单数据加载失败。"
  );
}

export async function fetchAdminIpEntitlements(
  searchParams?: Record<string, string | undefined>
): Promise<AdminIpLoadResult<AdminIpEntitlementsData>> {
  return fetchAdminIpResource(
    `/ip-commerce/entitlements${toSearch({ limit: "30", ...searchParams })}`,
    "IP 权益数据加载失败。"
  );
}

export async function fetchAdminIpTaxonomy(
  searchParams?: Record<string, string | undefined>
): Promise<AdminIpLoadResult<AdminIpTaxonomyData>> {
  return fetchAdminIpResource(
    `/ip-commerce/taxonomy${toSearch(searchParams)}`,
    "IP 词库数据加载失败。"
  );
}

export async function fetchAdminIpDiscovery(
  searchParams?: Record<string, string | undefined>
): Promise<AdminIpLoadResult<AdminIpDiscoveryData>> {
  return fetchAdminIpResource(
    `/ip-commerce/discovery${toSearch(searchParams)}`,
    "IP 运营位数据加载失败。"
  );
}

export async function fetchAdminIpCommerceSettings(): Promise<
  AdminIpLoadResult<IpCommerceSettingsData>
> {
  return fetchAdminIpResource("/ip-commerce/settings", "创作者收益配置加载失败。");
}

export async function fetchAdminRevenueEntries(
  searchParams?: Record<string, string | undefined>
): Promise<AdminIpLoadResult<AdminRevenueEntriesData>> {
  return fetchAdminIpResource(
    `/ip-commerce/revenue/entries${toSearch({ limit: "30", ...searchParams })}`,
    "创作者收益流水加载失败。"
  );
}

async function fetchAdminIpResource<T>(
  path: string,
  fallbackMessage: string
): Promise<AdminIpLoadResult<T>> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  const headers = adminAuthHeaders(sessionToken);
  if (!headers) return { data: null, error: "后台登录已失效，请重新登录。" };

  try {
    const response = await fetch(adminApiUrl(path), {
      headers,
      cache: "no-store",
    });
    return { data: await parseAdminEnvelope<T>(response), error: null };
  } catch (error) {
    return {
      data: null,
      error:
        error instanceof Error ? error.message : `${currentAdminSite().label} ${fallbackMessage}`,
    };
  }
}

function toSearch(params: Record<string, string | undefined> | undefined) {
  const searchParams = new URLSearchParams();
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value) searchParams.set(key, value);
  });
  const search = searchParams.toString();
  return search ? `?${search}` : "";
}

export async function fetchIpProductionStage(
  ipId: string
): Promise<AdminIpLoadResult<{ stage: string; version: number }>> {
  return fetchAdminIpResource(
    `/ip-commerce/ips/${encodeURIComponent(ipId)}/production-stage`,
    "Production stage could not be loaded."
  );
}

export type StageApplication = {
  id: string;
  stage: string;
  reason: string;
  status: string;
  reviewReason: string | null;
  applicantId: string;
};
export async function fetchIpStageApplications(
  ipId: string
): Promise<AdminIpLoadResult<{ items: StageApplication[] }>> {
  return fetchAdminIpResource(
    `/ip-commerce/ips/${encodeURIComponent(ipId)}/stage-applications`,
    "Applications could not be loaded."
  );
}
