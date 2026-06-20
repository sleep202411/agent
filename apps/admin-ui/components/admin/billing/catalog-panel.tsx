"use client";

// 套餐商品 (catalog) page for the /billing sub-app. Moved AS-IS from
// CatalogView + CreatePriceForm (admin-billing-panel.tsx:1423/1653) during the
// P2 per-page split.
//
// CATALOG vs PRICES SPLIT: AdminBillingPricesData is a single flat list of
// priced products — the price IS the row (item identity + money + grant +
// provider binding + sales + status all interleave in one DataTable). There is
// no item-only endpoint, so the table is NOT cleanly separable into two tables.
// Per the Stage-2 fallback, the catalog page owns the full 套餐商品 table (the
// canonical "商品目录与价格版本" view with money cells) AND the "新建套餐"
// create dialog, since the create button is part of this view's toolbar. The
// prices page (later stage) keeps a focused price-management surface; the
// CreatePriceForm can move there then without changing this page's data flow.

import { useMemo, useState } from "react";
import { IconPlus, IconRefresh } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";
import {
  AdminDialog,
  AutoCodePreview,
  buildBillingItemCode,
  ColumnHeader,
  ErrorBanner,
  formatDate,
  formatMoneyMinor,
  FormLabel,
  grantLabel,
  InfoTip,
  intervalLabel,
  mutateEnvelope,
  PageHeader,
  productTypeHelp,
  productTypeLabel,
  providerHelp,
  ProviderBadge,
  requestEnvelope,
  RiskText,
  Select,
  StatusPill,
  stringField,
  TextInput,
  toErrorMessage,
} from "./shared";
import type { AdminBillingPricesData, BillingPriceRow } from "./types";
import { emptyPrices } from "./types";

type BillingSiteKey = "global" | "cn";

/** The display "compare-at" / 原价 (minor units) a price card strikes through. */
function originalAmountMinorOf(price: BillingPriceRow): string | null {
  const value = price.metadata?.originalAmountMinor;
  return typeof value === "string" && /^\d+$/.test(value) ? value : null;
}

