"use client";

// 促销优惠 page panel for the /billing sub-app. The view body + create form are
// moved AS-IS from PromotionsView/CreatePromotionForm (admin-billing-panel.tsx
// :1840/2066); the promotion state, refresh, and mutation handlers mirror the
// monolith's AdminBillingPanel verbatim. Shared primitives come from "./shared".

import { useMemo, useState } from "react";
import { IconPlus, IconRefresh, IconSearch, IconTicket } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";
import {
  ColumnHeader,
  ErrorBanner,
  FormLabel,
  PageHeader,
  PromotionProviderBadge,
  PromotionStatusPill,
  RiskText,
  Select,
  StatusPill,
  TextInput,
  formatDate,
  isInternalFreePromotion,
  mutateEnvelope,
  productTypeHelp,
  promotionDiscountLabel,
  promotionScopeLabel,
  providerHelp,
  requestEnvelope,
  stringField,
  toErrorMessage,
} from "./shared";
import type {
  AdminBillingPromotionsData,
  BillingPromotionRow,
  BillingPromotionStatus,
} from "./types";

const emptyPromotions: AdminBillingPromotionsData = { items: [] };

export function BillingPromotionsPanel({
  siteLabel,
  databaseLabel,
  initialPromotions,
  initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialPromotions: AdminBillingPromotionsData | null;
  initialError?: string | null;
}) {
  const [promotions, setPromotions] = useState(initialPromotions ?? emptyPromotions);
  const [promotionStatus, setPromotionStatus] = useState("");
  const [promotionProvider, setPromotionProvider] = useState("");
  const [promotionQuery, setPromotionQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  function promotionQueryString() {
    const params = new URLSearchParams();
    if (promotionStatus) params.set("status", promotionStatus);
    if (promotionProvider) params.set("provider", promotionProvider);
    if (promotionQuery.trim()) params.set("q", promotionQuery.trim());
    const query = params.toString();
    return query ? `?${query}` : "";
  }

  async function refreshPromotions() {
    setLoading(true);
    setError(null);
    try {
      setPromotions(
        await requestEnvelope<AdminBillingPromotionsData>(
          `/api/admin/billing/promotions${promotionQueryString()}`
        )
      );
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleCreatePromotion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const provider = stringField(form, "provider");
    const percentOff = stringField(form, "percentOff");
    const appliesProductType = stringField(form, "appliesProductType");
    const maxRedemptions = stringField(form, "maxRedemptions");
    const maxRedemptionsPerUser = stringField(form, "maxRedemptionsPerUser");
    try {
      await mutateEnvelope("/api/admin/billing/promotions", {
        code: stringField(form, "code"),
        name: stringField(form, "name"),
        description: stringField(form, "description") || undefined,
        status: stringField(form, "status"),
        percentOffBps: percentOff ? Math.round(Number(percentOff) * 100) : undefined,
        durationType: "once",
        appliesProductType: appliesProductType || undefined,
        maxRedemptions: maxRedemptions ? Number(maxRedemptions) : undefined,
        maxRedemptionsPerUser: maxRedemptionsPerUser ? Number(maxRedemptionsPerUser) : undefined,
        providerBindings: provider
          ? [
              {
                provider,
                status: "sync_pending",
              },
            ]
          : [],
      });
      event.currentTarget.reset();
      await refreshPromotions();
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handlePromotionStatus(promotionId: string, status: BillingPromotionStatus) {
    setLoading(true);
    setError(null);
    try {
      await mutateEnvelope(`/api/admin/billing/promotions/${promotionId}`, { status }, "PATCH");
      await refreshPromotions();
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleSyncPromotionBinding(bindingId: string) {
    setLoading(true);
    setError(null);
    try {
      await mutateEnvelope(`/api/admin/billing/promotion-provider-bindings/${bindingId}/sync`, {});
      await refreshPromotions();
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={
          <>
            {siteLabel} · {databaseLabel}
          </>
        }
        title="促销优惠"
        description="折扣券与 100% 免费内部发放，支持供应商优惠券同步。"
      />
      {error ? <ErrorBanner message={error} /> : null}
      <PromotionsView
        promotions={promotions.items}
        status={promotionStatus}
        provider={promotionProvider}
        query={promotionQuery}
        loading={loading}
        onStatusChange={setPromotionStatus}
        onProviderChange={setPromotionProvider}
        onQueryChange={setPromotionQuery}
        onRefresh={refreshPromotions}
        onCreatePromotion={handleCreatePromotion}
        onPromotionStatus={handlePromotionStatus}
        onSyncBinding={handleSyncPromotionBinding}
      />
    </div>
  );
}

function PromotionsView({
  promotions,
  status,
  provider,
  query,
  loading,
  onStatusChange,
  onProviderChange,
  onQueryChange,
  onRefresh,
  onCreatePromotion,
  onPromotionStatus,
  onSyncBinding,
}: {
  promotions: BillingPromotionRow[];
  status: string;
  provider: string;
  query: string;
  loading: boolean;
  onStatusChange: (value: string) => void;
  onProviderChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  onRefresh: () => void;
  onCreatePromotion: (event: React.FormEvent<HTMLFormElement>) => void;
  onPromotionStatus: (promotionId: string, status: BillingPromotionStatus) => void;
  onSyncBinding: (bindingId: string) => void;
}) {
  const columns = useMemo<ColumnDef<BillingPromotionRow, unknown>[]>(
    () => [
      {
        accessorKey: "code",
        header: "券码",
        cell: ({ row }) => {
          const promotion = row.original;
          return (
            <>
              <p className="font-mono text-[12px] font-semibold text-slate-950">{promotion.code}</p>
              <p className="mt-0.5 text-sm font-medium text-slate-800">{promotion.name}</p>
            </>
          );
        },
      },
      {
        id: "discount",
        header: "折扣",
        enableSorting: false,
        cell: ({ row }) => {
          const promotion = row.original;
          return (
            <>
              <p className="text-sm font-semibold text-slate-950">
                {promotionDiscountLabel(promotion)}
              </p>
              <p className="text-[12px] text-slate-500">{promotion.durationType}</p>
            </>
          );
        },
      },
      {
        id: "scope",
        header: "适用范围",
        enableSorting: false,
        cell: ({ row }) => {
          const promotion = row.original;
          return (
            <>
              <p className="text-sm text-slate-700">{promotionScopeLabel(promotion)}</p>
              <p className="text-[12px] text-slate-500">
                {promotion.startsAt ? formatDate(promotion.startsAt) : "立即"} -{" "}
                {promotion.endsAt ? formatDate(promotion.endsAt) : "长期"}
              </p>
            </>
          );
        },
      },
      {
        id: "coupon",
        header: () => (
          <ColumnHeader help="支付供应商侧的优惠券 ID。100% 免费兑换码可不绑定供应商，系统内部创建零元订单并履约。">
            Provider Coupon
          </ColumnHeader>
        ),
        enableSorting: false,
        cell: ({ row }) => {
          const promotion = row.original;
          return (
            <div className="flex max-w-[360px] flex-wrap gap-1.5">
              {promotion.providerBindings.map((binding) => (
                <PromotionProviderBadge key={binding.id} binding={binding} onSync={onSyncBinding} />
              ))}
              {!promotion.providerBindings.length ? (
                isInternalFreePromotion(promotion) ? (
                  <StatusPill tone="muted">内部零元券</StatusPill>
                ) : (
                  <RiskText>未配置渠道券</RiskText>
                )
              ) : null}
            </div>
          );
        },
      },
      {
        id: "redemptions",
        header: "限制/核销",
        enableSorting: false,
        cell: ({ row }) => {
          const promotion = row.original;
          return (
            <>
              <p className="text-sm text-slate-700">
                {promotion.redemptionCount} / {promotion.maxRedemptions ?? "∞"}
              </p>
              <p className="text-[12px] text-slate-500">
                单用户 {promotion.maxRedemptionsPerUser ?? "∞"}
              </p>
            </>
          );
        },
      },
      {
        accessorKey: "status",
        header: "状态",
        cell: ({ row }) => {
          const promotion = row.original;
          return (
            <>
              <PromotionStatusPill status={promotion.status} />
              <p className="mt-1 text-[11px] text-slate-400">{formatDate(promotion.updatedAt)}</p>
            </>
          );
        },
      },
      {
        id: "actions",
        header: "操作",
        enableSorting: false,
        meta: { pin: "right" },
        cell: ({ row }) => {
          const promotion = row.original;
          return (
            <div className="flex flex-wrap gap-1.5">
              <Button
                variant="outline"
                size="sm"
                disabled={loading || promotion.status === "active"}
                onClick={() => onPromotionStatus(promotion.id, "active")}
              >
                启用
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={loading || promotion.status === "paused"}
                onClick={() => onPromotionStatus(promotion.id, "paused")}
              >
                暂停
              </Button>
            </div>
          );
        },
      },
    ],
    // onPromotionStatus / onSyncBinding are render-stable closures used only in
    // onClick; the column defs only need to rebuild when loading toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loading]
  );

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="border-b border-slate-200 p-4">
          <div className="grid gap-2 lg:grid-cols-[minmax(240px,1fr)_150px_150px_auto]">
            <label className="relative block">
              <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <TextInput
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                className="pl-9 pr-3"
                placeholder="搜索券码、名称"
              />
            </label>
            <Select value={status} onChange={onStatusChange}>
              <option value="">全部状态</option>
              <option value="draft">草稿</option>
              <option value="active">启用</option>
              <option value="paused">暂停</option>
              <option value="archived">归档</option>
            </Select>
            <Select
              value={provider}
              onChange={onProviderChange}
              title="促销券同步渠道。免费兑换码通常无需供应商，走内部零元履约；付费折扣需要同步到支付供应商。"
            >
              <option value="">全部渠道</option>
              <option value="airwallex" title={providerHelp("airwallex")}>
                Airwallex
              </option>
              <option value="wechat_pay" title={providerHelp("wechat_pay")}>
                微信支付
              </option>
              <option value="manual" title={providerHelp("manual")}>
                线下确认
              </option>
            </Select>
            <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
              <IconRefresh className={cn("size-3.5", loading && "animate-spin")} />
              应用
            </Button>
          </div>
        </div>
        <DataTable
          columns={columns}
          data={promotions}
          loading={loading}
          minWidth={1160}
          pageSize={20}
          emptyLabel="暂无促销券"
          className="rounded-none border-0"
        />
      </section>
      <CreatePromotionForm loading={loading} onSubmit={onCreatePromotion} />
    </div>
  );
}

function CreatePromotionForm({
  loading,
  onSubmit,
}: {
  loading: boolean;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">新建促销券</h3>
          <p className="mt-1 text-[12px] text-slate-500">
            当前只开放百分比折扣；100% 可作为免费兑换券，固定法币抵扣暂不提供运营入口。
          </p>
        </div>
        <IconTicket className="size-4 text-slate-400" />
      </div>
      <form onSubmit={onSubmit} className="mt-4 grid gap-3">
        <div className="grid grid-cols-2 gap-2">
          <FormLabel
            label="券码"
            help="用户可输入的优惠码/兑换码。它是促销规则，不是 payment provider。"
          >
            <TextInput name="code" required placeholder="WELCOME100" />
          </FormLabel>
          <FormLabel label="状态" help="草稿不可用；启用后可核销；暂停保留历史但不允许新订单使用。">
            <Select name="status" defaultValue="draft">
              <option value="draft">草稿</option>
              <option value="active">启用</option>
              <option value="paused">暂停</option>
            </Select>
          </FormLabel>
        </div>
        <FormLabel label="名称" help="后台运营识别用名称，建议描述活动或发放场景。">
          <TextInput name="name" required placeholder="新用户促销" />
        </FormLabel>
        <FormLabel
          label="折扣百分比"
          help="输入 100 表示 100% off，可作为免费兑换券；输入 20 表示减免订单金额的 20%。"
        >
          <TextInput name="percentOff" required inputMode="decimal" placeholder="100" />
        </FormLabel>
        <FormLabel label="适用类型" help="限制兑换码只能用于某类商品；留空表示全部商品可用。">
          <Select name="appliesProductType" defaultValue="">
            <option value="">全部商品</option>
            <option value="compute_point_pack" title={productTypeHelp("compute_point_pack")}>
              算力积分
            </option>
            <option value="community_point_pack" title={productTypeHelp("community_point_pack")}>
              社区积分
            </option>
            <option value="membership_plan" title={productTypeHelp("membership_plan")}>
              会员套餐
            </option>
            <option value="team_membership_plan" title={productTypeHelp("team_membership_plan")}>
              团队会员
            </option>
          </Select>
        </FormLabel>
        <div className="grid grid-cols-2 gap-2">
          <FormLabel label="总次数" help="全站最大核销次数。为空表示不限总次数。">
            <TextInput name="maxRedemptions" inputMode="numeric" placeholder="可选" />
          </FormLabel>
          <FormLabel label="单用户" help="单个用户最多核销次数。兑换码通常填 1。">
            <TextInput name="maxRedemptionsPerUser" inputMode="numeric" placeholder="1" />
          </FormLabel>
        </div>
        <FormLabel
          label="供应商"
          help="付费折扣同步到 Airwallex/微信；内部免费兑换码选择无需供应商。"
        >
          <Select name="provider" defaultValue="airwallex">
            <option value="">无需供应商</option>
            <option value="airwallex" title={providerHelp("airwallex")}>
              Airwallex
            </option>
            <option value="wechat_pay" title={providerHelp("wechat_pay")}>
              微信支付
            </option>
            <option value="manual" title={providerHelp("manual")}>
              线下确认
            </option>
          </Select>
        </FormLabel>
        <TextInput name="description" placeholder="内部备注，可选" />
        <Button type="submit" disabled={loading}>
          <IconPlus className="size-3.5" />
          创建
        </Button>
      </form>
    </section>
  );
}
