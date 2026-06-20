"use client";

// 推荐有礼 (referral) page for the /billing sub-app. Admin sets a single config
// (enable + per-side reward) and reviews referral relationships. Both sides are
// rewarded once the invitee makes their first paid order (qualifies); rewards are
// snapshotted at bind time and credited to each user's personal 算力积分 wallet.

import { useMemo, useState } from "react";
import { IconDeviceFloppy, IconRefresh, IconUsersGroup } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";
import {
  ErrorBanner,
  FormLabel,
  Metric,
  PageHeader,
  Select,
  TextInput,
  formatDate,
  mutateEnvelope,
  requestEnvelope,
  toErrorMessage,
} from "./shared";
import type {
  AdminBillingReferralsData,
  ReferralConfigData,
  ReferralRow,
  ReferralStatus,
} from "./types";

const emptyReferrals: AdminBillingReferralsData = {
  items: [],
  total: 0,
  stats: { rewardedCount: 0, creditsPaid: 0 },
};

const STATUS_LABEL: Record<ReferralStatus, string> = {
  pending: "待达成",
  rewarded: "已发放",
  void: "已作废",
};

const STATUS_CLASS: Record<ReferralStatus, string> = {
  pending: "bg-amber-50 text-amber-700",
  rewarded: "bg-emerald-50 text-emerald-700",
  void: "bg-slate-100 text-slate-500",
};

export function BillingReferralPanel({
  siteLabel,
  databaseLabel,
  initialConfig,
  initialReferrals,
  initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialConfig: ReferralConfigData | null;
  initialReferrals: AdminBillingReferralsData | null;
  initialError?: string | null;
}) {
  const [enabled, setEnabled] = useState(initialConfig?.enabled ? "on" : "off");
  const [referrerReward, setReferrerReward] = useState(
    String(initialConfig?.referrerReward ?? 500)
  );
  const [refereeReward, setRefereeReward] = useState(String(initialConfig?.refereeReward ?? 500));
  const [updatedAt, setUpdatedAt] = useState(initialConfig?.updatedAt ?? null);
  const [referrals, setReferrals] = useState(initialReferrals ?? emptyReferrals);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [saved, setSaved] = useState(false);

  const referrerN = Number(referrerReward);
  const refereeN = Number(refereeReward);
  const valid =
    Number.isInteger(referrerN) && referrerN >= 0 && Number.isInteger(refereeN) && refereeN >= 0;

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const qs = status ? `?status=${status}` : "";
      setReferrals(
        await requestEnvelope<AdminBillingReferralsData>(`/api/admin/billing/referrals${qs}`)
      );
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid) {
      setError("奖励积分必须是 0 或正整数。");
      return;
    }
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      const data = await mutateEnvelope<ReferralConfigData>(
        "/api/admin/billing/referral/config",
        {
          enabled: enabled === "on",
          referrerReward: referrerN,
          refereeReward: refereeN,
        },
        "PATCH"
      );
      setUpdatedAt(data.updatedAt);
      setSaved(true);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const columns = useMemo<ColumnDef<ReferralRow, unknown>[]>(
    () => [
      {
        accessorKey: "referrerUserId",
        header: "推荐人",
        cell: ({ row }) => (
          <p className="font-mono text-[12px] text-slate-700">{row.original.referrerUserId}</p>
        ),
      },
      {
        accessorKey: "refereeUserId",
        header: "被推荐人",
        cell: ({ row }) => (
          <p className="font-mono text-[12px] text-slate-700">{row.original.refereeUserId}</p>
        ),
      },
      {
        accessorKey: "code",
        header: "推荐码",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[12px] text-slate-600">
            {row.original.code}
          </span>
        ),
      },
      {
        id: "reward",
        header: "奖励（推荐 / 被荐）",
        enableSorting: false,
        cell: ({ row }) => (
          <p className="text-[12px] text-slate-700">
            {row.original.referrerReward.toLocaleString()} /{" "}
            {row.original.refereeReward.toLocaleString()}
          </p>
        ),
      },
      {
        accessorKey: "status",
        header: "状态",
        cell: ({ row }) => (
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-medium",
              STATUS_CLASS[row.original.status]
            )}
          >
            {STATUS_LABEL[row.original.status]}
          </span>
        ),
      },
      {
        id: "time",
        header: "邀请 / 达成",
        enableSorting: false,
        cell: ({ row }) => (
          <p className="text-[12px] text-slate-500">
            {formatDate(row.original.createdAt)}
            {row.original.rewardedAt ? ` → ${formatDate(row.original.rewardedAt)}` : ""}
          </p>
        ),
      },
    ],
    []
  );

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={
          <>
            {siteLabel} · {databaseLabel}
          </>
        }
        title="推荐有礼"
        description="老用户邀请新用户，新用户首次付费后双方各得算力积分。奖励在邀请绑定时锁定，达成后自动发放。"
      />
      {error ? <ErrorBanner message={error} /> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="grid grid-cols-3 gap-3 border-b border-slate-200 p-4">
            <Metric label="邀请总数" value={referrals.total.toLocaleString()} />
            <Metric label="已达成" value={referrals.stats.rewardedCount.toLocaleString()} />
            <Metric label="累计发放积分" value={referrals.stats.creditsPaid.toLocaleString()} />
          </div>
          <div className="border-b border-slate-200 p-4">
            <div className="grid gap-2 lg:grid-cols-[150px_auto]">
              <Select value={status} onChange={setStatus}>
                <option value="">全部状态</option>
                <option value="pending">待达成</option>
                <option value="rewarded">已发放</option>
                <option value="void">已作废</option>
              </Select>
              <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
                <IconRefresh className={cn("size-3.5", loading && "animate-spin")} />
                应用
              </Button>
            </div>
          </div>
          <DataTable
            columns={columns}
            data={referrals.items}
            loading={loading}
            minWidth={820}
            pageSize={20}
            emptyLabel="暂无推荐记录"
            className="rounded-none border-0"
          />
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">推荐配置</h3>
              <p className="mt-1 text-[12px] text-slate-500">
                到账双方个人空间算力积分钱包；新用户须完成首次付费方可达成。
              </p>
            </div>
            <IconUsersGroup className="size-4 text-slate-400" />
          </div>
          <form onSubmit={save} className="mt-4 grid gap-4">
            <FormLabel label="状态" help="关闭后用户无法绑定推荐码。">
              <Select value={enabled} onChange={setEnabled}>
                <option value="off">关闭</option>
                <option value="on">开启</option>
              </Select>
            </FormLabel>
            <FormLabel
              label="推荐人奖励（算力积分）"
              help="被推荐人首次付费后，发放给推荐人的积分。"
            >
              <TextInput
                value={referrerReward}
                onChange={(event) => setReferrerReward(event.target.value)}
                inputMode="numeric"
                placeholder="500"
              />
            </FormLabel>
            <FormLabel
              label="被推荐人奖励（算力积分）"
              help="被推荐人首次付费后，发放给本人的积分。"
            >
              <TextInput
                value={refereeReward}
                onChange={(event) => setRefereeReward(event.target.value)}
                inputMode="numeric"
                placeholder="500"
              />
            </FormLabel>
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={loading || !valid}>
                <IconDeviceFloppy className="size-3.5" />
                保存
              </Button>
              {saved ? <span className="text-[12px] text-emerald-600">已保存</span> : null}
              {updatedAt ? (
                <span className="text-[12px] text-slate-400">更新于 {formatDate(updatedAt)}</span>
              ) : null}
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