export function BillingCatalogPanel({
  siteKey,
  siteLabel,
  databaseLabel,
  initialPrices,
  initialError,
}: {
  siteKey: BillingSiteKey;
  siteLabel: string;
  databaseLabel: string;
  initialPrices: AdminBillingPricesData | null;
  initialError?: string | null;
}) {
  const [prices, setPrices] = useState(initialPrices ?? emptyPrices);
  const [priceProductType, setPriceProductType] = useState("");
  const [priceProvider, setPriceProvider] = useState("");
  const [createPriceDialogOpen, setCreatePriceDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [editingPrice, setEditingPrice] = useState<BillingPriceRow | null>(null);

  function priceQueryString() {
    const params = new URLSearchParams();
    if (priceProductType) params.set("productType", priceProductType);
    if (priceProvider) params.set("provider", priceProvider);
    const query = params.toString();
    return query ? `?${query}` : "";
  }

  async function refreshPrices() {
    setLoading(true);
    setError(null);
    try {
      setPrices(
        await requestEnvelope<AdminBillingPricesData>(
          `/api/admin/billing/prices${priceQueryString()}`
        )
      );
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleCreatePrice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const provider = stringField(form, "provider");
    const walletCurrency = stringField(form, "grantsWalletCurrency");
    const walletAmount = stringField(form, "grantsWalletAmount");
    const planKey = stringField(form, "grantsPlanKey");
    const grantDurationDays = stringField(form, "grantDurationDays");
    const productType = stringField(form, "productType");
    const currency = stringField(form, "currency").toUpperCase();
    const amountMinor = stringField(form, "amountMinor");
    const originalAmountMinor = stringField(form, "originalAmountMinor");
    const computeTopupMetadata =
      productType === "compute_point_pack"
        ? {
            topupKind: "compute_point",
            rateMode: currency === "USD" ? "usd_cent_anchor" : "explicit_admin_pricing",
            cell: siteKey,
            entrySurface: "fizzstudio_compute_topup",
          }
        : undefined;
    // Merge the display compare-at into priceMetadata (the studio strikes through
    // metadata.originalAmountMinor); send undefined when nothing to set.
    const priceMetadata = {
      ...(computeTopupMetadata ?? {}),
      ...(originalAmountMinor ? { originalAmountMinor } : {}),
    };
    try {
      await mutateEnvelope("/api/admin/billing/prices", {
        itemCode: buildBillingItemCode({
          productType,
          walletAmount,
          planKey,
          currency,
          amountMinor,
        }),
        itemName: stringField(form, "itemName"),
        itemDescription: stringField(form, "itemDescription") || undefined,
        productType,
        currency,
        amountMinor,
        interval: stringField(form, "interval"),
        subjectType: stringField(form, "subjectType"),
        grantsWalletCurrency: walletCurrency || undefined,
        grantsWalletAmount: walletCurrency && walletAmount ? walletAmount : undefined,
        grantsPlanKey: planKey || undefined,
        grantDurationDays: grantDurationDays ? Number(grantDurationDays) : undefined,
        priceMetadata: Object.keys(priceMetadata).length ? priceMetadata : undefined,
        providerBindings: provider
          ? [
              {
                provider,
                status: "sync_pending",
              },
            ]
          : [],
      });
      formElement.reset();
      setCreatePriceDialogOpen(false);
      await refreshPrices();
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  // Set / clear the display compare-at (原价) on an existing price. Sends the
  // FULL merged metadata (updateAdminPrice replaces it) so other keys survive.
  async function handleUpdatePriceCompareAt(price: BillingPriceRow, originalAmountMinor: string) {
    setLoading(true);
    setError(null);
    const nextMetadata: Record<string, unknown> = { ...price.metadata };
    if (originalAmountMinor) nextMetadata.originalAmountMinor = originalAmountMinor;
    else delete nextMetadata.originalAmountMinor;
    try {
      await mutateEnvelope(
        `/api/admin/billing/prices/${price.id}`,
        { priceMetadata: nextMetadata },
        "PATCH"
      );
      setEditingPrice(null);
      await refreshPrices();
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleSyncPriceBinding(bindingId: string) {
    setLoading(true);
    setError(null);
    try {
      await mutateEnvelope(`/api/admin/billing/provider-bindings/${bindingId}/sync`, {});
      await refreshPrices();
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
        title="套餐商品"
        description="内部商品目录是事实源，Airwallex 与微信支付只作为 provider binding。"
      />

      {error ? <ErrorBanner message={error} /> : null}

      <CatalogView
        prices={prices.items}
        productType={priceProductType}
        provider={priceProvider}
        loading={loading}
        createDialogOpen={createPriceDialogOpen}
        onProductTypeChange={setPriceProductType}
        onProviderChange={setPriceProvider}
        onCreateDialogOpenChange={setCreatePriceDialogOpen}
        onRefresh={() => void refreshPrices()}
        onCreatePrice={handleCreatePrice}
        onEditPrice={setEditingPrice}
        onSyncBinding={handleSyncPriceBinding}
        siteKey={siteKey}
      />
      {editingPrice ? (
        <PriceCompareAtDialog
          key={editingPrice.id}
          price={editingPrice}
          loading={loading}
          onClose={() => setEditingPrice(null)}
          onSubmit={handleUpdatePriceCompareAt}
        />
      ) : null}
    </div>
  );
}

// Edit the display compare-at (原价) of an existing price. The real charge
// (amountMinor) is immutable here — only the strike-through merchandising metadata.
function PriceCompareAtDialog({
  price,
  loading,
  onClose,
  onSubmit,
}: {
  price: BillingPriceRow;
  loading: boolean;
  onClose: () => void;
  onSubmit: (price: BillingPriceRow, originalAmountMinor: string) => void;
}) {
  const [value, setValue] = useState(originalAmountMinorOf(price) ?? "");

  return (
    <AdminDialog
      open
      title={`编辑原价 · ${price.name}`}
      description="设置商城展示的划线原价（最小单位，与售价同单位）。清空则不显示折扣。售价本身不在此修改。"
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" size="sm" disabled={loading} onClick={onClose}>
            取消
          </Button>
          <Button size="sm" disabled={loading} onClick={() => onSubmit(price, value.trim())}>
            保存
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] leading-5 text-slate-600">
          售价 {formatMoneyMinor(price.amountMinor, price.currency)}（{price.currency}
          ，不可在此修改）
        </div>
        <FormLabel
          label="原价 minor（划线价）"
          help="留空表示不显示折扣。例如售价 2700、原价 3000 显示 -10%。"
        >
          <TextInput
            inputMode="numeric"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="可选"
          />
        </FormLabel>
      </div>
    </AdminDialog>
  );
}

function CatalogView({
  prices,
  productType,
  provider,
  loading,
  createDialogOpen,
  onProductTypeChange,
  onProviderChange,
  onCreateDialogOpenChange,
  onRefresh,
  onCreatePrice,
  onEditPrice,
  onSyncBinding,
  siteKey,
}: {
  prices: BillingPriceRow[];
  productType: string;
  provider: string;
  loading: boolean;
  createDialogOpen: boolean;
  onProductTypeChange: (value: string) => void;
  onProviderChange: (value: string) => void;
  onCreateDialogOpenChange: (open: boolean) => void;
  onRefresh: () => void;
  onCreatePrice: (event: React.FormEvent<HTMLFormElement>) => void;
  onEditPrice: (price: BillingPriceRow) => void;
  onSyncBinding: (bindingId: string) => void;
  siteKey: BillingSiteKey;
}) {
  const columns = useMemo<ColumnDef<BillingPriceRow, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "商品",
        cell: ({ row }) => {
          const price = row.original;
          return (
            <>
              <p className="text-sm font-medium text-slate-950">{price.name}</p>
              <p className="mt-0.5 text-[12px] text-slate-500">
                {price.code} · {productTypeLabel(price.productType)}
              </p>
            </>
          );
        },
      },
      {
        id: "price",
        header: "价格",
        enableSorting: false,
        cell: ({ row }) => {
          const price = row.original;
          return (
            <>
              <div className="flex items-baseline gap-1.5">
                <p className="text-sm font-semibold text-slate-950">
                  {formatMoneyMinor(price.amountMinor, price.currency)}
                </p>
                {originalAmountMinorOf(price) ? (
                  <span className="text-[12px] text-slate-400 line-through">
                    {formatMoneyMinor(originalAmountMinorOf(price)!, price.currency)}
                  </span>
                ) : null}
              </div>
              <p className="text-[12px] text-slate-500">
                {intervalLabel(price.interval)} · {price.subjectType}
              </p>
            </>
          );
        },
      },
      {
        id: "grant",
        header: () => (
          <ColumnHeader help="订单支付成功后的履约结果：积分到账、会员权益开通，或无自动权益。">
            权益
          </ColumnHeader>
        ),
        enableSorting: false,
        cell: ({ row }) => {
          const price = row.original;
          return (
            <>
              <p className="text-sm text-slate-700">{grantLabel(price)}</p>
              <p className="text-[12px] text-slate-500">
                {price.grantDurationDays ? `${price.grantDurationDays} 天` : "长期/一次性"}
              </p>
            </>
          );
        },
      },
      {
        id: "binding",
        header: () => (
          <ColumnHeader help="内部价格和支付供应商价格/商品 ID 的绑定。Airwallex/微信需要同步，线下确认和内部发放不需要。">
            Provider Binding
          </ColumnHeader>
        ),
        enableSorting: false,
        cell: ({ row }) => {
          const price = row.original;
          return (
            <div className="flex max-w-[360px] flex-wrap gap-1.5">
              {price.providerBindings.map((binding) => (
                <ProviderBadge key={binding.id} binding={binding} onSync={onSyncBinding} />
              ))}
              {!price.providerBindings.length ? <RiskText>未配置渠道</RiskText> : null}
            </div>
          );
        },
      },
      {
        id: "sales",
        header: "销售",
        enableSorting: false,
        cell: ({ row }) => {
          const price = row.original;
          return (
            <>
              <p className="text-sm text-slate-700">{price.counts.orders} 订单</p>
              <p className="text-[12px] text-slate-500">{price.counts.subscriptions} 订阅</p>
            </>
          );
        },
      },
      {
        accessorKey: "isActive",
        header: "状态",
        cell: ({ row }) => {
          const price = row.original;
          return (
            <>
              <StatusPill tone={price.isActive && !price.archivedAt ? "success" : "muted"}>
                {price.isActive && !price.archivedAt ? "active" : "inactive"}
              </StatusPill>
              <p className="mt-1 text-[11px] text-slate-400">{formatDate(price.updatedAt)}</p>
            </>
          );
        },
      },
      {
        id: "actions",
        header: "操作",
        enableSorting: false,
        meta: { pin: "right" },
        cell: ({ row }) => (
          <Button variant="outline" size="sm" onClick={() => onEditPrice(row.original)}>
            原价
          </Button>
        ),
      },
    ],
    // onSyncBinding / onEditPrice are render-stable closures used only in onClick;
    // the column defs never need to rebuild for them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return (
    <>
      <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="border-b border-slate-200 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">商品目录与价格版本</h3>
              <p className="mt-1 text-[12px] text-slate-500">
                社区积分、算力积分和会员套餐统一从内部价格出发。
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-[180px_160px_auto_auto]">
              <Select
                value={productType}
                onChange={onProductTypeChange}
                title="按内部商品类型过滤；商品类型决定履约发放的是算力积分、社区积分还是会员权益。"
              >
                <option value="">全部商品类型</option>
                <option
                  value="community_point_pack"
                  title={productTypeHelp("community_point_pack")}
                >
                  社区积分
                </option>
                <option value="compute_point_pack" title={productTypeHelp("compute_point_pack")}>
                  算力积分
                </option>
                <option value="membership_plan" title={productTypeHelp("membership_plan")}>
                  会员套餐
                </option>
                <option
                  value="team_membership_plan"
                  title={productTypeHelp("team_membership_plan")}
                >
                  团队会员
                </option>
              </Select>
              <Select
                value={provider}
                onChange={onProviderChange}
                title="支付或履约来源。线下确认不是兑换码，内部发放用于平台承担成本的零元订单。"
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
                <option value="internal" title={providerHelp("internal")}>
                  内部发放
                </option>
              </Select>
              <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
                <IconRefresh className={cn("size-3.5", loading && "animate-spin")} />
                应用
              </Button>
              <Button size="sm" onClick={() => onCreateDialogOpenChange(true)} disabled={loading}>
                <IconPlus className="size-3.5" />
                新建套餐
              </Button>
            </div>
          </div>
        </div>
        <DataTable
          columns={columns}
          data={prices}
          loading={loading}
          minWidth={1120}
          pageSize={20}
          emptyLabel="暂无商品价格"
          className="rounded-none border-0"
        />
      </section>

      <AdminDialog
        open={createDialogOpen}
        title="新建套餐"
        description="创建内部商品价格；支付供应商只通过 binding 同步，套餐权益直接进入当前 billing 钱包账本。"
        onClose={() => onCreateDialogOpenChange(false)}
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => onCreateDialogOpenChange(false)}
              disabled={loading}
            >
              取消
            </Button>
            <Button type="submit" form="catalog-create-price-form" disabled={loading}>
              <IconPlus className="size-3.5" />
              {loading ? "创建中" : "创建套餐"}
            </Button>
          </>
        }
      >
        <CreatePriceForm onSubmit={onCreatePrice} siteKey={siteKey} />
      </AdminDialog>
    </>
  );
}

function CreatePriceForm({
  onSubmit,
  siteKey,
}: {
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  siteKey: BillingSiteKey;
}) {
  const defaults = computePointCatalogDefaults(siteKey);
  const [productType, setProductType] = useState("compute_point_pack");
  const [walletCurrency, setWalletCurrency] = useState("compute_point");
  const [walletAmount, setWalletAmount] = useState("");
  const [planKey, setPlanKey] = useState("");
  const [currency, setCurrency] = useState(defaults.currency);
  const [amountMinor, setAmountMinor] = useState("");
  const [priceInterval, setPriceInterval] = useState("one_time");
  const [subjectType, setSubjectType] = useState("user");
  const [provider, setProvider] = useState(defaults.provider);

  const generatedItemCode = buildBillingItemCode({
    productType,
    walletAmount,
    planKey,
    currency,
    amountMinor,
  });

  function handleProductTypeChange(value: string) {
    setProductType(value);
    if (value === "community_point_pack") {
      setWalletCurrency("community_point");
      setProvider(defaults.provider);
    } else if (value === "compute_point_pack") {
      setWalletCurrency("compute_point");
      setCurrency(defaults.currency);
      setPriceInterval("one_time");
      setSubjectType("user");
      setPlanKey("");
      setProvider(defaults.provider);
      if (
        defaults.currency === "USD" &&
        amountMinor &&
        (!walletAmount || walletAmount === amountMinor)
      ) {
        setWalletAmount(amountMinor);
      }
    } else {
      setWalletCurrency("");
      setProvider(defaults.provider);
    }
  }

  function handleWalletCurrencyChange(value: string) {
    setWalletCurrency(value);
    if (!value) setWalletAmount("");
  }

  function handleCurrencyChange(value: string) {
    const nextCurrency = value.toUpperCase();
    setCurrency(nextCurrency);
    if (productType === "compute_point_pack" && nextCurrency === "USD" && amountMinor) {
      setWalletAmount(amountMinor);
    }
  }

  function handleAmountMinorChange(value: string) {
    const previousAmountMinor = amountMinor;
    setAmountMinor(value);
    if (
      productType === "compute_point_pack" &&
      currency === "USD" &&
      (!walletAmount || walletAmount === previousAmountMinor)
    ) {
      setWalletAmount(value);
    }
  }

  return (
    <form id="catalog-create-price-form" onSubmit={onSubmit} className="grid gap-4">
      <FormLabel
        label="商品名称"
        help="运营后台展示名，不等同于支付供应商侧商品名；同步时会复制到 provider payload。"
      >
        <TextInput name="itemName" required placeholder="10,000 算力积分" />
      </FormLabel>
      <FormLabel
        label="商品类型"
        help="决定订单类型和履约方向：算力积分、社区积分、个人会员或团队会员。"
      >
        <Select name="productType" value={productType} onChange={handleProductTypeChange}>
          <option value="community_point_pack" title={productTypeHelp("community_point_pack")}>
            社区积分
          </option>
          <option value="compute_point_pack" title={productTypeHelp("compute_point_pack")}>
            算力积分
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
        <FormLabel
          label="币种"
          help="订单法币币种，使用 ISO 4217 三位码，例如 USD、CNY。不是平台积分币种。"
        >
          <TextInput
            name="currency"
            required
            maxLength={3}
            value={currency}
            onChange={(event) => handleCurrencyChange(event.target.value)}
            placeholder={defaults.currency}
          />
        </FormLabel>
        <FormLabel
          label="金额 minor"
          help="法币最小单位金额。USD 9900 表示 99.00 美元，CNY 9900 表示 99.00 元。"
        >
          <TextInput
            name="amountMinor"
            required
            inputMode="numeric"
            value={amountMinor}
            onChange={(event) => handleAmountMinorChange(event.target.value)}
            placeholder={siteKey === "cn" ? "9900" : "10000"}
          />
        </FormLabel>
      </div>
      <FormLabel
        label="原价 minor（划线价，可选）"
        help="商城展示的划线原价，最小单位（与金额 minor 同单位）。留空则不显示折扣；例如售价 2700、原价 3000 显示 -10%。"
      >
        <TextInput name="originalAmountMinor" inputMode="numeric" placeholder="可选" />
      </FormLabel>
      <div className="grid grid-cols-2 gap-2">
        <FormLabel label="周期" help="一次性适用于积分包；月付/年付适用于会员订阅价格。">
          <Select name="interval" value={priceInterval} onChange={setPriceInterval}>
            <option value="one_time">一次性</option>
            <option value="month">月付</option>
            <option value="year">年付</option>
          </Select>
        </FormLabel>
        <FormLabel label="主体" help="权益归属对象。个人会员/积分通常归用户，团队会员可归工作区。">
          <Select name="subjectType" value={subjectType} onChange={setSubjectType}>
            <option value="user">用户</option>
            <option value="workspace">工作区</option>
          </Select>
        </FormLabel>
      </div>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center gap-1.5">
          <p className="text-[12px] font-semibold text-slate-500">履约权益</p>
          <InfoTip text="支付完成后系统自动发放的权益。社区积分/算力积分进入可消费余额；可提现社区积分只能由创作者收入产生，不允许通过商品或券发放。" />
        </div>
        <div className="mt-2 grid gap-2">
          <Select
            name="grantsWalletCurrency"
            value={walletCurrency}
            onChange={handleWalletCurrencyChange}
          >
            <option value="">不发放积分</option>
            <option value="compute_point">算力积分</option>
            <option value="community_point">社区积分</option>
          </Select>
          <TextInput
            name="grantsWalletAmount"
            inputMode="numeric"
            required={Boolean(walletCurrency)}
            disabled={!walletCurrency}
            value={walletAmount}
            onChange={(event) => setWalletAmount(event.target.value)}
            placeholder={
              productType === "compute_point_pack" && currency === "USD"
                ? "自动等于 USD minor"
                : "发放数量"
            }
          />
          <TextInput
            name="grantsPlanKey"
            value={planKey}
            onChange={(event) => setPlanKey(event.target.value)}
            placeholder="会员 plan key"
          />
          <TextInput name="grantDurationDays" inputMode="numeric" placeholder="会员天数" />
        </div>
      </div>
      <FormLabel
        label="供应商"
        help="选择后创建 provider binding。线下确认用于线下收款补单；兑换码请在促销券里创建。"
      >
        <Select name="provider" value={provider} onChange={setProvider}>
          <option value="">稍后配置</option>
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
      <TextInput name="itemDescription" placeholder="内部备注，可选" />
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] leading-5 text-slate-600">
        {siteKey === "cn"
          ? "中国站算力积分必须使用 CNY，后台显式填写售价和到账算力积分；支付通道使用微信支付或支付宝，不能混入国际站 USD 价格。"
          : "国际站算力积分锚定 USD：1 USD minor = 1 算力积分，Airwallex 负责面向用户的本地币种和 FX。"}
      </div>
      <AutoCodePreview code={generatedItemCode} />
    </form>
  );
}

function computePointCatalogDefaults(siteKey: BillingSiteKey) {
  if (siteKey === "cn") {
    return { currency: "CNY", provider: "wechat_pay" };
  }
  return { currency: "USD", provider: "airwallex" };
}
