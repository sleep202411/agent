"use client";

// 邀请奖励 (referral program) config page for the /growth sub-app.
//
// Two sections:
//   1. PROGRAM — single admin-editable config (enabled / currency / qualifyEvent
//      / holdDays / 每位邀请奖励 / 上限 + invitee benefit). Saved via PATCH.
//   2. MILESTONES — table of referral milestones sorted by rank; 新建/编辑/归档
//      via dialogs (POST / PATCH / POST :id/archive).
//
// Money/units: *Minor fields arrive as BigInt STRINGS but the PATCH/POST bodies
// expect NUMBERS — parse for display, send Number() on submit. minor = cents.

import { useMemo, useState } from "react";
import {
  IconDeviceFloppy,
  IconEdit,
  IconPlus,
  IconRefresh,
  IconArchive,
  IconTrash,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { Textarea } from "@/components/ui/textarea";
import {
  AdminDialog,
  ErrorBanner,
  FormLabel,
  PageHeader,
  Select,
  StatusPill,
  TextInput,
  mutateEnvelope,
  requestEnvelope,
  stringField,
  toErrorMessage,
} from "../billing/shared";
import type {
  PayoutType,
  ReferralConfig,
  ReferralMilestoneRow,
  RewardItem,
  RewardItemKind,
} from "./referrals-types";

const PAYOUT_TYPE_LABELS: Record<PayoutType, string> = {
  cash: "现金",
  points_compute: "算力积分",
  points_community: "社区积分",
  membership_compute: "studio 会员",
  membership_community: "社区会员",
  membership_both: "studio + 社区会员",
};

// A reward bundle item is one of the 5 single kinds (membership_both = two items).
const REWARD_ITEM_KINDS: RewardItemKind[] = [
  "membership_compute",
  "membership_community",
  "points_compute",
  "points_community",
  "cash",
];

/** Membership payouts use days (payoutDays/days) instead of an amount. */
function isMembershipPayout(payoutType: PayoutType): boolean {
  return (
    payoutType === "membership_compute" ||
    payoutType === "membership_community" ||
    payoutType === "membership_both"
  );
}

function payoutTypeLabel(value: PayoutType): string {
  return PAYOUT_TYPE_LABELS[value] ?? value;
}

/** Amount field label: 现金按「分」、积分按「积分」。 */
function rewardMinorLabel(payoutType: PayoutType): string {
  return payoutType === "cash" ? "现金(分)" : "积分";
}

/** One-line summary of a tier's reward bundle for the table. */
function bundleSummary(milestone: ReferralMilestoneRow): string {
  const items = milestone.rewardItems?.length ? milestone.rewardItems : null;
  if (items) return items.map(itemSummary).join(" + ");
  return isMembershipPayout(milestone.payoutType)
    ? `${payoutTypeLabel(milestone.payoutType)} ${milestone.payoutDays}天`
    : `${payoutTypeLabel(milestone.payoutType)} ${milestone.rewardMinor}`;
}
function itemSummary(it: RewardItem): string {
  return isMembershipPayout(it.kind)
    ? `${payoutTypeLabel(it.kind)} ${it.days}天`
    : `${payoutTypeLabel(it.kind)} ${it.amountMinor}`;
}

export function ReferralsPanel({
  siteLabel,
  databaseLabel,
  initialConfig,
  initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialConfig: ReferralConfig | null;
  initialError?: string | null;
}) {
  const [config, setConfig] = useState<ReferralConfig | null>(initialConfig);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingMilestone, setEditingMilestone] = useState<ReferralMilestoneRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  async function refreshConfig() {
    setLoading(true);
    setError(null);
    try {
      setConfig(await requestEnvelope<ReferralConfig | null>("/api/admin/referrals/program"));
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveProgram(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const data = await mutateEnvelope<ReferralConfig>(
        "/api/admin/referrals/program",
        programPayload(new FormData(event.currentTarget)),
        "PATCH"
      );
      setConfig(data);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateMilestone(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const formElement = event.currentTarget;
    try {
      await mutateEnvelope(
        "/api/admin/referrals/milestones",
        milestonePayload(new FormData(formElement))
      );
      formElement.reset();
      setCreateOpen(false);
      await refreshConfig();
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdateMilestone(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingMilestone) return;
    setLoading(true);
    setError(null);
    try {
      await mutateEnvelope(
        `/api/admin/referrals/milestones/${editingMilestone.id}`,
        milestonePayload(new FormData(event.currentTarget)),
        "PATCH"
      );
      setEditingMilestone(null);
      await refreshConfig();
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleArchiveMilestone(milestone: ReferralMilestoneRow) {
    setLoading(true);
    setError(null);
    try {
      await mutateEnvelope(`/api/admin/referrals/milestones/${milestone.id}/archive`, {});
      setEditingMilestone(null);
      await refreshConfig();
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const milestones = useMemo(
    () => [...(config?.milestones ?? [])].sort((left, right) => left.rank - right.rank),
    [config]
  );

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={
          <>
            {siteLabel} · {databaseLabel}
          </>
        }
        title="邀请奖励"
        description="老带新邀请奖励：被邀请人达标后给邀请人发放奖励；可配置邀请人数阶梯奖励包。"
      />

      {error ? <ErrorBanner message={error} /> : null}

      <section className="max-w-3xl rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-950">奖励配置</h2>
            <p className="mt-0.5 text-[12px] text-slate-500">
              金额单位为分（积分 ≡ 美分）；达标事件决定何时计入有效邀请。
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refreshConfig()}
            disabled={loading}
          >
            <IconRefresh className="size-4" />
            刷新
          </Button>
        </div>
        <div className="px-4 py-4">
          <ProgramForm config={config} loading={loading} onSubmit={handleSaveProgram} />
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-950">阶梯奖励</h2>
            <p className="mt-0.5 text-[12px] text-slate-500">
              邀请人数达到门槛后额外发放的阶梯奖励（每档可含多项），按 rank 排序展示。
            </p>
          </div>
          <Button size="sm" onClick={() => setCreateOpen(true)} disabled={loading}>
            <IconPlus className="size-4" />
            新建阶梯
          </Button>
        </div>

        <MilestonesTable
          milestones={milestones}
          loading={loading}
          onEditMilestone={setEditingMilestone}
        />
      </section>

      <AdminDialog
        open={createOpen}
        title="新建阶梯奖励"
        description="设置邀请人数门槛与达标后发放的奖励包（可含多项）。"
        onClose={() => setCreateOpen(false)}
      >
        <MilestoneForm mode="create" loading={loading} onSubmit={handleCreateMilestone} />
      </AdminDialog>

      <AdminDialog
        open={Boolean(editingMilestone)}
        title="编辑阶梯奖励"
        description="编辑只影响之后达标的奖励发放；历史已发放奖励保留原始审计记录。"
        onClose={() => setEditingMilestone(null)}
      >
        {editingMilestone ? (
          <MilestoneForm
            mode="update"
            loading={loading}
            milestone={editingMilestone}
            onSubmit={handleUpdateMilestone}
            onArchive={() => void handleArchiveMilestone(editingMilestone)}
          />
        ) : null}
      </AdminDialog>
    </div>
  );
}

function ProgramForm({
  config,
  loading,
  onSubmit,
}: {
  config: ReferralConfig | null;
  loading: boolean;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className="grid gap-4" onSubmit={onSubmit}>
      <div className="grid gap-3 md:grid-cols-2">
        <FormLabel label="状态" help="关闭后不再统计邀请，也不发放邀请奖励。">
          <Select name="enabled" defaultValue={config?.enabled ? "on" : "off"}>
            <option value="off">关闭</option>
            <option value="on">开启</option>
          </Select>
        </FormLabel>
        <FormLabel label="现金币种" help="3 位币种代码，例如 USD / CNY；仅现金奖励使用。">
          <TextInput
            name="currency"
            placeholder="USD"
            defaultValue={config?.currency ?? ""}
            maxLength={3}
          />
        </FormLabel>
        <FormLabel label="达标事件" help="决定何时把一次邀请计为有效邀请。">
          <Select name="qualifyEvent" defaultValue={config?.qualifyEvent ?? "signup"}>
            <option value="signup">注册</option>
            <option value="first_purchase">首次购买</option>
          </Select>
        </FormLabel>
        <FormLabel label="冻结天数" help="奖励发放后冻结的天数，用于防作弊回收期。">
          <TextInput name="holdDays" type="number" min={0} defaultValue={config?.holdDays ?? 0} />
        </FormLabel>
        <FormLabel
          label="每位邀请奖励(分)"
          help="每位有效邀请发放给邀请人的金额，单位分（积分 ≡ 美分）。"
        >
          <TextInput
            name="rewardPerReferralMinor"
            type="number"
            min={0}
            defaultValue={config?.rewardPerReferralMinor ?? "0"}
          />
        </FormLabel>
        <FormLabel label="最多奖励邀请数" help="每位邀请人最多被奖励的有效邀请人数上限。">
          <TextInput
            name="maxRewardedReferees"
            type="number"
            min={0}
            defaultValue={config?.maxRewardedReferees ?? 0}
          />
        </FormLabel>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
        <p className="text-[12px] font-semibold text-slate-500">被邀请人福利</p>
        <p className="mt-0.5 text-[11px] text-slate-400">
          展示给被邀请人的新人福利；留空表示不发放。
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <FormLabel label="福利标题">
            <TextInput
              name="inviteeBenefitTitle"
              placeholder="新人专享福利"
              defaultValue={config?.inviteeBenefitTitle ?? ""}
            />
          </FormLabel>
          <FormLabel label="福利金额(分)" help="发放给被邀请人的金额，单位分。">
            <TextInput
              name="inviteeBenefitMinor"
              type="number"
              min={0}
              defaultValue={config?.inviteeBenefitMinor ?? "0"}
            />
          </FormLabel>
          <FormLabel label="福利有效天数" help="被邀请人福利的有效期天数；留空表示长期有效。">
            <TextInput
              name="inviteeBenefitExpiresInDays"
              type="number"
              min={0}
              placeholder="留空表示长期有效"
              defaultValue={config?.inviteeBenefitExpiresInDays ?? ""}
            />
          </FormLabel>
          <FormLabel label="福利说明">
            <TextInput
              name="inviteeBenefitDetail"
              placeholder="例如：注册即得算力积分"
              defaultValue={config?.inviteeBenefitDetail ?? ""}
            />
          </FormLabel>
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-slate-200 pt-4">
        <Button type="submit" disabled={loading}>
          <IconDeviceFloppy className="size-3.5" />
          保存配置
        </Button>
        {config ? (
          <span className="text-[12px] text-slate-400">配置键 {config.key}</span>
        ) : (
          <span className="text-[12px] text-slate-400">尚未配置，保存后创建。</span>
        )}
      </div>
    </form>
  );
}

function MilestonesTable({
  milestones,
  loading,
  onEditMilestone,
}: {
  milestones: ReferralMilestoneRow[];
  loading: boolean;
  onEditMilestone: (milestone: ReferralMilestoneRow) => void;
}) {
  const columns = useMemo<ColumnDef<ReferralMilestoneRow, unknown>[]>(
    () => [
      {
        accessorKey: "rank",
        header: "Rank",
        cell: ({ row }) => <span className="font-mono text-sm">{row.original.rank}</span>,
      },
      {
        accessorKey: "title",
        header: "阶梯",
        enableSorting: false,
        cell: ({ row }) => {
          const milestone = row.original;
          return (
            <>
              <p className="text-sm font-semibold text-slate-950">{milestone.title}</p>
              {milestone.detail ? (
                <p className="mt-0.5 line-clamp-2 max-w-md text-[12px] leading-5 text-slate-500">
                  {milestone.detail}
                </p>
              ) : null}
            </>
          );
        },
      },
      {
        accessorKey: "inviteeThreshold",
        header: "邀请门槛",
        cell: ({ row }) => (
          <span className="text-sm text-slate-700">{row.original.inviteeThreshold} 人</span>
        ),
      },
      {
        id: "payout",
        header: "奖励包",
        enableSorting: false,
        cell: ({ row }) => (
          <p className="max-w-md text-[13px] leading-5 text-slate-700">
            {bundleSummary(row.original)}
          </p>
        ),
      },
      {
        accessorKey: "archivedAt",
        header: "状态",
        cell: ({ row }) =>
          row.original.archivedAt ? (
            <StatusPill tone="risk">已归档</StatusPill>
          ) : (
            <StatusPill tone="success">启用</StatusPill>
          ),
      },
      {
        id: "actions",
        header: "操作",
        enableSorting: false,
        meta: { pin: "right", cellClassName: "w-[96px]" },
        cell: ({ row }) => (
          <Button variant="outline" size="sm" onClick={() => onEditMilestone(row.original)}>
            <IconEdit className="size-4" />
            编辑
          </Button>
        ),
      },
    ],
    [onEditMilestone]
  );

  return (
    <DataTable
      columns={columns}
      data={milestones}
      loading={loading}
      minWidth={900}
      emptyLabel="暂无阶梯奖励"
    />
  );
}

function MilestoneForm({
  mode,
  milestone,
  loading,
  onSubmit,
  onArchive,
}: {
  mode: "create" | "update";
  milestone?: ReferralMilestoneRow;
  loading: boolean;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onArchive?: () => void;
}) {
  const [items, setItems] = useState<RewardItem[]>(
    milestone?.rewardItems?.length
      ? milestone.rewardItems
      : [
          {
            kind: (milestone?.payoutType && milestone.payoutType !== "membership_both"
              ? milestone.payoutType
              : "membership_compute") as RewardItemKind,
            amountMinor: milestone?.rewardMinor ?? "0",
            days: milestone?.payoutDays ?? 7,
          },
        ]
  );

  function patchItem(index: number, patch: Partial<RewardItem>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }
  function addItem() {
    setItems((prev) => [...prev, { kind: "points_compute", amountMinor: "0", days: 0 }]);
  }
  function removeItem(index: number) {
    setItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  return (
    <form className="space-y-5" onSubmit={onSubmit}>
      <div className="grid gap-3 md:grid-cols-2">
        <FormLabel label="名称">
          <TextInput name="title" defaultValue={milestone?.title ?? ""} required />
        </FormLabel>
        <FormLabel label="Rank" help="排序值，越小越靠前。">
          <TextInput name="rank" type="number" min={0} defaultValue={milestone?.rank ?? 0} />
        </FormLabel>
        <FormLabel label="邀请门槛" help="邀请人数达到该值后发放本阶梯奖励。">
          <TextInput
            name="inviteeThreshold"
            type="number"
            min={1}
            defaultValue={milestone?.inviteeThreshold ?? 1}
            required
          />
        </FormLabel>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[12px] font-semibold text-slate-500">奖励包</p>
            <p className="mt-0.5 text-[11px] text-slate-400">
              达标后一次性发放以下全部奖励；可添加多项（如 studio 会员 + 社区积分）。
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addItem}>
            <IconPlus className="size-4" />
            添加奖励
          </Button>
        </div>
        <div className="mt-3 space-y-2">
          {items.map((item, index) => (
            <RewardItemRow
              key={index}
              item={item}
              canRemove={items.length > 1}
              onChange={(patch) => patchItem(index, patch)}
              onRemove={() => removeItem(index)}
            />
          ))}
        </div>
      </div>

      <FormLabel label="说明">
        <Textarea
          name="detail"
          defaultValue={milestone?.detail ?? ""}
          className="min-h-20 border-slate-200 bg-white text-sm"
        />
      </FormLabel>

      {/* Serialized bundle → milestonePayload reads it from FormData. The item
          inputs are controlled (no `name`) so the Select hidden-inputs don't
          collide on duplicate names. */}
      <input type="hidden" name="rewardItems" value={JSON.stringify(items)} readOnly />

      <div className="flex items-center justify-between gap-2 border-t border-slate-200 pt-4">
        {mode === "update" && onArchive && !milestone?.archivedAt ? (
          <Button type="button" variant="outline" disabled={loading} onClick={onArchive}>
            <IconArchive className="size-4" />
            归档
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={loading}>
          {mode === "create" ? "创建阶梯奖励" : "保存修改"}
        </Button>
      </div>
    </form>
  );
}

function RewardItemRow({
  item,
  canRemove,
  onChange,
  onRemove,
}: {
  item: RewardItem;
  canRemove: boolean;
  onChange: (patch: Partial<RewardItem>) => void;
  onRemove: () => void;
}) {
  const membership = isMembershipPayout(item.kind);
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-2">
      <label className="grid min-w-[150px] flex-1 gap-1">
        <span className="text-[11px] text-slate-400">类型</span>
        <Select value={item.kind} onChange={(value) => onChange({ kind: value as RewardItemKind })}>
          {REWARD_ITEM_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {payoutTypeLabel(kind)}
            </option>
          ))}
        </Select>
      </label>
      <label className="grid min-w-[120px] flex-1 gap-1">
        <span className="text-[11px] text-slate-400">
          {membership ? "会员天数" : rewardMinorLabel(item.kind)}
        </span>
        {membership ? (
          <TextInput
            type="number"
            min={0}
            value={String(item.days)}
            onChange={(event) => onChange({ days: Number(event.target.value || 0) })}
          />
        ) : (
          <TextInput
            type="number"
            min={0}
            value={item.amountMinor}
            onChange={(event) => onChange({ amountMinor: event.target.value })}
          />
        )}
      </label>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!canRemove}
        onClick={onRemove}
        title="移除该奖励"
        aria-label="移除该奖励"
      >
        <IconTrash className="size-4" />
      </Button>
    </div>
  );
}

function programPayload(form: FormData): Record<string, unknown> {
  const currency = stringField(form, "currency");
  const expiresInDays = stringField(form, "inviteeBenefitExpiresInDays");
  return {
    enabled: form.get("enabled") === "on",
    currency: currency || undefined,
    qualifyEvent: stringField(form, "qualifyEvent"),
    holdDays: Number(stringField(form, "holdDays") || 0),
    rewardPerReferralMinor: Number(stringField(form, "rewardPerReferralMinor") || 0),
    maxRewardedReferees: Number(stringField(form, "maxRewardedReferees") || 0),
    inviteeBenefitTitle: stringField(form, "inviteeBenefitTitle") || null,
    inviteeBenefitDetail: stringField(form, "inviteeBenefitDetail") || null,
    inviteeBenefitMinor: Number(stringField(form, "inviteeBenefitMinor") || 0),
    inviteeBenefitExpiresInDays: expiresInDays ? Number(expiresInDays) : null,
  };
}

function milestonePayload(form: FormData): Record<string, unknown> {
  return {
    inviteeThreshold: Number(stringField(form, "inviteeThreshold") || 1),
    rewardItems: parseRewardItems(form),
    title: stringField(form, "title"),
    detail: stringField(form, "detail") || undefined,
    rank: Number(stringField(form, "rank") || 0),
  };
}

function parseRewardItems(
  form: FormData
): { kind: RewardItemKind; amountMinor: number; days: number }[] {
  const raw = stringField(form, "rewardItems");
  if (!raw) return [];
  let parsed: RewardItem[];
  try {
    parsed = JSON.parse(raw) as RewardItem[];
  } catch {
    return [];
  }
  return parsed.map((it) => ({
    kind: it.kind,
    amountMinor: isMembershipPayout(it.kind) ? 0 : Number(it.amountMinor || 0),
    days: isMembershipPayout(it.kind) ? Number(it.days || 0) : 0,
  }));
}
