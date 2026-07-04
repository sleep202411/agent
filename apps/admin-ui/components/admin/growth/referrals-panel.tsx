"use client";

// 邀请奖励 (referral program) config page for the /growth sub-app.
//
// Three sections:
//   1. PROGRAM — single admin-editable config (enabled / currency / qualifyEvent
//      / holdDays / 每位邀请奖励 / 上限 / 默认返佣比例 / 账号年龄闸门 + invitee
//      benefit). Saved via PATCH.
//   2. MILESTONES — table of referral milestones sorted by rank; 新建/编辑/归档
//      via dialogs (POST / PATCH / POST :id/archive).
//   3. COMMISSION RATES — 消费返佣白名单 (per-user KOL rates overriding the
//      program default). POST upsert / DELETE remove.
//
// Money/units: *Minor fields arrive as BigInt STRINGS but the PATCH/POST bodies
// expect NUMBERS — parse for display, send Number() on submit. minor = cents.
// Rates: the wire unit is bps (万分比); the form edits percent (bps / 100).

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
import { CommissionRateForm, CommissionRatesTable, bpsPercentLabel } from "./commission-rates";
import type {
  CommissionRateRow,
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
  initialRates,
  initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialConfig: ReferralConfig | null;
  initialRates?: CommissionRateRow[];
  initialError?: string | null;
}) {
  const [config, setConfig] = useState<ReferralConfig | null>(initialConfig);
  const [editProgramOpen, setEditProgramOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingMilestone, setEditingMilestone] = useState<ReferralMilestoneRow | null>(null);
  const [rates, setRates] = useState<CommissionRateRow[]>(initialRates ?? []);
  const [rateDialog, setRateDialog] = useState<
    { mode: "create" } | { mode: "edit"; rate: CommissionRateRow } | null
  >(null);
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
      setEditProgramOpen(false);
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

  async function handleSaveRate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const data = await mutateEnvelope<CommissionRateRow[]>(
        "/api/admin/referrals/commission-rates",
        {
          userId: stringField(form, "userId"),
          commissionBps: Math.round(Number(stringField(form, "ratePercent") || 0) * 100),
          note: stringField(form, "note") || null,
        }
      );
      setRates(data);
      setRateDialog(null);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleRemoveRate(userId: string) {
    setLoading(true);
    setError(null);
    try {
      const data = await mutateEnvelope<CommissionRateRow[]>(
        `/api/admin/referrals/commission-rates/${encodeURIComponent(userId)}`,
        {},
        "DELETE"
      );
      setRates(data);
      setRateDialog(null);
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
        description="老带新邀请奖励：阶梯奖励按注册人数发放；消费返佣按被邀请人实付订单发放。"
      />

      {error ? <ErrorBanner message={error} /> : null}

      <section className="max-w-3xl rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-950">奖励配置</h2>
            <p className="mt-0.5 text-[12px] text-slate-500">
              程序基础设置。达标事件（首次购买）用于消费返佣和被邀请人福利；阶梯奖励另按注册人数计。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refreshConfig()}
              disabled={loading}
            >
              <IconRefresh className="size-4" />
              刷新
            </Button>
            <Button
              size="sm"
              onClick={() => setEditProgramOpen(true)}
              disabled={loading || !config}
            >
              <IconEdit className="size-4" />
              编辑配置
            </Button>
          </div>
        </div>
        <ProgramView config={config} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-950">阶梯奖励</h2>
            <p className="mt-0.5 text-[12px] text-slate-500">
              <b>注册人数</b>
              达到门槛即发放的阶梯奖励包（用你的码注册即算，无需消费；打开邀请页时结算）。
              {config?.giftedPointsValidityDays
                ? ` 赠送的社区/算力积分领取后 ${config.giftedPointsValidityDays} 天过期（平台策略）。`
                : ""}
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

      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-950">消费返佣</h2>
            <p className="mt-0.5 text-[12px] text-slate-500">
              被邀请人每笔实付订单，按比例给邀请人发<b>现金</b>返佣（进待提现钱包，不过期）。
              默认比例
              <b className="text-slate-700">
                {" "}
                {config ? bpsPercentLabel(config.commissionBps) : "—"}{" "}
              </b>
              适用于所有邀请人；下方白名单可为个别用户（KOL）覆写，0% = 对该用户显式关闭。
              默认比例在「编辑配置」里改。
            </p>
          </div>
          <Button size="sm" onClick={() => setRateDialog({ mode: "create" })} disabled={loading}>
            <IconPlus className="size-4" />
            新增用户
          </Button>
        </div>

        <CommissionRatesTable
          rates={rates}
          loading={loading}
          onEditRate={(rate) => setRateDialog({ mode: "edit", rate })}
        />
      </section>

      <AdminDialog
        open={editProgramOpen}
        title="编辑奖励配置"
        description="程序基础设置 + 默认返佣比例 + 被邀请人福利；保存后立即生效，只影响之后的邀请与订单。"
        onClose={() => setEditProgramOpen(false)}
      >
        {config ? (
          <ProgramForm config={config} loading={loading} onSubmit={handleSaveProgram} />
        ) : null}
      </AdminDialog>

      <AdminDialog
        open={Boolean(rateDialog)}
        title={rateDialog?.mode === "edit" ? "编辑返佣比例" : "新增返佣用户"}
        description="比例按订单实付金额计算；修改只影响之后的订单，已计的返佣保留原比例快照。"
        onClose={() => setRateDialog(null)}
      >
        {rateDialog ? (
          <CommissionRateForm
            key={rateDialog.mode === "edit" ? rateDialog.rate.userId : "create"}
            rate={rateDialog.mode === "edit" ? rateDialog.rate : undefined}
            loading={loading}
            onSubmit={handleSaveRate}
            onRemove={
              rateDialog.mode === "edit"
                ? () => void handleRemoveRate(rateDialog.rate.userId)
                : undefined
            }
          />
        ) : null}
      </AdminDialog>

      <AdminDialog
        open={createOpen}
        title="新建阶梯奖励"
        description="设置注册人数门槛与达标后发放的奖励包（可含多项）。"
        onClose={() => setCreateOpen(false)}
      >
        <MilestoneForm
          mode="create"
          loading={loading}
          giftedPointsValidityDays={config?.giftedPointsValidityDays}
          onSubmit={handleCreateMilestone}
        />
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
            giftedPointsValidityDays={config?.giftedPointsValidityDays}
            onSubmit={handleUpdateMilestone}
            onArchive={() => void handleArchiveMilestone(editingMilestone)}
          />
        ) : null}
      </AdminDialog>
    </div>
  );
}

