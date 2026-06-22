"use client";

import { useMemo, useState } from "react";
import { IconEdit, IconPlus, IconRefresh } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { Textarea } from "@/components/ui/textarea";
import {
  AdminDialog,
  ColumnHeader,
  ErrorBanner,
  formatBpsPercent,
  formatDate,
  formatInteger,
  formatMoneyMinor,
  FormLabel,
  InfoTip,
  intervalLabel,
  mutateEnvelope,
  PageHeader,
  productTypeLabel,
  productFamily,
  ProductFamilyTabs,
  type ProductFamily,
  requestEnvelope,
  Select,
  StatusPill,
  stringField,
  TextInput,
  toErrorMessage,
} from "./shared";
import type {
  AdminBillingMembershipPlansData,
  BillingMembershipPlanRow,
  BillingMembershipPlanStatus,
} from "./types";
import { emptyMembershipPlans } from "./types";

type BillingSiteKey = "global" | "cn";

const DEFAULT_LIMITS_TEMPLATE = {
  queuePriority: 5,
  concurrentJobs: 1,
  queuedJobs: 4,
};

export function BillingMembershipsPanel({
  siteLabel,
  databaseLabel,
  initialPlans,
  initialError,
}: {
  siteKey: BillingSiteKey;
  siteLabel: string;
  databaseLabel: string;
  initialPlans: AdminBillingMembershipPlansData | null;
  initialError?: string | null;
}) {
  const [plans, setPlans] = useState(initialPlans ?? emptyMembershipPlans);
  // Studio (个人 + 团队) vs 社区 — grouping by product family, not raw type.
  const [family, setFamily] = useState<ProductFamily>("studio");
  const [status, setStatus] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<BillingMembershipPlanRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  function queryString() {
    const params = new URLSearchParams();
    // Load all types; the family tab filters client-side.
    if (status) params.set("status", status);
    const query = params.toString();
    return query ? `?${query}` : "";
  }

  async function refreshPlans() {
    setLoading(true);
    setError(null);
    try {
      setPlans(
        await requestEnvelope<AdminBillingMembershipPlansData>(
          `/api/admin/billing/membership-plans${queryString()}`
        )
      );
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleCreatePlan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const formElement = event.currentTarget;
    try {
      await mutateEnvelope(
        "/api/admin/billing/membership-plans",
        membershipPlanPayload(new FormData(formElement), "create")
      );
      formElement.reset();
      setCreateOpen(false);
      await refreshPlans();
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdatePlan(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingPlan) return;
    setLoading(true);
    setError(null);
    try {
      await mutateEnvelope(
        `/api/admin/billing/membership-plans/${editingPlan.id}`,
        membershipPlanPayload(new FormData(event.currentTarget), "update"),
        "PATCH"
      );
      setEditingPlan(null);
      await refreshPlans();
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
        title="会员计划"
        description="配置个人会员与团队会员的权益策略；价格、支付渠道和优惠券仍在商品目录中管理。"
      />

      {error ? <ErrorBanner message={error} /> : null}

      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-950">计划策略</h2>
            <p className="mt-0.5 text-[12px] text-slate-500">
              planKey 是订单和 entitlement 的稳定合同键；创建后不要改名。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ProductFamilyTabs
              value={family}
              onChange={setFamily}
              labels={{ studio: "Studio 会员", community: "社区会员" }}
            />
            <div className="w-32">
              <Select value={status} onChange={setStatus} title="状态">
                <option value="">全部状态</option>
                <option value="draft">草稿</option>
                <option value="active">启用</option>
                <option value="paused">暂停</option>
                <option value="archived">归档</option>
              </Select>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refreshPlans()}
              disabled={loading}
            >
              <IconRefresh className="size-4" />
              刷新
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)} disabled={loading}>
              <IconPlus className="size-4" />
              新建计划
            </Button>
          </div>
        </div>

        <MembershipPlansTable
          plans={plans.items.filter((plan) => productFamily(plan.productType) === family)}
          loading={loading}
          onEditPlan={setEditingPlan}
        />
      </section>

      <AdminDialog
        open={createOpen}
        title="新建会员计划"
        description="先创建计划策略，再到套餐商品中新建会员价格并填写相同 grantsPlanKey。"
        onClose={() => setCreateOpen(false)}
      >
        <MembershipPlanForm mode="create" loading={loading} onSubmit={handleCreatePlan} />
      </AdminDialog>

      <AdminDialog
        open={Boolean(editingPlan)}
        title="编辑会员计划"
        description="编辑只影响之后解析的权益策略；历史订单和已发放钱包 grant 仍保留原始审计记录。"
        onClose={() => setEditingPlan(null)}
      >
        {editingPlan ? (
          <MembershipPlanForm
            mode="update"
            loading={loading}
            plan={editingPlan}
            onSubmit={handleUpdatePlan}
          />
        ) : null}
      </AdminDialog>
    </div>
  );
}

