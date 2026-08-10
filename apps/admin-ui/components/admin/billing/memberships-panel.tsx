"use client";

import { useEffect, useMemo, useState } from "react";
import { IconAdjustments, IconEdit, IconPlus, IconRefresh } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { Textarea } from "@/components/ui/textarea";
import {
  AdminDialog,
  ColumnHeader,
  ErrorBanner,
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
  MembershipPlanBenefits,
  MembershipPlanBenefitsData,
} from "./types";
import { emptyMembershipPlans } from "./types";

type BillingSiteKey = "global" | "cn";

const DEFAULT_BENEFITS_TEMPLATE: MembershipPlanBenefits = {
  queuePriority: 10,
  imageDaily: 5,
  videoDaily: 0,
  chatDaily: 30,
  workflowDaily: 3,
  uploadMB: 100,
  chatPerMinute: 20,
  concurrentJobs: 3,
  queuedJobs: 6,
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
  const [benefitsPlan, setBenefitsPlan] = useState<BillingMembershipPlanRow | null>(null);
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
          onEditBenefits={setBenefitsPlan}
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

      <AdminDialog
        open={Boolean(benefitsPlan)}
        title="配置会员权益"
        description="权益 (benefits) 是配额与功能判定的唯一事实来源；保存后本节点立即生效，其余节点最多 20 秒内生效。"
        onClose={() => setBenefitsPlan(null)}
      >
        {benefitsPlan ? (
          <MembershipPlanBenefitsForm
            key={benefitsPlan.id}
            plan={benefitsPlan}
            onSaved={async () => {
              setBenefitsPlan(null);
              await refreshPlans();
            }}
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
  onEditBenefits,
}: {
  plans: BillingMembershipPlanRow[];
  loading: boolean;
  onEditPlan: (plan: BillingMembershipPlanRow) => void;
  onEditBenefits: (plan: BillingMembershipPlanRow) => void;
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
                图/日 {dailyText(plan.benefits?.imageDaily)} · 聊/日{" "}
                {dailyText(plan.benefits?.chatDaily)} · {priorityText(plan.benefits?.chatPerMinute)}
                /分钟
              </p>
              <p className="text-[12px] text-slate-500">
                并发 {limitText(plan.benefits?.concurrentJobs)} · 队列{" "}
                {limitText(plan.benefits?.queuedJobs)} · 优先级{" "}
                {priorityText(plan.benefits?.queuePriority)}
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
        meta: { pin: "right", cellClassName: "w-[176px]" },
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" onClick={() => onEditBenefits(row.original)}>
              <IconAdjustments className="size-4" />
              权益
            </Button>
            <Button variant="outline" size="sm" onClick={() => onEditPlan(row.original)}>
              <IconEdit className="size-4" />
              编辑
            </Button>
          </div>
        ),
      },
    ],
    [onEditPlan, onEditBenefits]
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
    benefits: stringifyJson(plan?.benefits ?? DEFAULT_BENEFITS_TEMPLATE),
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
        {mode === "create" ? (
          <JsonFormField
            name="benefits"
            label="Benefits JSON"
            defaultValue={jsonDefaults.benefits}
            help="创建时必须提交完整权益；创建后请使用列表中的「权益」编辑器修改。"
          />
        ) : null}
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
    billingIntervalDefault: billingIntervalDefault || undefined,
    marketing: jsonObjectField(form, "marketing"),
    metadata: jsonObjectField(form, "metadata"),
  };
  if (mode === "create") {
    payload.planKey = stringField(form, "planKey");
    payload.benefits = jsonObjectField(form, "benefits");
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

function stringifyJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function limitText(value: unknown) {
  if (value === null) return "不限";
  return typeof value === "number" && Number.isFinite(value)
    ? formatInteger(String(value))
    : "默认";
}

function priorityText(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "?";
}

function dailyText(value: unknown) {
  if (value === "Infinity") return "不限";
  return typeof value === "number" && Number.isFinite(value) ? formatInteger(String(value)) : "?";
}

// ─── 权益 (benefits) editor ──────────────────────────────────────────────

type CapDraft = { value: string; unlimited: boolean };

type BenefitsDraft = {
  queuePriority: string;
  imageDaily: CapDraft;
  videoDaily: CapDraft;
  chatDaily: CapDraft;
  workflowDaily: CapDraft;
  uploadMB: string;
  chatPerMinute: string;
  concurrentJobs: CapDraft;
  queuedJobs: CapDraft;
};

const DAILY_CAP_FIELDS: Array<{
  key: "imageDaily" | "videoDaily" | "chatDaily" | "workflowDaily";
  label: string;
}> = [
  { key: "imageDaily", label: "图片 / 日" },
  { key: "videoDaily", label: "视频 / 日" },
  { key: "chatDaily", label: "对话 / 日" },
  { key: "workflowDaily", label: "工作流 / 日" },
];

function capDraft(value: unknown, fallback: number): CapDraft {
  if (value === "Infinity" || value === null) {
    return { value: String(fallback), unlimited: true };
  }
  return {
    value: typeof value === "number" && Number.isFinite(value) ? String(value) : String(fallback),
    unlimited: false,
  };
}

function numberDraft(value: unknown, fallback: number): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : String(fallback);
}

