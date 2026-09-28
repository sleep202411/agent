"use client";

// 支付方式 (payment providers / methods) page for the /billing sub-app.
//
// There is no dedicated "支付方式" View in the monolith — payment-provider
// state only surfaces in the overview header metrics (支付映射 /
// 映射风险, admin-billing-panel.tsx:1169-1172) and the providerBindings
// summary. Per the Stage-2 spec ("If thin, a focused page listing providers +
// their status"), this page is a focused, read-only roster of the four payment
// providers (Airwallex / 微信支付 / 线下确认 / 内部发放) with health derived
// from overview.providerBindings.
//
// Everything money/label/help/risk is preserved verbatim: provider labels and
// help text come from shared providerLabel/providerHelp, the per-binding risk
// rule is the exact ProviderBadge rule, and the aggregate 支付映射 / 映射风险
// metrics reuse the monolith's bindingRiskCount + incompleteProviderBindings
// computation (admin-billing-panel.tsx:714-724 / 1170-1173).

import { useMemo, useState } from "react";
import { useAdminOperation } from "../use-admin-operation";
import { IconRefresh } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";
import {
  ColumnHeader,
  ErrorBanner,
  formatDate,
  Metric,
  PageHeader,
  ProviderBadge,
  providerHelp,
  providerLabel,
  requestEnvelope,
  RiskText,
  StatusPill,
  toErrorMessage,
} from "./shared";
import type { AdminBillingOverviewData, BillingProviderBinding, PaymentProvider } from "./types";

// The four payment providers, in display order. This mirrors the provider
// option order used across the catalog/events filters verbatim.
const PROVIDER_ORDER: PaymentProvider[] = [
  "airwallex",
  "wechat_pay",
  "alipay",
  "manual",
  "internal",
];

// WeChat charges the internal CNY amount directly and has no provider catalog.
// Manual/internal issuance keeps the existing local-only behavior.
const SYNC_EXEMPT: ReadonlySet<PaymentProvider> = new Set<PaymentProvider>([
  "wechat_pay",
  "manual",
  "internal",
]);

type ProviderHealthRow = {
  provider: PaymentProvider;
  bindings: BillingProviderBinding[];
  total: number;
  active: number;
  risk: number;
  lastSyncedAt: string | null;
  requiresSync: boolean;
};

// Exact ProviderBadge risk rule (shared.tsx:357-359 / admin-billing-panel.tsx:
// 714-722): a binding is risky if its sync failed, or it is an active Airwallex
// binding without a provider price id.
function isBindingRisky(binding: BillingProviderBinding) {
  return (
    binding.status === "sync_failed" ||
    (binding.provider === "airwallex" && binding.status === "active" && !binding.providerPriceId)
  );
}

export function BillingProvidersPanel({
  siteLabel,
  databaseLabel,
  initialOverview,
  initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialOverview: AdminBillingOverviewData | null;
  initialError?: string | null;
}) {
  const [overview, setOverview] = useState<AdminBillingOverviewData | null>(initialOverview);
  const { busy: loading, begin } = useAdminOperation();
  const [error, setError] = useState<string | null>(initialError ?? null);

  async function refresh() {
    const operation = begin("read");
    if (!operation) return;
    setError(null);
    try {
      const nextOverview = await requestEnvelope<AdminBillingOverviewData>(
        "/api/admin/billing/overview",
        operation.signal
      );
      if (operation.current()) setOverview(nextOverview);
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      operation.finish();
    }
  }

  const providerBindings = useMemo(() => overview?.providerBindings ?? [], [overview]);

  // Aggregate per-provider health from the overview providerBindings summary.
  const rows = useMemo<ProviderHealthRow[]>(() => {
    return PROVIDER_ORDER.map((provider) => {
      const bindings = providerBindings.filter((binding) => binding.provider === provider);
      const lastSyncedAt = bindings.reduce<string | null>((latest, binding) => {
        if (!binding.lastSyncedAt) return latest;
        if (!latest || binding.lastSyncedAt > latest) return binding.lastSyncedAt;
        return latest;
      }, null);
      return {
        provider,
        bindings,
        total: bindings.length,
        active: bindings.filter((binding) => binding.status === "active").length,
        risk: bindings.filter(isBindingRisky).length,
        lastSyncedAt,
        requiresSync: !SYNC_EXEMPT.has(provider),
      };
    });
  }, [providerBindings]);

  // Aggregate header metrics — reuse the monolith's 支付映射 / 映射风险 numbers
  // verbatim (admin-billing-panel.tsx:1169-1173). 映射风险 is the per-binding
  // risk count plus the overview incompleteProviderBindings count.
  const activeProviderBindings = overview?.metrics.activeProviderBindings ?? 0;
  const incompleteProviderBindings = overview?.metrics.incompleteProviderBindings ?? 0;
  const bindingRiskCount = useMemo(
    () => providerBindings.filter(isBindingRisky).length,
    [providerBindings]
  );

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={
          <>
            {siteLabel} · {databaseLabel}
          </>
        }
        title="支付方式"
        description="平台启用的支付供应商及其用途说明。内部商品和价格是事实源，支付供应商只作为 provider binding。"
        actions={
          <div className="grid gap-2 sm:grid-cols-3 xl:min-w-[460px]">
            <Metric label="支付映射" value={activeProviderBindings} />
            <Metric
              label="映射风险"
              value={bindingRiskCount + incompleteProviderBindings}
              tone="risk"
            />
            <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
              <IconRefresh className={cn("size-3.5", loading && "animate-spin")} />
              刷新
            </Button>
          </div>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}

      <ProvidersTable rows={rows} loading={loading} />
    </div>
  );
}

