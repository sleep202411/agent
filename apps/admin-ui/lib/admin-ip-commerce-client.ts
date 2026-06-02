// Client-side typed fetchers for the creator-revenue admin surface. These run in
// the browser (client components) and go through `requestEnvelope`, which hits the
// Next proxy routes under /api/admin/ip-commerce/* (NOT the server `next/headers`
// path used by admin-ip-commerce.ts). Keep this module client-only.
import { requestEnvelope } from "@/components/admin/ip/shared";
import type {
  AdminOrderRevenueBreakdownData,
  AdminRevenueEntriesData,
  IpCommerceSettingsData,
  IpCommerceSetting,
  IpRevenueConfigData,
  UpdateIpRevenueConfigInput,
} from "@/components/admin/ip/types";
import { REVENUE_SHARE_SETTING_KEY } from "@/components/admin/ip/types";

function toSearch(params: Record<string, string | undefined> | undefined) {
  const searchParams = new URLSearchParams();
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value && value.trim()) searchParams.set(key, value.trim());
  });
  const search = searchParams.toString();
  return search ? `?${search}` : "";
}

export function fetchIpCommerceSettings(): Promise<IpCommerceSettingsData> {
  return requestEnvelope<IpCommerceSettingsData>("/api/admin/ip-commerce/settings");
}

export function updateIpCommerceSetting(key: string, valueInt: number): Promise<IpCommerceSetting> {
  return requestEnvelope<IpCommerceSetting>(
    `/api/admin/ip-commerce/settings/${encodeURIComponent(key)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ valueInt }),
    }
  );
}

export function updateIpCommerceRevenueShare(valueInt: number): Promise<IpCommerceSetting> {
  return updateIpCommerceSetting(REVENUE_SHARE_SETTING_KEY, valueInt);
}

export function fetchIpRevenueConfig(ipId: string, locale?: string): Promise<IpRevenueConfigData> {
  return requestEnvelope<IpRevenueConfigData>(
    `/api/admin/ip-commerce/ips/${encodeURIComponent(ipId)}/revenue-config${toSearch({ locale })}`
  );
}

export function updateIpRevenueConfig(
  ipId: string,
  body: UpdateIpRevenueConfigInput
): Promise<IpRevenueConfigData> {
  return requestEnvelope<IpRevenueConfigData>(
    `/api/admin/ip-commerce/ips/${encodeURIComponent(ipId)}/revenue-config`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

export function fetchAdminRevenueEntries(
  query: Record<string, string | undefined>
): Promise<AdminRevenueEntriesData> {
  return requestEnvelope<AdminRevenueEntriesData>(
    `/api/admin/ip-commerce/revenue/entries${toSearch({ limit: "30", ...query })}`
  );
}

export function fetchAdminOrderRevenueBreakdown(
  orderId: string
): Promise<AdminOrderRevenueBreakdownData> {
  return requestEnvelope<AdminOrderRevenueBreakdownData>(
    `/api/admin/ip-commerce/orders/${encodeURIComponent(orderId)}/revenue-breakdown`
  );
}
