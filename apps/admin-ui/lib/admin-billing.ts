import { cookies } from "next/headers";
import {
  ADMIN_SESSION_COOKIE,
  adminApiUrl,
  adminAuthHeaders,
  parseAdminEnvelope,
} from "@/lib/admin-api";
import { currentAdminSite } from "@/lib/admin-sites";
import type {
  AdminBillingLedgerJournalsData,
  AdminBillingLedgerOverviewData,
  AdminBillingMembershipPlansData,
  AdminBillingOrdersData,
  AdminBillingOverviewData,
  AdminBillingPricesData,
  AdminBillingPromotionsData,
  AdminBillingWorkspacesData,
  AdminComputeMemberUsageData,
  AdminComputeProjectUsageData,
  AdminBillingVouchersData,
  AdminBillingCampaignsData,
  CheckInConfigData,
  AdminBillingProviderEventsData,
  AdminBillingReconciliationRunsData,
  AdminBillingRefundsData,
  AdminBillingSettlementsData,
} from "@/components/admin/billing/types";

export type AdminBillingLoadResult<T> = {
  data: T | null;
  error: string | null;
};

export async function fetchAdminBillingOverview(): Promise<
  AdminBillingLoadResult<AdminBillingOverviewData>
> {
  return fetchAdminBillingResource("/billing/overview", "账单总览数据加载失败。");
}

export async function fetchAdminBillingPrices(
  searchParams?: Record<string, string | undefined>
): Promise<AdminBillingLoadResult<AdminBillingPricesData>> {
  return fetchAdminBillingResource(
    `/billing/prices${toSearch(searchParams)}`,
    "商品价格数据加载失败。"
  );
}

export async function fetchAdminBillingMembershipPlans(
  searchParams?: Record<string, string | undefined>
): Promise<AdminBillingLoadResult<AdminBillingMembershipPlansData>> {
  return fetchAdminBillingResource(
    `/billing/membership-plans${toSearch(searchParams)}`,
    "会员计划数据加载失败。"
  );
}

export async function fetchAdminBillingWorkspaces(
  searchParams?: Record<string, string | undefined>
): Promise<AdminBillingLoadResult<AdminBillingWorkspacesData>> {
  return fetchAdminBillingResource(
    `/billing/workspaces${toSearch(searchParams)}`,
    "工作区数据加载失败。"
  );
}

export async function fetchAdminComputeMemberUsage(
  searchParams?: Record<string, string | undefined>
): Promise<AdminBillingLoadResult<AdminComputeMemberUsageData>> {
  return fetchAdminBillingResource(
    `/billing/usage/member-compute${toSearch(searchParams)}`,
    "成员积分消耗数据加载失败。"
  );
}

export async function fetchAdminComputeProjectUsage(
  searchParams?: Record<string, string | undefined>
): Promise<AdminBillingLoadResult<AdminComputeProjectUsageData>> {
  return fetchAdminBillingResource(
    `/billing/usage/project-compute${toSearch(searchParams)}`,
    "项目积分消耗数据加载失败。"
  );
}

export async function fetchAdminBillingPromotions(
  searchParams?: Record<string, string | undefined>
): Promise<AdminBillingLoadResult<AdminBillingPromotionsData>> {
  return fetchAdminBillingResource(
    `/billing/promotions${toSearch(searchParams)}`,
    "促销优惠数据加载失败。"
  );
}

export async function fetchAdminBillingVouchers(
  searchParams?: Record<string, string | undefined>
): Promise<AdminBillingLoadResult<AdminBillingVouchersData>> {
  return fetchAdminBillingResource(
    `/billing/vouchers${toSearch(searchParams)}`,
    "兑换券数据加载失败。"
  );
}

export async function fetchAdminBillingCreditCampaigns(
  searchParams?: Record<string, string | undefined>
): Promise<AdminBillingLoadResult<AdminBillingCampaignsData>> {
  return fetchAdminBillingResource(
    `/billing/credit-campaigns${toSearch(searchParams)}`,
    "活动数据加载失败。"
  );
}

export async function fetchAdminCheckInConfig(): Promise<
  AdminBillingLoadResult<CheckInConfigData>
> {
  return fetchAdminBillingResource(`/billing/check-in/config`, "签到配置加载失败。");
}

export async function fetchAdminBillingOrders(
  searchParams?: Record<string, string | undefined>
): Promise<AdminBillingLoadResult<AdminBillingOrdersData>> {
  return fetchAdminBillingResource(
    `/billing/orders${toSearch(searchParams)}`,
    "订单数据加载失败。"
  );
}

export async function fetchAdminBillingRefunds(
  searchParams?: Record<string, string | undefined>
): Promise<AdminBillingLoadResult<AdminBillingRefundsData>> {
  return fetchAdminBillingResource(
    `/billing/refunds${toSearch(searchParams)}`,
    "退款数据加载失败。"
  );
}

export async function fetchAdminBillingProviderEvents(
  searchParams?: Record<string, string | undefined>
): Promise<AdminBillingLoadResult<AdminBillingProviderEventsData>> {
  return fetchAdminBillingResource(
    `/billing/provider-events${toSearch(searchParams)}`,
    "支付事件数据加载失败。"
  );
}

export async function fetchAdminBillingLedgerOverview(): Promise<
  AdminBillingLoadResult<AdminBillingLedgerOverviewData>
> {
  return fetchAdminBillingResource("/billing/ledger/overview", "账本总览数据加载失败。");
}

export async function fetchAdminBillingLedgerJournals(
  searchParams?: Record<string, string | undefined>
): Promise<AdminBillingLoadResult<AdminBillingLedgerJournalsData>> {
  return fetchAdminBillingResource(
    `/billing/ledger/journals${toSearch(searchParams)}`,
    "会计分录数据加载失败。"
  );
}

export async function fetchAdminBillingSettlements(
  searchParams?: Record<string, string | undefined>
): Promise<AdminBillingLoadResult<AdminBillingSettlementsData>> {
  return fetchAdminBillingResource(
    `/billing/ledger/settlements${toSearch(searchParams)}`,
    "结算批次数据加载失败。"
  );
}

export async function fetchAdminBillingReconciliationRuns(
  searchParams?: Record<string, string | undefined>
): Promise<AdminBillingLoadResult<AdminBillingReconciliationRunsData>> {
  return fetchAdminBillingResource(
    `/billing/ledger/reconciliation-runs${toSearch(searchParams)}`,
    "对账任务数据加载失败。"
  );
}

async function fetchAdminBillingResource<T>(
  path: string,
  fallbackMessage: string
): Promise<AdminBillingLoadResult<T>> {
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
