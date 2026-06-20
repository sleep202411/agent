"use client";

// 免费活动 (claimable free-credits campaign) page for the /billing sub-app. A
// campaign lets any eligible user claim free 算力积分 once during its window —
// distinct from 兑换券 (a single code) and 促销优惠 (an order discount).

import { useMemo, useState } from "react";
import { IconConfetti, IconPlus, IconRefresh, IconSearch } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { cn } from "@/lib/utils";
import {
  ErrorBanner,
  FormLabel,
  PageHeader,
  Select,
  TextInput,
  formatDate,
  mutateEnvelope,
  requestEnvelope,
  stringField,
  toErrorMessage,
} from "./shared";
import type { AdminBillingCampaignsData, CreditCampaignRow, CreditCampaignStatus } from "./types";

const emptyCampaigns: AdminBillingCampaignsData = { items: [] };

const STATUS_LABEL: Record<CreditCampaignStatus, string> = {
  draft: "草稿",
  active: "进行中",
  paused: "暂停",
  ended: "已结束",
};

const STATUS_CLASS: Record<CreditCampaignStatus, string> = {
  draft: "bg-slate-100 text-slate-600",
  active: "bg-emerald-50 text-emerald-700",
  paused: "bg-amber-50 text-amber-700",
  ended: "bg-slate-100 text-slate-500",
};

