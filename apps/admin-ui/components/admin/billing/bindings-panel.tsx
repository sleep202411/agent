"use client";

// 渠道绑定 (provider bindings) page for the /billing sub-app. P2 Stage 2.
//
// SOURCE: there is no standalone 渠道绑定 view in the monolith — provider
// bindings were rendered inline inside CatalogView (price bindings, via
// ProviderBadge + handleSyncPriceBinding, admin-billing-panel.tsx:1515) and
// PromotionsView (promotion bindings, via PromotionProviderBadge +
// handleSyncPromotionBinding, admin-billing-panel.tsx:1927). This page
// consolidates BOTH into one dedicated mapping/sync surface. The badge
// rendering, sync buttons, risk styling, money cells, and Chinese strings are
// the verbatim shared primitives (ProviderBadge / PromotionProviderBadge /
// formatMoneyMinor) — the sync handlers POST to the same BFF routes the
// monolith used (/provider-bindings/[id]/sync and
// /promotion-provider-bindings/[id]/sync).
//
// DATA: price provider bindings come from /billing/overview (each carries its
// embedded `price`); promotion provider bindings come embedded in
// /billing/promotions rows. Both are passed in from the server page.

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
  formatMoneyMinor,
  Metric,
  mutateEnvelope,
  PageHeader,
  productTypeLabel,
  ProviderBadge,
  PromotionProviderBadge,
  promotionDiscountLabel,
  promotionScopeLabel,
  requestEnvelope,
  RiskText,
  StatusPill,
  toErrorMessage,
} from "./shared";
import type {
  AdminBillingOverviewData,
  AdminBillingPromotionsData,
  BillingProviderBinding,
  BillingPromotionRow,
} from "./types";

type PromotionBindingRow = {
  promotion: BillingPromotionRow;
};

export function BillingBindingsPanel({
  siteLabel,
  databaseLabel,
  initialOverview,
  initialPromotions,
  initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialOverview: AdminBillingOverviewData | null;
  initialPromotions: AdminBillingPromotionsData | null;
  initialError?: string | null;
}) {
  const [providerBindings, setProviderBindings] = useState<BillingProviderBinding[]>(
    initialOverview?.providerBindings ?? []
  );
  const [activeProviderBindings, setActiveProviderBindings] = useState(
    initialOverview?.metrics.activeProviderBindings ?? 0
  );
  const [incompleteProviderBindings, setIncompleteProviderBindings] = useState(
    initialOverview?.metrics.incompleteProviderBindings ?? 0
  );
  const [promotions, setPromotions] = useState<BillingPromotionRow[]>(
    initialPromotions?.items ?? []
  );
  const { busy: loading, begin } = useAdminOperation();
  const [error, setError] = useState<string | null>(initialError ?? null);

  const bindingRiskCount = useMemo(
    () =>
      providerBindings.filter(
        (binding) =>
          binding.status === "sync_failed" ||
          (binding.provider === "airwallex" &&
            binding.status === "active" &&
            !binding.providerPriceId)
      ).length,
    [providerBindings]
  );

  const promotionBindingRows = useMemo<PromotionBindingRow[]>(
    () =>
      promotions
        .filter((promotion) => promotion.providerBindings.length > 0)
        .map((promotion) => ({ promotion })),
    [promotions]
  );

  async function load(operation: NonNullable<ReturnType<typeof begin>>) {
    const [nextOverview, nextPromotions] = await Promise.all([
      requestEnvelope<AdminBillingOverviewData>("/api/admin/billing/overview", operation.signal),
      requestEnvelope<AdminBillingPromotionsData>(
        "/api/admin/billing/promotions",
        operation.signal
      ),
    ]);
    if (!operation.current()) return;
    setProviderBindings(nextOverview.providerBindings);
    setActiveProviderBindings(nextOverview.metrics.activeProviderBindings);
    setIncompleteProviderBindings(nextOverview.metrics.incompleteProviderBindings);
    setPromotions(nextPromotions.items);
  }
  async function refresh() {
    const operation = begin("read");
    if (!operation) return;
    setError(null);
    try {
      await load(operation);
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      operation.cancel();
      operation.finish();
    }
  }
  async function sync(path: string) {
    const operation = begin("write");
    if (!operation) return;
    setError(null);
    try {
      await mutateEnvelope(path, {}, "POST", operation.signal);
      if (operation.current()) await load(operation);
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      operation.cancel();
      operation.finish();
    }
  }
  const handleSyncPriceBinding = (id: string) =>
    sync(`/api/admin/billing/provider-bindings/${encodeURIComponent(id)}/sync`);
  const handleSyncPromotionBinding = (id: string) =>
    sync(`/api/admin/billing/promotion-provider-bindings/${encodeURIComponent(id)}/sync`);

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={
          <>
            {siteLabel} · {databaseLabel}
          </>
        }
        title="渠道绑定"
        description="商品价格与促销券到支付供应商的映射及同步状态。"
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

      <ProviderBindingsTable
        bindings={providerBindings}
        loading={loading}
        onSyncBinding={handleSyncPriceBinding}
      />

      <PromotionBindingsTable
        rows={promotionBindingRows}
        loading={loading}
        onSyncBinding={handleSyncPromotionBinding}
      />
    </div>
  );
}