function benefitsDraft(raw: Record<string, unknown>): BenefitsDraft {
  return {
    queuePriority: numberDraft(raw.queuePriority, 10),
    imageDaily: capDraft(raw.imageDaily, 5),
    videoDaily: capDraft(raw.videoDaily, 0),
    chatDaily: capDraft(raw.chatDaily, 30),
    workflowDaily: capDraft(raw.workflowDaily, 3),
    uploadMB: numberDraft(raw.uploadMB, 100),
    chatPerMinute: numberDraft(raw.chatPerMinute, 20),
    concurrentJobs: capDraft(raw.concurrentJobs, 3),
    queuedJobs: capDraft(raw.queuedJobs, 6),
  };
}

function capNumber(draft: CapDraft, label: string): number {
  const parsed = Number(draft.value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} 必须是非负整数。`);
  }
  return parsed;
}

function benefitsPayload(draft: BenefitsDraft): MembershipPlanBenefits {
  return {
    queuePriority: capNumber({ value: draft.queuePriority, unlimited: false }, "队列优先级"),
    imageDaily: draft.imageDaily.unlimited ? "Infinity" : capNumber(draft.imageDaily, "图片 / 日"),
    videoDaily: draft.videoDaily.unlimited ? "Infinity" : capNumber(draft.videoDaily, "视频 / 日"),
    chatDaily: draft.chatDaily.unlimited ? "Infinity" : capNumber(draft.chatDaily, "对话 / 日"),
    workflowDaily: draft.workflowDaily.unlimited
      ? "Infinity"
      : capNumber(draft.workflowDaily, "工作流 / 日"),
    uploadMB: capNumber({ value: draft.uploadMB, unlimited: false }, "上传 (MB)"),
    chatPerMinute: capNumber({ value: draft.chatPerMinute, unlimited: false }, "对话 / 分钟"),
    concurrentJobs: draft.concurrentJobs.unlimited
      ? null
      : capNumber(draft.concurrentJobs, "并发任务"),
    queuedJobs: draft.queuedJobs.unlimited ? null : capNumber(draft.queuedJobs, "排队任务"),
  };
}

function MembershipPlanBenefitsForm({
  plan,
  onSaved,
}: {
  plan: BillingMembershipPlanRow;
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<BenefitsDraft | null>(null);
  const [issues, setIssues] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The form is mounted per plan (key={plan.id}), so initial state is
  // always the pristine loading state here — the effect only fetches.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // Always re-fetch: another admin may have edited benefits since the
        // table snapshot was loaded.
        const data = await requestEnvelope<MembershipPlanBenefitsData>(
          `/api/admin/billing/membership-plans/${plan.id}/benefits`
        );
        if (cancelled) return;
        setDraft(benefitsDraft((data.benefits ?? {}) as Record<string, unknown>));
        setIssues(data.issues);
      } catch (err) {
        if (!cancelled) setError(toErrorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [plan.id]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      await mutateEnvelope(
        `/api/admin/billing/membership-plans/${plan.id}/benefits`,
        { benefits: benefitsPayload(draft) },
        "PUT"
      );
      await onSaved();
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (!draft) {
    return error ? (
      <ErrorBanner message={error} />
    ) : (
      <p className="py-6 text-sm text-slate-500">加载权益中…</p>
    );
  }

  function setCap(
    key:
      | "imageDaily"
      | "videoDaily"
      | "chatDaily"
      | "workflowDaily"
      | "concurrentJobs"
      | "queuedJobs",
    next: Partial<CapDraft>
  ) {
    setDraft((prev) => (prev ? { ...prev, [key]: { ...prev[key], ...next } } : prev));
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      {error ? <ErrorBanner message={error} /> : null}
      {issues?.length ? (
        <ErrorBanner message={`当前存储的权益不合法，保存将整体覆盖修复：${issues.join("；")}`} />
      ) : null}

      <p className="font-mono text-[12px] text-slate-500">
        {plan.planKey} · {plan.name}
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        <FormLabel label="队列优先级" help="BullMQ priority，数字越小越先执行。">
          <TextInput
            type="number"
            min={0}
            max={100}
            value={draft.queuePriority}
            onChange={(event) =>
              setDraft((prev) => (prev ? { ...prev, queuePriority: event.target.value } : prev))
            }
          />
        </FormLabel>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {DAILY_CAP_FIELDS.map(({ key, label }) => (
          <CapField
            key={key}
            label={label}
            draft={draft[key]}
            unlimitedLabel="不限"
            onChange={(next) => setCap(key, next)}
          />
        ))}
        <FormLabel label="上传 (MB / 日)" help="所有档位都是硬上限——上传会变成永久存储成本。">
          <TextInput
            type="number"
            min={0}
            value={draft.uploadMB}
            onChange={(event) =>
              setDraft((prev) => (prev ? { ...prev, uploadMB: event.target.value } : prev))
            }
          />
        </FormLabel>
        <FormLabel label="对话 / 分钟" help="脚本滥用防线，对所有档位生效。">
          <TextInput
            type="number"
            min={0}
            value={draft.chatPerMinute}
            onChange={(event) =>
              setDraft((prev) => (prev ? { ...prev, chatPerMinute: event.target.value } : prev))
            }
          />
        </FormLabel>
        <CapField
          label="并发任务"
          draft={draft.concurrentJobs}
          unlimitedLabel="不限 (合同管理)"
          onChange={(next) => setCap("concurrentJobs", next)}
        />
        <CapField
          label="排队任务"
          draft={draft.queuedJobs}
          unlimitedLabel="不限 (合同管理)"
          onChange={(next) => setCap("queuedJobs", next)}
        />
      </div>

      <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
        <Button type="submit" disabled={saving}>
          保存权益
        </Button>
      </div>
    </form>
  );
}

function CapField({
  label,
  draft,
  unlimitedLabel,
  onChange,
}: {
  label: string;
  draft: CapDraft;
  unlimitedLabel: string;
  onChange: (next: Partial<CapDraft>) => void;
}) {
  return (
    <FormLabel label={label}>
      <div className="flex items-center gap-2">
        <TextInput
          type="number"
          min={0}
          value={draft.value}
          disabled={draft.unlimited}
          onChange={(event) => onChange({ value: event.target.value })}
        />
        <label className="flex shrink-0 items-center gap-1.5 text-[12px] text-slate-600">
          <input
            type="checkbox"
            checked={draft.unlimited}
            onChange={(event) => onChange({ unlimited: event.target.checked })}
            className="size-3.5 rounded border-slate-300"
          />
          {unlimitedLabel}
        </label>
      </div>
    </FormLabel>
  );
}
