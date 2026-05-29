import { cookies } from "next/headers";
import {
  AdminBillingPanel,
  type AdminBillingLedgerJournalsData,
  type AdminBillingLedgerOverviewData,
  type AdminBillingOrdersData,
  type AdminBillingOverviewData,
  type AdminBillingPricesData,
  type AdminBillingPromotionsData,
  type AdminBillingProviderEventsData,
  type AdminBillingRefundsData,
  type AdminBillingReconciliationRunsData,
  type AdminBillingSettlementsData,
} from "@/components/admin/admin-billing-panel";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SITE_COOKIE,
  adminApiUrl,
  adminSiteByKey,
  cookieHeader,
  normalizeAdminSiteKey,
  parseAdminEnvelope,
} from "@/lib/admin-api";
import { getAdminSession } from "@/lib/admin-session";

export default async function BillingAdminPage() {
  const session = await getAdminSession();
  const initial = await getInitialBillingData();

  return (
    <AdminBillingPanel
      siteLabel={session?.site.label ?? "当前站点"}
      databaseLabel={session?.site.databaseLabel ?? "当前站点数据库"}
      initialOverview={initial.overview}
      initialPrices={initial.prices}
      initialPromotions={initial.promotions}
      initialOrders={initial.orders}
      initialRefunds={initial.refunds}
      initialProviderEvents={initial.providerEvents}
      initialLedgerOverview={initial.ledgerOverview}
      initialLedgerJournals={initial.ledgerJournals}
      initialSettlements={initial.settlements}
      initialReconciliationRuns={initial.reconciliationRuns}
      initialError={initial.error}
    />
  );
}

async function getInitialBillingData(): Promise<{
  overview: AdminBillingOverviewData | null;
  prices: AdminBillingPricesData | null;
  promotions: AdminBillingPromotionsData | null;
  orders: AdminBillingOrdersData | null;
  refunds: AdminBillingRefundsData | null;
  providerEvents: AdminBillingProviderEventsData | null;
  ledgerOverview: AdminBillingLedgerOverviewData | null;
  ledgerJournals: AdminBillingLedgerJournalsData | null;
  settlements: AdminBillingSettlementsData | null;
  reconciliationRuns: AdminBillingReconciliationRunsData | null;
  error: string | null;
}> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  const siteKey = normalizeAdminSiteKey(cookieStore.get(ADMIN_SITE_COOKIE)?.value);
  if (!sessionToken) {
    return {
      overview: null,
      prices: null,
      promotions: null,
      orders: null,
      refunds: null,
      providerEvents: null,
      ledgerOverview: null,
      ledgerJournals: null,
      settlements: null,
      reconciliationRuns: null,
      error: "后台登录已失效，请重新登录。",
    };
  }

  try {
    const headers = cookieHeader(sessionToken);
    const [
      overviewResponse,
      pricesResponse,
      promotionsResponse,
      ordersResponse,
      refundsResponse,
      providerEventsResponse,
      ledgerOverviewResponse,
      ledgerJournalsResponse,
      settlementsResponse,
      reconciliationRunsResponse,
    ] = await Promise.all([
      fetch(adminApiUrl("/billing/overview", siteKey), {
        headers,
        cache: "no-store",
      }),
      fetch(adminApiUrl("/billing/prices", siteKey), {
        headers,
        cache: "no-store",
      }),
      fetch(adminApiUrl("/billing/promotions", siteKey), {
        headers,
        cache: "no-store",
      }),
      fetch(adminApiUrl("/billing/orders", siteKey), {
        headers,
        cache: "no-store",
      }),
      fetch(adminApiUrl("/billing/refunds", siteKey), {
        headers,
        cache: "no-store",
      }),
      fetch(adminApiUrl("/billing/provider-events", siteKey), {
        headers,
        cache: "no-store",
      }),
      fetch(adminApiUrl("/billing/ledger/overview", siteKey), {
        headers,
        cache: "no-store",
      }),
      fetch(adminApiUrl("/billing/ledger/journals", siteKey), {
        headers,
        cache: "no-store",
      }),
      fetch(adminApiUrl("/billing/ledger/settlements", siteKey), {
        headers,
        cache: "no-store",
      }),
      fetch(adminApiUrl("/billing/ledger/reconciliation-runs", siteKey), {
        headers,
        cache: "no-store",
      }),
    ]);
    const [
      overview,
      prices,
      promotions,
      orders,
      refunds,
      providerEvents,
      ledgerOverview,
      ledgerJournals,
      settlements,
      reconciliationRuns,
    ] = await Promise.all([
      parseAdminEnvelope<AdminBillingOverviewData>(overviewResponse),
      parseAdminEnvelope<AdminBillingPricesData>(pricesResponse),
      parseAdminEnvelope<AdminBillingPromotionsData>(promotionsResponse),
      parseAdminEnvelope<AdminBillingOrdersData>(ordersResponse),
      parseAdminEnvelope<AdminBillingRefundsData>(refundsResponse),
      parseAdminEnvelope<AdminBillingProviderEventsData>(providerEventsResponse),
      parseAdminEnvelope<AdminBillingLedgerOverviewData>(ledgerOverviewResponse),
      parseAdminEnvelope<AdminBillingLedgerJournalsData>(ledgerJournalsResponse),
      parseAdminEnvelope<AdminBillingSettlementsData>(settlementsResponse),
      parseAdminEnvelope<AdminBillingReconciliationRunsData>(reconciliationRunsResponse),
    ]);
    return {
      overview,
      prices,
      promotions,
      orders,
      refunds,
      providerEvents,
      ledgerOverview,
      ledgerJournals,
      settlements,
      reconciliationRuns,
      error: null,
    };
  } catch (error) {
    return {
      overview: null,
      prices: null,
      promotions: null,
      orders: null,
      refunds: null,
      providerEvents: null,
      ledgerOverview: null,
      ledgerJournals: null,
      settlements: null,
      reconciliationRuns: null,
      error:
        error instanceof Error
          ? error.message
          : `${adminSiteByKey(siteKey).label} 账单数据加载失败。`,
    };
  }
}