function ProviderBindingsTable({
  bindings,
  loading,
  onSyncBinding,
}: {
  bindings: BillingProviderBinding[];
  loading: boolean;
  onSyncBinding: (bindingId: string) => void;
}) {
  const columns = useMemo<ColumnDef<BillingProviderBinding, unknown>[]>(
    () => [
      {
        id: "price",
        header: "商品价格",
        enableSorting: false,
        cell: ({ row }) => {
          const binding = row.original;
          if (!binding.price) return <RiskText>未关联价格</RiskText>;
          return (
            <>
              <p className="text-sm font-medium text-slate-950">{binding.price.name}</p>
              <p className="mt-0.5 text-[12px] text-slate-500">
                {binding.price.code} · {productTypeLabel(binding.price.productType)}
              </p>
            </>
          );
        },
      },
      {
        id: "amount",
        header: "价格",
        enableSorting: false,
        cell: ({ row }) => {
          const binding = row.original;
          if (!binding.price) return "-";
          return (
            <p className="text-sm font-semibold text-slate-950">
              {formatMoneyMinor(binding.price.amountMinor, binding.price.currency)}
            </p>
          );
        },
      },
      {
        id: "binding",
        header: () => (
          <ColumnHeader help="内部价格和支付渠道的绑定。只有 Airwallex 需要同步供应商商品；微信直接使用内部 CNY 价格。">
            Provider Binding
          </ColumnHeader>
        ),
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex max-w-[360px] flex-wrap gap-1.5">
            <ProviderBadge binding={row.original} onSync={onSyncBinding} />
          </div>
        ),
      },
      {
        id: "providerIds",
        header: () => (
          <ColumnHeader help="供应商侧的商品/价格 ID。Airwallex 同步成功后才会回填 price ID。">
            供应商 ID
          </ColumnHeader>
        ),
        enableSorting: false,
        cell: ({ row }) => {
          const binding = row.original;
          return (
            <>
              <p
                className="max-w-[200px] truncate font-mono text-[11px] text-slate-700"
                title={binding.providerProductId ?? "-"}
              >
                {binding.providerProductId ?? "-"}
              </p>
              <p
                className="max-w-[200px] truncate font-mono text-[11px] text-slate-500"
                title={binding.providerPriceId ?? "-"}
              >
                {binding.providerPriceId ?? "-"}
              </p>
            </>
          );
        },
      },
      {
        accessorKey: "status",
        header: "状态",
        cell: ({ row }) => {
          const binding = row.original;
          const tone =
            binding.status === "sync_failed"
              ? "risk"
              : binding.status === "active"
                ? "success"
                : "muted";
          return (
            <>
              <StatusPill tone={tone}>{binding.status}</StatusPill>
              {binding.syncError ? (
                <p
                  className="mt-1 max-w-[200px] truncate text-[11px] text-red-600"
                  title={binding.syncError}
                >
                  {binding.syncError}
                </p>
              ) : null}
            </>
          );
        },
      },
      {
        accessorKey: "lastSyncedAt",
        header: "最近同步",
        cell: ({ row }) =>
          row.original.lastSyncedAt ? formatDate(row.original.lastSyncedAt) : "未同步",
      },
    ],
    // onSyncBinding is a render-stable closure used only in an onClick; the
    // column defs never need to rebuild for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="border-b border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-950">商品价格渠道映射</h3>
        <p className="mt-1 text-[12px] text-slate-500">
          内部价格和支付渠道的绑定。只有 Airwallex 需要同步供应商商品；微信支付直接使用内部 CNY
          价格。
        </p>
      </div>
      <DataTable
        columns={columns}
        data={bindings}
        loading={loading}
        minWidth={1040}
        pageSize={20}
        emptyLabel="暂无渠道映射"
        className="rounded-none border-0"
      />
    </section>
  );
}

