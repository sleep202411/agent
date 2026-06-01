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

export function BillingCatalogPanel({
  siteLabel,
  databaseLabel,
  initialPrices,
  initialError,
}: {
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
        onSyncBinding={handleSyncPriceBinding}
      />
    </div>
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
  onSyncBinding,
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
  onSyncBinding: (bindingId: string) => void;
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
              <p className="text-sm font-semibold text-slate-950">
                {formatMoneyMinor(price.amountMinor, price.currency)}
              </p>
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
    ],
    // onSyncBinding is a render-stable closure used only in an onClick; the
    // column defs never need to rebuild for it.
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
                <option value="bubble_pack" title={productTypeHelp("bubble_pack")}>
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
      >
        <CreatePriceForm
          loading={loading}
          onSubmit={onCreatePrice}
          onCancel={() => onCreateDialogOpenChange(false)}
        />
      </AdminDialog>
    </>
  );
}

function CreatePriceForm({
  loading,
  onSubmit,
  onCancel,
}: {
  loading: boolean;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  const [productType, setProductType] = useState("community_point_pack");
  const [walletCurrency, setWalletCurrency] = useState("community_point");
  const [walletAmount, setWalletAmount] = useState("");
  const [planKey, setPlanKey] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [amountMinor, setAmountMinor] = useState("");

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
    } else if (value === "bubble_pack") {
      setWalletCurrency("bubble");
    } else {
      setWalletCurrency("");
    }
  }

  function handleWalletCurrencyChange(value: string) {
    setWalletCurrency(value);
    if (!value) setWalletAmount("");
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <FormLabel
        label="商品名称"
        help="运营后台展示名，不等同于支付供应商侧商品名；同步时会复制到 provider payload。"
      >
        <TextInput name="itemName" required placeholder="1000 社区积分" />
      </FormLabel>
      <FormLabel
        label="商品类型"
        help="决定订单类型和履约方向：算力积分、社区积分、个人会员或团队会员。"
      >
        <Select name="productType" value={productType} onChange={handleProductTypeChange}>
          <option value="community_point_pack" title={productTypeHelp("community_point_pack")}>
            社区积分
          </option>
          <option value="bubble_pack" title={productTypeHelp("bubble_pack")}>
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
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            placeholder="USD"
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
            onChange={(event) => setAmountMinor(event.target.value)}
            placeholder="9900"
          />
        </FormLabel>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <FormLabel label="周期" help="一次性适用于积分包；月付/年付适用于会员订阅价格。">
          <Select name="interval" defaultValue="one_time">
            <option value="one_time">一次性</option>
            <option value="month">月付</option>
            <option value="year">年付</option>
          </Select>
        </FormLabel>
        <FormLabel label="主体" help="权益归属对象。个人会员/积分通常归用户，团队会员可归工作区。">
          <Select name="subjectType" defaultValue="user">
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
            <option value="bubble">算力积分</option>
            <option value="community_point">社区积分</option>
          </Select>
          <TextInput
            name="grantsWalletAmount"
            inputMode="numeric"
            required={Boolean(walletCurrency)}
            disabled={!walletCurrency}
            value={walletAmount}
            onChange={(event) => setWalletAmount(event.target.value)}
            placeholder="发放数量"
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
        <Select name="provider" defaultValue="airwallex">
          <option value="">稍后配置</option>
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
      <TextInput name="itemDescription" placeholder="内部备注，可选" />
      <AutoCodePreview code={generatedItemCode} />
      <div className="-mx-5 -mb-5 mt-1 flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
          取消
        </Button>
        <Button type="submit" disabled={loading}>
          <IconPlus className="size-3.5" />
          {loading ? "创建中" : "创建套餐"}
        </Button>
      </div>
    </form>
  );
}
