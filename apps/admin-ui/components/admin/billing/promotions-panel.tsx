"use client";

// 促销优惠 page panel for the /billing sub-app. The view body + create form are
// moved AS-IS from PromotionsView/CreatePromotionForm (admin-billing-panel.tsx
// :1840/2066); the promotion state, refresh, and mutation handlers mirror the
// monolith's AdminBillingPanel verbatim. Shared primitives come from "./shared".

import { useCallback, useMemo, useState } from "react";
import { useAdminOperation } from "../use-admin-operation";
import { IconPlus, IconRefresh, IconSearch, IconTicket } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";
import {
  AdminDialog,
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

type BillingSiteKey = "global" | "cn";

const emptyPromotions: AdminBillingPromotionsData = { items: [] };

/** ISO timestamp -> a `datetime-local` input value in the operator's local tz. */
function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export function BillingPromotionsPanel({
  siteKey,
  siteLabel,
  databaseLabel,
  initialPromotions,
  initialError,
}: {
  siteKey: BillingSiteKey;
  siteLabel: string;
  databaseLabel: string;
  initialPromotions: AdminBillingPromotionsData | null;
  initialError?: string | null;
}) {
  const [promotions, setPromotions] = useState(initialPromotions ?? emptyPromotions);
  const [promotionStatus, setPromotionStatus] = useState("");
  const [promotionProvider, setPromotionProvider] = useState("");
  const [promotionQuery, setPromotionQuery] = useState("");
  const { busy: loading, begin } = useAdminOperation();
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [editing, setEditing] = useState<BillingPromotionRow | null>(null);

  const loadPromotions = useCallback(
    (signal: AbortSignal) => {
      const params = new URLSearchParams();
      if (promotionStatus) params.set("status", promotionStatus);
      if (promotionProvider) params.set("provider", promotionProvider);
      if (promotionQuery.trim()) params.set("q", promotionQuery.trim());
      return requestEnvelope<AdminBillingPromotionsData>(
        `/api/admin/billing/promotions?${params}`,
        signal
      );
    },
    [promotionStatus, promotionProvider, promotionQuery]
  );
  async function refreshPromotions() {
    const operation = begin("read");
    if (!operation) return;
    setError(null);
    try {
      const data = await loadPromotions(operation.signal);
      if (operation.current()) setPromotions(data);
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      operation.finish();
    }
  }

  async function handleCreatePromotion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const operation = begin();
    if (!operation) return;
    setError(null);
    // Capture the form element NOW: React nulls event.currentTarget after the
    // handler's sync phase, so reading it after the await below would throw.
    const formEl = event.currentTarget;
    try {
      const form = new FormData(formEl);
      const provider = stringField(form, "provider");
      const applyMode = stringField(form, "applyMode") || "code";
      const discountType = stringField(form, "discountType") || "percent";
      const percentOff = stringField(form, "percentOff");
      const amountOff = stringField(form, "amountOff");
      const amountOffCurrency = stringField(form, "amountOffCurrency");
      const appliesProductType = stringField(form, "appliesProductType");
      const maxRedemptions = stringField(form, "maxRedemptions");
      const maxRedemptionsPerUser = stringField(form, "maxRedemptionsPerUser");
      const durationType = stringField(form, "durationType") || "once";
      const durationCount = stringField(form, "durationCount");
      const durationUnit = stringField(form, "durationUnit");
      const startsAt = stringField(form, "startsAt");
      const endsAt = stringField(form, "endsAt");
      const metadata =
        appliesProductType === "compute_point_pack"
          ? {
              surface: "fizzstudio_compute_topup",
              cell: siteKey,
              providerCouponRequired: true,
            }
          : undefined;
      await mutateEnvelope(
        "/api/admin/billing/promotions",
        {
          applyMode,
          // Automatic sales carry no code.
          code: applyMode === "code" ? stringField(form, "code") : undefined,
          name: stringField(form, "name"),
          description: stringField(form, "description") || undefined,
          status: stringField(form, "status"),
          percentOffBps:
            discountType === "percent" && percentOff
              ? Math.round(Number(percentOff) * 100)
              : undefined,
          amountOffMinor:
            discountType === "amount" && amountOff
              ? Math.round(Number(amountOff) * 100)
              : undefined,
          amountOffCurrency: discountType === "amount" ? amountOffCurrency || undefined : undefined,
          durationType,
          durationCount:
            durationType === "repeating" && durationCount ? Number(durationCount) : undefined,
          durationUnit: durationType === "repeating" && durationUnit ? durationUnit : undefined,
          startsAt: startsAt || undefined,
          endsAt: endsAt || undefined,
          appliesProductType: appliesProductType || undefined,
          maxRedemptions: maxRedemptions ? Number(maxRedemptions) : undefined,
          // Per-user limits are a coupon concept; automatic sales apply to everyone.
          maxRedemptionsPerUser:
            applyMode === "code" && maxRedemptionsPerUser
              ? Number(maxRedemptionsPerUser)
              : undefined,
          metadata,
          providerBindings: provider
            ? [
                {
                  provider,
                  status: "sync_pending",
                },
              ]
            : [],
        },
        "POST",
        operation.signal
      );
      if (!operation.current()) return;
      formEl.reset();
      if (!operation.current()) return;
      const data = await loadPromotions(operation.signal);
      if (operation.current()) setPromotions(data);
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      operation.finish();
    }
  }

  async function handlePromotionStatus(promotionId: string, status: BillingPromotionStatus) {
    const operation = begin();
    if (!operation) return;
    setError(null);
    try {
      await mutateEnvelope(
        `/api/admin/billing/promotions/${promotionId}`,
        { status },
        "PATCH",
        operation.signal
      );
      if (!operation.current()) return;
      const data = await loadPromotions(operation.signal);
      if (operation.current()) setPromotions(data);
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      operation.finish();
    }
  }

  async function handleUpdatePromotion(promotionId: string, payload: Record<string, unknown>) {
    const operation = begin();
    if (!operation) return;
    setError(null);
    try {
      await mutateEnvelope(
        `/api/admin/billing/promotions/${promotionId}`,
        payload,
        "PATCH",
        operation.signal
      );
      if (!operation.current()) return;
      setEditing(null);
      if (!operation.current()) return;
      const data = await loadPromotions(operation.signal);
      if (operation.current()) setPromotions(data);
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      operation.finish();
    }
  }

  async function handleSyncPromotionBinding(bindingId: string) {
    const operation = begin();
    if (!operation) return;
    setError(null);
    try {
      await mutateEnvelope(
        `/api/admin/billing/promotion-provider-bindings/${bindingId}/sync`,
        {},
        "POST",
        operation.signal
      );
      if (!operation.current()) return;
      const data = await loadPromotions(operation.signal);
      if (operation.current()) setPromotions(data);
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      operation.finish();
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
        onEdit={setEditing}
        onSyncBinding={handleSyncPromotionBinding}
        siteKey={siteKey}
      />
      {editing ? (
        <PromotionEditDialog
          key={editing.id}
          promotion={editing}
          loading={loading}
          onClose={() => {
            if (!loading) setEditing(null);
          }}
          onSubmit={handleUpdatePromotion}
        />
      ) : null}
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
  onEdit,
  onSyncBinding,
  siteKey,
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
  onEdit: (promotion: BillingPromotionRow) => void;
  onSyncBinding: (bindingId: string) => void;
  siteKey: BillingSiteKey;
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
              {promotion.applyMode === "automatic" ? (
                <span className="inline-flex items-center rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">
                  自动促销
                </span>
              ) : (
                <p className="font-mono text-[12px] font-semibold text-slate-950">
                  {promotion.code}
                </p>
              )}
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
                disabled={loading}
                onClick={() => onEdit(promotion)}
              >
                编辑
              </Button>
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
    [loading, onPromotionStatus, onEdit, onSyncBinding]
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
              <option value="alipay" title={providerHelp("alipay")}>
                支付宝
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
      <CreatePromotionForm loading={loading} onSubmit={onCreatePromotion} siteKey={siteKey} />
    </div>
  );
}

function CreatePromotionForm({
  loading,
  onSubmit,
  siteKey,
}: {
  loading: boolean;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  siteKey: BillingSiteKey;
}) {
  const [applyMode, setApplyMode] = useState("code");
  const [appliesProductType, setAppliesProductType] = useState("compute_point_pack");
  const [durationType, setDurationType] = useState("once");
  const [discountType, setDiscountType] = useState("percent");
  const isAutomatic = applyMode === "automatic";
  const defaultProvider = siteKey === "cn" ? "wechat_pay" : "airwallex";
  const defaultCurrency = siteKey === "cn" ? "CNY" : "USD";
  const [provider, setProvider] = useState(defaultProvider);

  function handleProductTypeChange(value: string) {
    setAppliesProductType(value);
    if (value === "compute_point_pack") {
      setProvider(defaultProvider);
      return;
    }
    if (!provider) setProvider(defaultProvider);
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">新建促销券</h3>
          <p className="mt-1 text-[12px] text-slate-500">
            算力积分付费促销必须同步到支付供应商；100% 可作为零元内部兑换券。
          </p>
        </div>
        <IconTicket className="size-4 text-slate-400" />
      </div>
      <form inert={loading} onSubmit={onSubmit} className="mt-4 grid gap-3">
        <FormLabel
          label="生效方式"
          help="优惠码=用户输入券码后生效；自动促销=无需券码，命中商品对所有人自动按促销价（前台显示划线原价 + 折后价），用于限时活动。"
        >
          <Select name="applyMode" value={applyMode} onChange={setApplyMode}>
            <option value="code">优惠码</option>
            <option value="automatic">自动促销（活动价）</option>
          </Select>
        </FormLabel>
        <div className="grid grid-cols-2 gap-2">
          {isAutomatic ? (
            <FormLabel label="券码" help="自动促销无需券码，对命中商品自动生效。">
              <div className="flex h-9 items-center rounded-lg border border-dashed border-slate-200 px-3 text-[12px] text-slate-400">
                自动促销 · 无券码
              </div>
            </FormLabel>
          ) : (
            <FormLabel
              label="券码"
              help="用户可输入的优惠码/兑换码。它是促销规则，不是 payment provider。"
            >
              <TextInput name="code" required placeholder="WELCOME100" />
            </FormLabel>
          )}
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
          label="折扣类型"
          help="百分比=按订单比例减免；定额=固定金额减免（需指定币种，仅对该币种订单生效）。"
        >
          <Select name="discountType" value={discountType} onChange={setDiscountType}>
            <option value="percent">百分比</option>
            <option value="amount">定额减免</option>
          </Select>
        </FormLabel>
        {discountType === "percent" ? (
          <FormLabel
            label="折扣百分比"
            help="输入 100 表示 100% off，可作为免费兑换券；输入 20 表示减免订单金额的 20%。"
          >
            <TextInput name="percentOff" required inputMode="decimal" placeholder="100" />
          </FormLabel>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <FormLabel label="减免金额" help="固定减免金额，按币种单位（例如 10 = 10 美元/元）。">
              <TextInput name="amountOff" required inputMode="decimal" placeholder="10" />
            </FormLabel>
            <FormLabel label="币种" help="定额券只对该币种的订单生效。">
              <Select name="amountOffCurrency" defaultValue={defaultCurrency}>
                <option value="USD">USD 美元</option>
                <option value="SGD">SGD 新元</option>
                <option value="CNY">CNY 人民币</option>
              </Select>
            </FormLabel>
          </div>
        )}
        <FormLabel
          label="适用类型"
          help={
            isAutomatic
              ? "自动促销必须限定到某类商品（或在下方按具体价格/商品细化）。"
              : "限制兑换码只能用于某类商品；留空表示全部商品可用。"
          }
        >
          <Select
            name="appliesProductType"
            value={appliesProductType}
            onChange={handleProductTypeChange}
          >
            {!isAutomatic ? <option value="">全部商品</option> : null}
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
            <option
              value="community_membership_plan"
              title={productTypeHelp("community_membership_plan")}
            >
              社区会员
            </option>
          </Select>
        </FormLabel>
        <FormLabel
          label="时长类型"
          help="一次性=单次抵扣；长期=持续有效；按周期重复=订阅按周期重复抵扣（需填周期数与单位）。"
        >
          <Select name="durationType" value={durationType} onChange={setDurationType}>
            <option value="once">一次性</option>
            <option value="forever">长期</option>
            <option value="repeating">按周期重复</option>
          </Select>
        </FormLabel>
        {durationType === "repeating" ? (
          <div className="grid grid-cols-2 gap-2">
            <FormLabel label="周期数" help="重复抵扣的周期数量，例如 3。">
              <TextInput name="durationCount" inputMode="numeric" placeholder="3" />
            </FormLabel>
            <FormLabel label="周期单位" help="重复周期的时间单位。">
              <Select name="durationUnit" defaultValue="month">
                <option value="day">天</option>
                <option value="week">周</option>
                <option value="month">月</option>
                <option value="year">年</option>
              </Select>
            </FormLabel>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <FormLabel label="生效时间" help="留空表示立即生效；按运营本地时区填写。">
            <TextInput name="startsAt" type="datetime-local" />
          </FormLabel>
          <FormLabel label="结束时间" help="留空表示长期有效；结束后券码在结算时自动失效。">
            <TextInput name="endsAt" type="datetime-local" />
          </FormLabel>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <FormLabel label="总次数" help="全站最大核销次数。为空表示不限总次数。">
            <TextInput name="maxRedemptions" inputMode="numeric" placeholder="可选" />
          </FormLabel>
          {isAutomatic ? null : (
            <FormLabel label="单用户" help="单个用户最多核销次数。兑换码通常填 1。">
              <TextInput name="maxRedemptionsPerUser" inputMode="numeric" placeholder="1" />
            </FormLabel>
          )}
        </div>
        <FormLabel
          label="供应商"
          help="算力积分付费订单使用 Hosted Checkout，优惠码必须绑定并同步到支付供应商；只有 100% 零元兑换券可不绑定供应商。"
        >
          <Select name="provider" value={provider} onChange={setProvider}>
            <option value="">仅零元内部兑换</option>
            <option value="airwallex" title={providerHelp("airwallex")}>
              Airwallex
            </option>
            <option value="wechat_pay" title={providerHelp("wechat_pay")}>
              微信支付
            </option>
            <option value="alipay" title={providerHelp("alipay")}>
              支付宝
            </option>
            <option value="manual" title={providerHelp("manual")}>
              线下确认
            </option>
          </Select>
        </FormLabel>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] leading-5 text-slate-600">
          {appliesProductType === "compute_point_pack"
            ? `算力积分促销券需先同步为 ${siteKey === "cn" ? "微信/支付宝" : "Airwallex"} coupon；支付失败会自动释放预占核销次数。`
            : `非算力商品如需付费折扣，应选择 ${siteKey === "cn" ? "微信支付" : "Airwallex"} 并完成供应商优惠券同步。`}
        </div>
        <TextInput name="description" placeholder="内部备注，可选" />
        <Button type="submit" disabled={loading}>
          <IconPlus className="size-3.5" />
          创建
        </Button>
      </form>
    </section>
  );
}

// Edit an existing promotion. Only the fields the server's UpdateAdminBillingPromotion
// DTO accepts are editable — discount %, code, and scope are write-once (changing a
// live coupon's value/scope after issuance is unsafe), so they're shown read-only.
function PromotionEditDialog({
  promotion,
  loading,
  onClose,
  onSubmit,
}: {
  promotion: BillingPromotionRow;
  loading: boolean;
  onClose: () => void;
  onSubmit: (promotionId: string, payload: Record<string, unknown>) => void;
}) {
  const [name, setName] = useState(promotion.name);
  const [description, setDescription] = useState(promotion.description ?? "");
  const [status, setStatus] = useState<string>(promotion.status);
  const [startsAt, setStartsAt] = useState(toDatetimeLocal(promotion.startsAt));
  const [endsAt, setEndsAt] = useState(toDatetimeLocal(promotion.endsAt));
  const [maxRedemptions, setMaxRedemptions] = useState(
    promotion.maxRedemptions != null ? String(promotion.maxRedemptions) : ""
  );
  const [maxRedemptionsPerUser, setMaxRedemptionsPerUser] = useState(
    promotion.maxRedemptionsPerUser != null ? String(promotion.maxRedemptionsPerUser) : ""
  );

  function buildPayload(): Record<string, unknown> {
    return {
      name: name.trim(),
      description: description.trim() ? description.trim() : null,
      status,
      startsAt: startsAt ? new Date(startsAt).toISOString() : null,
      endsAt: endsAt ? new Date(endsAt).toISOString() : null,
      maxRedemptions: maxRedemptions ? Number(maxRedemptions) : null,
      maxRedemptionsPerUser: maxRedemptionsPerUser ? Number(maxRedemptionsPerUser) : null,
    };
  }

  return (
    <AdminDialog
      open
      title={`编辑促销券 · ${promotion.code ?? promotion.name}`}
      description="可调整名称、状态、生效窗口与核销上限。折扣比例与适用范围创建后不可更改。"
      onClose={onClose}
      footer={
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={loading || !!promotion.archivedAt}
            onClick={() => onSubmit(promotion.id, { archived: true })}
          >
            归档
          </Button>
          <Button variant="outline" size="sm" disabled={loading} onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            disabled={loading}
            onClick={() => onSubmit(promotion.id, buildPayload())}
          >
            保存
          </Button>
        </>
      }
    >
      <form
        inert={loading}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(promotion.id, buildPayload());
        }}
        className="grid gap-3"
      >
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] leading-5 text-slate-600">
          折扣 {promotionDiscountLabel(promotion)} · {promotionScopeLabel(promotion)} ·{" "}
          {promotion.durationType}（创建后不可更改）
        </div>
        <FormLabel label="名称" help="后台运营识别用名称。">
          <TextInput value={name} onChange={(event) => setName(event.target.value)} required />
        </FormLabel>
        <FormLabel label="状态" help="草稿不可用；启用后可核销；暂停保留历史但不允许新订单使用。">
          <Select value={status} onChange={setStatus}>
            <option value="draft">草稿</option>
            <option value="active">启用</option>
            <option value="paused">暂停</option>
          </Select>
        </FormLabel>
        <div className="grid grid-cols-2 gap-2">
          <FormLabel label="生效时间" help="留空表示立即生效。">
            <TextInput
              type="datetime-local"
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
            />
          </FormLabel>
          <FormLabel label="结束时间" help="留空表示长期有效。">
            <TextInput
              type="datetime-local"
              value={endsAt}
              onChange={(event) => setEndsAt(event.target.value)}
            />
          </FormLabel>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <FormLabel label="总次数" help="全站最大核销次数；留空表示不限。">
            <TextInput
              inputMode="numeric"
              value={maxRedemptions}
              onChange={(event) => setMaxRedemptions(event.target.value)}
              placeholder="∞"
            />
          </FormLabel>
          <FormLabel label="单用户" help="单个用户最多核销次数；留空表示不限。">
            <TextInput
              inputMode="numeric"
              value={maxRedemptionsPerUser}
              onChange={(event) => setMaxRedemptionsPerUser(event.target.value)}
              placeholder="∞"
            />
          </FormLabel>
        </div>
        <FormLabel label="备注">
          <TextInput
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="内部备注，可选"
          />
        </FormLabel>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </AdminDialog>
  );
}