function PromotionBindingsTable({
  rows,
  loading,
  onSyncBinding,
}: {
  rows: PromotionBindingRow[];
  loading: boolean;
  onSyncBinding: (bindingId: string) => void;
}) {
  const columns = useMemo<ColumnDef<PromotionBindingRow, unknown>[]>(
    () => [
      {
        id: "promotion",
        header: "促销券",
        enableSorting: false,
        cell: ({ row }) => {
          const promotion = row.original.promotion;
          return (
            <>
              <p className="text-sm font-medium text-slate-950">{promotion.name}</p>
              <p className="mt-0.5 font-mono text-[12px] text-slate-500">{promotion.code}</p>
            </>
          );
        },
      },
      {
        id: "discount",
        header: "折扣",
        enableSorting: false,
        cell: ({ row }) => {
          const promotion = row.original.promotion;
          return (
            <>
              <p className="text-sm font-semibold text-slate-950">
                {promotionDiscountLabel(promotion)}
              </p>
              <p className="max-w-[220px] truncate text-[12px] text-slate-500">
                {promotionScopeLabel(promotion)}
              </p>
            </>
          );
        },
      },
      {
        id: "binding",
        header: () => (
          <ColumnHeader help="促销券和支付供应商优惠券 ID 的绑定。Airwallex/微信需要同步，线下确认和内部发放不需要。">
            Provider Binding
          </ColumnHeader>
        ),
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex max-w-[360px] flex-wrap gap-1.5">
            {row.original.promotion.providerBindings.map((binding) => (
              <PromotionProviderBadge key={binding.id} binding={binding} onSync={onSyncBinding} />
            ))}
          </div>
        ),
      },
      {
        id: "providerCouponId",
        header: () => (
          <ColumnHeader help="供应商侧的优惠券 ID。同步成功后才会回填。">
            供应商优惠券 ID
          </ColumnHeader>
        ),
        enableSorting: false,
        cell: ({ row }) => (
          <div className="space-y-0.5">
            {row.original.promotion.providerBindings.map((binding) => (
              <p
                key={binding.id}
                className="max-w-[220px] truncate font-mono text-[11px] text-slate-700"
                title={binding.providerCouponId ?? "-"}
              >
                {binding.providerCouponId ?? "-"}
              </p>
            ))}
          </div>
        ),
      },
      {
        id: "syncedAt",
        header: "最近同步",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="space-y-0.5">
            {row.original.promotion.providerBindings.map((binding) => (
              <p key={binding.id} className="text-[12px] text-slate-700">
                {binding.lastSyncedAt ? formatDate(binding.lastSyncedAt) : "未同步"}
              </p>
            ))}
          </div>
        ),
      },
    ],
    // onSyncBinding is a render-stable closure used only in an onClick; the
    // column defs never need to rebuild for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="border-b border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-950">促销券渠道映射</h3>
        <p className="mt-1 text-[12px] text-slate-500">
          促销券和支付供应商优惠券 ID 的绑定。只展示已配置渠道的促销券。
        </p>
      </div>
      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        minWidth={900}
        pageSize={20}
        emptyLabel="暂无促销券渠道映射"
        className="rounded-none border-0"
      />
    </section>
  );
}