function MembershipPlansTable({
  plans,
  loading,
  onEditPlan,
}: {
  plans: BillingMembershipPlanRow[];
  loading: boolean;
  onEditPlan: (plan: BillingMembershipPlanRow) => void;
}) {
  const columns = useMemo<ColumnDef<BillingMembershipPlanRow, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "计划",
        cell: ({ row }) => {
          const plan = row.original;
          return (
            <>
              <p className="text-sm font-semibold text-slate-950">{plan.name}</p>
              <p className="mt-0.5 font-mono text-[12px] text-slate-500">{plan.planKey}</p>
              {plan.description ? (
                <p className="mt-1 line-clamp-2 max-w-md text-[12px] leading-5 text-slate-500">
                  {plan.description}
                </p>
              ) : null}
            </>
          );
        },
      },
      {
        id: "type",
        header: "类型",
        enableSorting: false,
        cell: ({ row }) => {
          const plan = row.original;
          return (
            <>
              <p className="text-sm text-slate-700">{productTypeLabel(plan.productType)}</p>
              <p className="text-[12px] text-slate-500">{plan.subjectType}</p>
            </>
          );
        },
      },
      {
        accessorKey: "rank",
        header: () => (
          <ColumnHeader help="访问控制按 rank 比较；rank 越高，模型权限和队列优先级越高。">
            Rank
          </ColumnHeader>
        ),
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.rank}</span>,
      },
      {
        id: "benefits",
        header: "权益",
        enableSorting: false,
        cell: ({ row }) => {
          const plan = row.original;
          return (
            <>
              <p className="text-sm font-semibold text-slate-950">
                {formatInteger(plan.includedComputeCredits)} 算力积分
              </p>
              <p className="text-[12px] text-slate-500">
                {plan.includedSeats} 席位
                {plan.maxSeats ? ` / 上限 ${plan.maxSeats}` : " / 不限上限"}
              </p>
              <p className="text-[12px] text-slate-500">
                充值折扣 {formatBpsPercent(plan.topupDiscountBps)}
              </p>
              <p className="text-[12px] text-slate-500">
                并发 {limitText(plan.limits.concurrentJobs)} · 队列{" "}
                {limitText(plan.limits.queuedJobs)} · 优先级{" "}
                {priorityText(plan.limits.queuePriority)}
              </p>
            </>
          );
        },
      },
      {
        id: "prices",
        header: "价格",
        enableSorting: false,
        cell: ({ row }) => {
          const prices = row.original.prices;
          if (!prices.length) return <RiskTextLite>未配置价格</RiskTextLite>;
          return (
            <div className="space-y-1">
              {prices.slice(0, 3).map((price) => (
                <p key={price.id} className="text-[12px] text-slate-600">
                  {formatMoneyMinor(price.amountMinor, price.currency)} ·{" "}
                  {intervalLabel(price.interval)}
                </p>
              ))}
              {prices.length > 3 ? (
                <p className="text-[11px] text-slate-400">另有 {prices.length - 3} 个价格</p>
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: "status",
        header: "状态",
        cell: ({ row }) => <MembershipStatusPill status={row.original.status} />,
      },
      {
        accessorKey: "updatedAt",
        header: "更新",
        cell: ({ row }) => (
          <span className="text-[12px] text-slate-500">{formatDate(row.original.updatedAt)}</span>
        ),
      },
      {
        id: "actions",
        header: "操作",
        enableSorting: false,
        meta: { pin: "right", cellClassName: "w-[96px]" },
        cell: ({ row }) => (
          <Button variant="outline" size="sm" onClick={() => onEditPlan(row.original)}>
            <IconEdit className="size-4" />
            编辑
          </Button>
        ),
      },
    ],
    [onEditPlan]
  );

  return (
    <DataTable
      columns={columns}
      data={plans}
      loading={loading}
      minWidth={1100}
      emptyLabel="暂无会员计划"
    />
  );
}

function MembershipPlanForm({
  mode,
  plan,
  loading,
  onSubmit,
}: {
  mode: "create" | "update";
  plan?: BillingMembershipPlanRow;
  loading: boolean;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const jsonDefaults = {
    featureFlags: stringifyJson(plan?.featureFlags ?? {}),
    limits: stringifyJson(plan?.limits ?? DEFAULT_LIMITS_TEMPLATE),
    marketing: stringifyJson(plan?.marketing ?? {}),
    metadata: stringifyJson(plan?.metadata ?? {}),
  };
  return (
    <form className="space-y-5" onSubmit={onSubmit}>
      <div className="grid gap-3 md:grid-cols-2">
        {mode === "create" ? (
          <FormLabel
            label="Plan Key"
            help="稳定合同键，只允许 lowercase snake_case；价格通过 grantsPlanKey 关联。"
          >
            <TextInput name="planKey" placeholder="basic" required />
          </FormLabel>
        ) : (
          <FormLabel label="Plan Key">
            <TextInput value={plan?.planKey ?? ""} disabled />
          </FormLabel>
        )}
        <FormLabel label="名称">
          <TextInput name="name" defaultValue={plan?.name ?? ""} required />
        </FormLabel>
        <FormLabel label="商品类型">
          <Select name="productType" defaultValue={plan?.productType ?? "membership_plan"}>
            <option value="membership_plan">个人会员</option>
            <option value="team_membership_plan">团队会员</option>
          </Select>
        </FormLabel>
        <FormLabel label="权益主体">
          <Select name="subjectType" defaultValue={plan?.subjectType ?? "user"}>
            <option value="user">用户</option>
            <option value="workspace">工作区</option>
          </Select>
        </FormLabel>
        <FormLabel label="状态">
          <Select name="status" defaultValue={plan?.status ?? "draft"}>
            <option value="draft">草稿</option>
            <option value="active">启用</option>
            <option value="paused">暂停</option>
            <option value="archived">归档</option>
          </Select>
        </FormLabel>
        <FormLabel label="Rank" help="访问控制比较值，越大越高档。">
          <TextInput name="rank" type="number" min={0} max={1000} defaultValue={plan?.rank ?? 10} />
        </FormLabel>
        <FormLabel label="包含算力积分">
          <TextInput
            name="includedComputeCredits"
            type="number"
            min={0}
            defaultValue={plan?.includedComputeCredits ?? "0"}
          />
        </FormLabel>
        <FormLabel label="包含席位">
          <TextInput
            name="includedSeats"
            type="number"
            min={1}
            defaultValue={plan?.includedSeats ?? 1}
          />
        </FormLabel>
        <FormLabel label="席位上限">
          <TextInput
            name="maxSeats"
            type="number"
            min={1}
            placeholder="留空表示不限"
            defaultValue={plan?.maxSeats ?? ""}
          />
        </FormLabel>
        <FormLabel label="充值折扣 bps" help="1000 = 10%，仅作为权益策略，具体优惠券仍需单独配置。">
          <TextInput
            name="topupDiscountBps"
            type="number"
            min={0}
            max={10000}
            defaultValue={plan?.topupDiscountBps ?? 0}
          />
        </FormLabel>
        <FormLabel label="默认计费周期">
          <Select
            name="billingIntervalDefault"
            defaultValue={plan?.billingIntervalDefault ?? "month"}
          >
            <option value="">不指定</option>
            <option value="month">月付</option>
            <option value="year">年付</option>
          </Select>
        </FormLabel>
        <label className="flex items-center gap-2 self-end rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
          <input
            name="seatOverageAllowed"
            type="checkbox"
            defaultChecked={plan?.seatOverageAllowed ?? false}
            className="size-4 rounded border-slate-300"
          />
          允许超出席位上限
        </label>
      </div>

      <FormLabel label="描述">
        <Textarea
          name="description"
          defaultValue={plan?.description ?? ""}
          className="min-h-20 border-slate-200 bg-white text-sm"
        />
      </FormLabel>

      <div className="grid gap-3 md:grid-cols-2">
        <JsonFormField
          name="featureFlags"
          label="Feature Flags JSON"
          defaultValue={jsonDefaults.featureFlags}
        />
        <JsonFormField
          name="limits"
          label="Limits JSON"
          defaultValue={jsonDefaults.limits}
          help="queuePriority 数字越小越先执行；concurrentJobs 是同一 user/workspace 同时 running 的生成数；queuedJobs 是等待队列 backlog；null 表示合同管理/不限制。"
        />
        <JsonFormField
          name="marketing"
          label="Marketing JSON"
          defaultValue={jsonDefaults.marketing}
        />
        <JsonFormField name="metadata" label="Metadata JSON" defaultValue={jsonDefaults.metadata} />
      </div>

      <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
        <Button type="submit" disabled={loading}>
          {mode === "create" ? "创建计划" : "保存修改"}
        </Button>
      </div>
    </form>
  );
}

function JsonFormField({
  name,
  label,
  defaultValue,
  help = "必须是 JSON object。留空会提交空对象。",
}: {
  name: string;
  label: string;
  defaultValue: string;
  help?: string;
}) {
  return (
    <FormLabel label={label} help={help}>
      <Textarea
        name={name}
        defaultValue={defaultValue}
        spellCheck={false}
        className="min-h-28 border-slate-200 bg-slate-50 font-mono text-[12px]"
      />
    </FormLabel>
  );
}

function MembershipStatusPill({ status }: { status: BillingMembershipPlanStatus }) {
  const tone = status === "active" ? "success" : status === "archived" ? "risk" : "muted";
  const labels: Record<BillingMembershipPlanStatus, string> = {
    draft: "草稿",
    active: "启用",
    paused: "暂停",
    archived: "归档",
  };
  return <StatusPill tone={tone}>{labels[status]}</StatusPill>;
}

function RiskTextLite({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-[12px] font-medium text-amber-700">
      {children}
      <InfoTip text="需要到套餐商品中新建会员价格，并填写当前 planKey 到 grantsPlanKey。" />
    </span>
  );
}

function membershipPlanPayload(form: FormData, mode: "create" | "update") {
  const maxSeats = stringField(form, "maxSeats");
  const billingIntervalDefault = stringField(form, "billingIntervalDefault");
  const payload: Record<string, unknown> = {
    productType: stringField(form, "productType"),
    subjectType: stringField(form, "subjectType"),
    status: stringField(form, "status"),
    rank: Number(stringField(form, "rank") || 0),
    name: stringField(form, "name"),
    description: stringField(form, "description") || undefined,
    includedComputeCredits: stringField(form, "includedComputeCredits") || "0",
    includedSeats: Number(stringField(form, "includedSeats") || 1),
    maxSeats: maxSeats ? Number(maxSeats) : null,
    seatOverageAllowed: form.get("seatOverageAllowed") === "on",
    topupDiscountBps: Number(stringField(form, "topupDiscountBps") || 0),
    billingIntervalDefault: billingIntervalDefault || undefined,
    featureFlags: jsonObjectField(form, "featureFlags"),
    limits: jsonObjectField(form, "limits"),
    marketing: jsonObjectField(form, "marketing"),
    metadata: jsonObjectField(form, "metadata"),
  };
  if (mode === "create") {
    payload.planKey = stringField(form, "planKey");
  }
  return payload;
}

function jsonObjectField(form: FormData, key: string): Record<string, unknown> {
  const raw = stringField(form, key);
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${key} 必须是 JSON object。`);
  }
  return parsed as Record<string, unknown>;
}

function stringifyJson(value: Record<string, unknown>) {
  return JSON.stringify(value, null, 2);
}

function limitText(value: unknown) {
  if (value === null) return "不限";
  return typeof value === "number" && Number.isFinite(value)
    ? formatInteger(String(value))
    : "默认";
}

function priorityText(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "默认";
}
