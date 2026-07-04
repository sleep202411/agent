import { cookies } from "next/headers";
import {
  ADMIN_SESSION_COOKIE,
  adminApiUrl,
  adminAuthHeaders,
  parseAdminEnvelope,
} from "@/lib/admin-api";
import { currentAdminSite } from "@/lib/admin-sites";
import type {
  CommissionRateRow,
  ReferralProgramData,
} from "@/components/admin/growth/referrals-types";

export type AdminReferralsLoadResult<T> = {
  data: T | null;
  error: string | null;
};

export async function fetchAdminReferralsProgram(): Promise<
  AdminReferralsLoadResult<ReferralProgramData>
> {
  return fetchAdminReferralsResource("/referrals/program", "邀请奖励配置加载失败。");
}

export async function fetchAdminReferralCommissionRates(): Promise<
  AdminReferralsLoadResult<CommissionRateRow[]>
> {
  return fetchAdminReferralsResource("/referrals/commission-rates", "消费返佣白名单加载失败。");
}

async function fetchAdminReferralsResource<T>(
  path: string,
  fallbackMessage: string
): Promise<AdminReferralsLoadResult<T>> {
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