function ProvidersTable({ rows, loading }: { rows: ProviderHealthRow[]; loading: boolean }) {
  const columns = useMemo<ColumnDef<ProviderHealthRow, unknown>[]>(
    () => [
      {
        id: "provider",
        header: "支付供应商",
        enableSorting: false,
        cell: ({ row }) => {
          const item = row.original;
          return (
            <>
              <p className="text-sm font-medium text-slate-950">{providerLabel(item.provider)}</p>
              <p className="mt-0.5 max-w-[420px] text-[12px] leading-5 text-slate-500">
                {providerHelp(item.provider)}
              </p>
            </>
          );
        },
      },
      {
        id: "mode",
        header: () => (
          <ColumnHeader help="Airwallex/微信需要同步价格和优惠券；线下确认和内部发放不需要供应商同步。">
            同步模式
          </ColumnHeader>
        ),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.requiresSync ? (
            <StatusPill tone="muted">需同步</StatusPill>
          ) : (
            <StatusPill tone="muted">无需同步</StatusPill>
          ),
      },
      {
        id: "bindings",
        header: () => (
          <ColumnHeader help="内部价格和支付供应商价格/商品 ID 的绑定。Airwallex/微信需要同步，线下确认和内部发放不需要。">
            Provider Binding
          </ColumnHeader>
        ),
        enableSorting: false,
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div className="flex max-w-[360px] flex-wrap gap-1.5">
              {item.bindings.map((binding) => (
                <ProviderBadge key={binding.id} binding={binding} />
              ))}
              {!item.bindings.length ? <RiskText>未配置渠道</RiskText> : null}
            </div>
          );
        },
      },
      {
        id: "health",
        header: () => (
          <ColumnHeader help="该供应商下生效中的映射数量，以及同步失败或缺少供应商价格的风险映射数量。">
            映射状态
          </ColumnHeader>
        ),
        enableSorting: false,
        cell: ({ row }) => {
          const item = row.original;
          return (
            <>
              <p className="text-sm text-slate-700">{item.active} 生效</p>
              {item.risk ? (
                <RiskText>{item.risk} 风险</RiskText>
              ) : (
                <p className="text-[12px] text-slate-500">共 {item.total} 个映射</p>
              )}
            </>
          );
        },
      },
      {
        id: "lastSyncedAt",
        header: "最近同步",
        enableSorting: false,
        cell: ({ row }) => {
          const item = row.original;
          if (!item.requiresSync) {
            return <p className="text-[12px] text-slate-500">无需同步</p>;
          }
          return (
            <p className="text-[12px] text-slate-700">
              {item.lastSyncedAt ? formatDate(item.lastSyncedAt) : "未同步"}
            </p>
          );
        },
      },
    ],
    []
  );

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="border-b border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-950">支付供应商</h3>
        <p className="mt-1 text-[12px] text-slate-500">
          国际站当前为 Airwallex，中国站后续接微信支付；线下确认和内部发放用于补单和零元订单。
        </p>
      </div>
      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        minWidth={960}
        pageSize={20}
        emptyLabel="暂无支付供应商"
        className="rounded-none border-0"
      />
    </section>
  );
}