/** Read-only display of the program config (edit happens in the dialog). */
function ProgramView({ config }: { config: ReferralConfig | null }) {
  if (!config) {
    return (
      <div className="px-4 py-6 text-[13px] text-slate-500">
        尚未配置。点右上角「编辑配置」创建。
      </div>
    );
  }
  // Read the BUNDLE, not the legacy cash mirror — a points/membership perk has
  // inviteeBenefitMinor = 0 but is still configured.
  const inviteeItems = config.inviteeBenefitItems ?? [];
  return (
    <dl className="grid gap-x-8 gap-y-3 px-4 py-4 sm:grid-cols-2">
      <ViewRow label="状态">
        {config.enabled ? (
          <StatusPill tone="success">开启</StatusPill>
        ) : (
          <StatusPill tone="muted">关闭</StatusPill>
        )}
      </ViewRow>
      <ViewRow label="达标事件">
        首次购买 <span className="text-slate-400">（固定）</span>
      </ViewRow>
      <ViewRow label="现金币种">{config.currency ?? "—"}</ViewRow>
      <ViewRow label="冻结天数">{config.holdDays} 天</ViewRow>
      <ViewRow label="默认返佣比例" hint="现金返佣，进待提现钱包，不过期">
        {bpsPercentLabel(config.commissionBps)}
      </ViewRow>
      <ViewRow label="账号年龄上限（防刷）">
        {config.refereeMaxAccountAgeHours > 0 ? `${config.refereeMaxAccountAgeHours} 小时` : "不限"}
      </ViewRow>
      <ViewRow label="阶梯赠送积分有效期" hint="仅阶梯发的社区/算力积分；返佣现金与充值积分不过期">
        {config.giftedPointsValidityDays} 天后过期
      </ViewRow>
      <ViewRow label="被邀请人福利（新人礼）">
        {inviteeItems.length > 0 ? (
          <span>
            {config.inviteeBenefitTitle ? `${config.inviteeBenefitTitle}：` : ""}
            {inviteeItems.map(itemSummary).join(" + ")}
          </span>
        ) : (
          <span className="text-slate-400">未开启</span>
        )}
      </ViewRow>
    </dl>
  );
}

function ViewRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] font-medium text-slate-400">{label}</dt>
      <dd className="text-sm text-slate-900">{children}</dd>
      {hint ? <p className="text-[11px] text-slate-400">{hint}</p> : null}
    </div>
  );
}

function ProgramForm({
  config,
  loading,
  onSubmit,
}: {
  // Rendered only with a real config (the program row always exists) — no
  // fallback defaults, the form shows the actual saved values.
  config: ReferralConfig;
  loading: boolean;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  // Invitee welcome-perk bundle (社区/算力积分, 会员, 现金; 可多项). Empty = no perk.
  const [inviteeItems, setInviteeItems] = useState<RewardItem[]>(config.inviteeBenefitItems ?? []);
  function patchInvitee(index: number, patch: Partial<RewardItem>) {
    setInviteeItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }
  function addInvitee() {
    setInviteeItems((prev) => [...prev, { kind: "points_community", amountMinor: "0", days: 0 }]);
  }
  function removeInvitee(index: number) {
    setInviteeItems((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <form className="grid gap-4" onSubmit={onSubmit}>
      {/* 达标事件是固定值（注册即达标无服务端触发点，已下线）—— 展示为说明，不是可编辑输入框。 */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-[12px] leading-5 text-slate-600">
        <span className="font-semibold text-slate-700">达标事件：首次购买</span>
        （固定）—— 用于<b>消费返佣</b>和<b>被邀请人福利</b>：被邀请人首次付费后才生效。
        <b>阶梯奖励</b>另按注册人数计，无需消费。
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <FormLabel label="状态" help="关闭后不再统计邀请，也不发放邀请奖励。">
          <Select name="enabled" defaultValue={config.enabled ? "on" : "off"}>
            <option value="off">关闭</option>
            <option value="on">开启</option>
          </Select>
        </FormLabel>
        <FormLabel label="现金币种" help="3 位币种代码，例如 USD / CNY；仅现金奖励使用。">
          <TextInput name="currency" defaultValue={config.currency ?? ""} maxLength={3} />
        </FormLabel>
        <FormLabel label="冻结天数" help="奖励发放后冻结的天数，用于防作弊回收期。">
          <TextInput name="holdDays" type="number" min={0} defaultValue={config.holdDays} />
        </FormLabel>
        <FormLabel
          label="账号年龄上限(小时)"
          help="防刷：仅当被邀请人账号年龄小于该值时才建立邀请归因；0 = 不限制。"
        >
          <TextInput
            name="refereeMaxAccountAgeHours"
            type="number"
            min={0}
            defaultValue={config.refereeMaxAccountAgeHours}
          />
        </FormLabel>
        <FormLabel
          label="默认返佣比例(%)"
          help="被邀请人每笔实付订单按此比例给邀请人现金返佣（进待提现钱包，不过期）；0 = 关闭（仅白名单用户返佣）。"
        >
          <TextInput
            name="commissionRatePercent"
            type="number"
            min={0}
            max={100}
            step={0.01}
            defaultValue={config.commissionBps / 100}
          />
        </FormLabel>
        <FormLabel
          label="每位邀请奖励(分)"
          help="旧版：每位有效邀请给邀请人的固定现金，单位分（积分 ≡ 美分）。v3 用阶梯+返佣，通常留 0。"
        >
          <TextInput
            name="rewardPerReferralMinor"
            type="number"
            min={0}
            defaultValue={config.rewardPerReferralMinor}
          />
        </FormLabel>
        <FormLabel label="最多奖励邀请数" help="旧版每位邀请奖励的上限；0 = 不限。返佣不受此限制。">
          <TextInput
            name="maxRewardedReferees"
            type="number"
            min={0}
            defaultValue={config.maxRewardedReferees}
          />
        </FormLabel>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[12px] font-semibold text-slate-500">被邀请人福利（新人礼）</p>
            <p className="mt-0.5 text-[11px] text-slate-400">
              发给被邀请人自己的新人礼；可发社区/算力积分、社区/算力会员或现金，可多项组合。不加任何奖励
              = 不发放。
              {config.giftedPointsValidityDays
                ? ` 赠送的积分领取后 ${config.giftedPointsValidityDays} 天过期。`
                : ""}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addInvitee}>
            <IconPlus className="size-4" />
            添加奖励
          </Button>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <FormLabel label="福利标题">
            <TextInput name="inviteeBenefitTitle" defaultValue={config.inviteeBenefitTitle ?? ""} />
          </FormLabel>
          <FormLabel label="福利说明">
            <TextInput
              name="inviteeBenefitDetail"
              defaultValue={config.inviteeBenefitDetail ?? ""}
            />
          </FormLabel>
        </div>
        <div className="mt-3 space-y-2">
          {inviteeItems.length === 0 ? (
            <p className="text-[11px] text-slate-400">未添加奖励 —— 当前不发放新人礼。</p>
          ) : (
            inviteeItems.map((item, index) => (
              <RewardItemRow
                key={index}
                item={item}
                canRemove
                onChange={(patch) => patchInvitee(index, patch)}
                onRemove={() => removeInvitee(index)}
              />
            ))
          )}
        </div>
        {/* Serialized bundle → programPayload reads it from FormData. */}
        <input
          type="hidden"
          name="inviteeBenefitItems"
          value={JSON.stringify(inviteeItems)}
          readOnly
        />
      </div>

      <div className="flex items-center gap-3 border-t border-slate-200 pt-4">
        <Button type="submit" disabled={loading}>
          <IconDeviceFloppy className="size-3.5" />
          保存配置
        </Button>
        <span className="text-[12px] text-slate-400">配置键 {config.key}</span>
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
        header: "注册门槛",
        cell: ({ row }) => (
          <span className="text-sm text-slate-700">{row.original.inviteeThreshold} 人注册</span>
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
  giftedPointsValidityDays,
  onSubmit,
  onArchive,
}: {
  mode: "create" | "update";
  milestone?: ReferralMilestoneRow;
  loading: boolean;
  giftedPointsValidityDays?: number;
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
        <FormLabel label="注册门槛" help="用你的码注册的人数达到该值后发放本阶梯奖励（无需消费）。">
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
              {giftedPointsValidityDays
                ? ` 赠送的社区/算力积分领取后 ${giftedPointsValidityDays} 天过期。`
                : ""}
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
  return {
    enabled: form.get("enabled") === "on",
    currency: currency || undefined,
    holdDays: Number(stringField(form, "holdDays") || 0),
    rewardPerReferralMinor: Number(stringField(form, "rewardPerReferralMinor") || 0),
    maxRewardedReferees: Number(stringField(form, "maxRewardedReferees") || 0),
    commissionBps: Math.round(Number(stringField(form, "commissionRatePercent") || 0) * 100),
    refereeMaxAccountAgeHours: Number(stringField(form, "refereeMaxAccountAgeHours") || 0),
    inviteeBenefitTitle: stringField(form, "inviteeBenefitTitle") || null,
    inviteeBenefitDetail: stringField(form, "inviteeBenefitDetail") || null,
    // Invitee welcome-perk bundle (社区/算力积分, 会员, 现金). Empty = no perk.
    inviteeBenefitItems: parseRewardItems(form, "inviteeBenefitItems"),
  };
}

function milestonePayload(form: FormData): Record<string, unknown> {
  return {
    inviteeThreshold: Number(stringField(form, "inviteeThreshold") || 1),
    rewardItems: parseRewardItems(form, "rewardItems"),
    title: stringField(form, "title"),
    detail: stringField(form, "detail") || undefined,
    rank: Number(stringField(form, "rank") || 0),
  };
}

function parseRewardItems(
  form: FormData,
  field: string
): { kind: RewardItemKind; amountMinor: number; days: number }[] {
  const raw = stringField(form, field);
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