export function BillingCampaignsPanel({
  siteLabel,
  databaseLabel,
  initialCampaigns,
  initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialCampaigns: AdminBillingCampaignsData | null;
  initialError?: string | null;
}) {
  const [campaigns, setCampaigns] = useState(initialCampaigns ?? emptyCampaigns);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      const qs = params.toString();
      setCampaigns(
        await requestEnvelope<AdminBillingCampaignsData>(
          `/api/admin/billing/credit-campaigns${qs ? `?${qs}` : ""}`
        )
      );
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const formEl = event.currentTarget;
    const form = new FormData(formEl);
    const maxClaims = stringField(form, "maxClaims");
    const startsAt = stringField(form, "startsAt");
    const endsAt = stringField(form, "endsAt");
    try {
      await mutateEnvelope("/api/admin/billing/credit-campaigns", {
        name: stringField(form, "name"),
        description: stringField(form, "description") || undefined,
        computeCreditAmount: Number(stringField(form, "computeCreditAmount")),
        status: stringField(form, "status"),
        maxClaims: maxClaims ? Number(maxClaims) : undefined,
        startsAt: startsAt || undefined,
        endsAt: endsAt || undefined,
        note: stringField(form, "note") || undefined,
      });
      formEl.reset();
      await refresh();
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleStatus(campaignId: string, next: CreditCampaignStatus) {
    setLoading(true);
    setError(null);
    try {
      await mutateEnvelope(
        `/api/admin/billing/credit-campaigns/${campaignId}`,
        { status: next },
        "PATCH"
      );
      await refresh();
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const visible = useMemo(
    () =>
      query.trim()
        ? campaigns.items.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()))
        : campaigns.items,
    [campaigns.items, query]
  );

  const columns = useMemo<ColumnDef<CreditCampaignRow, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "活动",
        cell: ({ row }) => (
          <>
            <p className="text-sm font-medium text-slate-950">{row.original.name}</p>
            {row.original.note ? (
              <p className="mt-0.5 text-[12px] text-slate-500">{row.original.note}</p>
            ) : null}
          </>
        ),
      },
      {
        id: "value",
        header: "面额",
        enableSorting: false,
        cell: ({ row }) => (
          <p className="text-sm font-semibold text-slate-950">
            {row.original.computeCreditAmount.toLocaleString()} 算力积分
          </p>
        ),
      },
      {
        id: "claims",
        header: "领取",
        enableSorting: false,
        cell: ({ row }) => (
          <p className="text-sm text-slate-700">
            {row.original.claimCount.toLocaleString()} /{" "}
            {row.original.maxClaims?.toLocaleString() ?? "∞"}
          </p>
        ),
      },
      {
        id: "window",
        header: "有效期",
        enableSorting: false,
        cell: ({ row }) => (
          <p className="text-[12px] text-slate-500">
            {row.original.startsAt ? formatDate(row.original.startsAt) : "立即"} -{" "}
            {row.original.endsAt ? formatDate(row.original.endsAt) : "长期"}
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
        id: "actions",
        header: "操作",
        enableSorting: false,
        meta: { pin: "right" },
        cell: ({ row }) => {
          const c = row.original;
          return (
            <div className="flex flex-wrap gap-1.5">
              <Button
                variant="outline"
                size="sm"
                disabled={loading || c.status === "active"}
                onClick={() => handleStatus(c.id, "active")}
              >
                启用
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={loading || c.status === "paused" || c.status === "ended"}
                onClick={() => handleStatus(c.id, "paused")}
              >
                暂停
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={loading || c.status === "ended"}
                onClick={() => handleStatus(c.id, "ended")}
              >
                结束
              </Button>
            </div>
          );
        },
      },
    ],
    // handleStatus is render-stable; rebuild only when loading toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loading]
  );

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={
          <>
            {siteLabel} · {databaseLabel}
          </>
        }
        title="免费活动"
        description="限时免费领取算力积分活动，用户在有效期内每人可领取一次。"
      />
      {error ? <ErrorBanner message={error} /> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="border-b border-slate-200 p-4">
            <div className="grid gap-2 lg:grid-cols-[minmax(240px,1fr)_150px_auto]">
              <label className="relative block">
                <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <TextInput
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="pl-9 pr-3"
                  placeholder="搜索活动名称"
                />
              </label>
              <Select value={status} onChange={setStatus}>
                <option value="">全部状态</option>
                <option value="draft">草稿</option>
                <option value="active">进行中</option>
                <option value="paused">暂停</option>
                <option value="ended">已结束</option>
              </Select>
              <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
                <IconRefresh className={cn("size-3.5", loading && "animate-spin")} />
                应用
              </Button>
            </div>
          </div>
          <DataTable
            columns={columns}
            data={visible}
            loading={loading}
            minWidth={920}
            pageSize={20}
            emptyLabel="暂无活动"
            className="rounded-none border-0"
          />
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">新建免费活动</h3>
              <p className="mt-1 text-[12px] text-slate-500">
                到账用户个人空间算力积分钱包；每人限领一次，可设总名额上限。
              </p>
            </div>
            <IconConfetti className="size-4 text-slate-400" />
          </div>
          <form onSubmit={handleCreate} className="mt-4 grid gap-3">
            <FormLabel label="活动名称" help="展示给用户的活动名称。">
              <TextInput name="name" required placeholder="新用户福利" />
            </FormLabel>
            <div className="grid grid-cols-2 gap-2">
              <FormLabel label="面额（算力积分）" help="每位用户领取到账的算力积分数量。">
                <TextInput
                  name="computeCreditAmount"
                  required
                  inputMode="numeric"
                  placeholder="500"
                />
              </FormLabel>
              <FormLabel label="总名额" help="全站最多领取人数；留空表示不限。">
                <TextInput name="maxClaims" inputMode="numeric" placeholder="不限" />
              </FormLabel>
            </div>
            <FormLabel label="状态" help="草稿不可领取；进行中可领取。">
              <Select name="status" defaultValue="draft">
                <option value="draft">草稿</option>
                <option value="active">进行中</option>
                <option value="paused">暂停</option>
              </Select>
            </FormLabel>
            <div className="grid grid-cols-2 gap-2">
              <FormLabel label="开始时间" help="留空表示立即开始。">
                <TextInput name="startsAt" type="datetime-local" />
              </FormLabel>
              <FormLabel label="结束时间" help="留空表示长期有效。">
                <TextInput name="endsAt" type="datetime-local" />
              </FormLabel>
            </div>
            <FormLabel label="备注" help="内部运营备注，可选。">
              <TextInput name="note" placeholder="例如：开业活动" />
            </FormLabel>
            <Button type="submit" disabled={loading}>
              <IconPlus className="size-3.5" />
              创建
            </Button>
          </form>
        </section>
      </div>
    </div>
  );
}
