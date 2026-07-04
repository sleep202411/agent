"use client";

// 消费返佣白名单 (per-user commission rates) — table + upsert form, rendered by
// ReferralsPanel. Wire unit is bps (万分比); the form edits percent (bps / 100).

import { useMemo } from "react";
import { IconDeviceFloppy, IconEdit, IconTrash } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { FormLabel, TextInput } from "../billing/shared";
import type { CommissionRateRow } from "./referrals-types";

/** bps → "30%" / "2.5%" for display; the form edits percent directly. */
export function bpsPercentLabel(bps: number): string {
  const pct = bps / 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(2).replace(/0+$/, "")}%`;
}

export function CommissionRatesTable({
  rates,
  loading,
  onEditRate,
}: {
  rates: CommissionRateRow[];
  loading: boolean;
  onEditRate: (rate: CommissionRateRow) => void;
}) {
  const columns = useMemo<ColumnDef<CommissionRateRow, unknown>[]>(
    () => [
      {
        accessorKey: "userId",
        header: "用户",
        enableSorting: false,
        cell: ({ row }) => {
          const rate = row.original;
          return (
            <>
              <p className="text-sm font-semibold text-slate-950">
                {rate.nickName || "（昵称未知）"}
              </p>
              <p className="mt-0.5 font-mono text-[12px] text-slate-500">
                {rate.userId}
                {rate.email ? ` · ${rate.email}` : ""}
              </p>
            </>
          );
        },
      },
      {
        accessorKey: "commissionBps",
        header: "返佣比例",
        cell: ({ row }) => (
          <span className="text-sm font-semibold text-slate-900">
            {bpsPercentLabel(row.original.commissionBps)}
          </span>
        ),
      },
      {
        accessorKey: "note",
        header: "备注",
        enableSorting: false,
        cell: ({ row }) => (
          <p className="max-w-md text-[13px] leading-5 text-slate-600">
            {row.original.note || "—"}
          </p>
        ),
      },
      {
        accessorKey: "updatedAt",
        header: "更新时间",
        cell: ({ row }) => (
          <span className="text-[12px] text-slate-500">{row.original.updatedAt.slice(0, 10)}</span>
        ),
      },
      {
        id: "actions",
        header: "操作",
        enableSorting: false,
        meta: { pin: "right", cellClassName: "w-[96px]" },
        cell: ({ row }) => (
          <Button variant="outline" size="sm" onClick={() => onEditRate(row.original)}>
            <IconEdit className="size-4" />
            编辑
          </Button>
        ),
      },
    ],
    [onEditRate]
  );

  return (
    <DataTable
      columns={columns}
      data={rates}
      loading={loading}
      minWidth={760}
      emptyLabel="暂无白名单用户（默认比例为 0 时不发放返佣）"
    />
  );
}

export function CommissionRateForm({
  rate,
  loading,
  onSubmit,
  onRemove,
}: {
  rate?: CommissionRateRow;
  loading: boolean;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onRemove?: () => void;
}) {
  return (
    <form className="space-y-5" onSubmit={onSubmit}>
      <div className="grid gap-3 md:grid-cols-2">
        <FormLabel
          label="用户 ID"
          help="Java 用户 ID（可在「用户管理 → 成员目录」搜索获取）；保存时校验存在性。"
        >
          <TextInput
            name="userId"
            defaultValue={rate?.userId ?? ""}
            readOnly={Boolean(rate)}
            required
            className={rate ? "bg-slate-50 text-slate-500" : undefined}
          />
        </FormLabel>
        <FormLabel label="返佣比例(%)" help="按订单实付金额计算；0 = 对该用户显式关闭。">
          <TextInput
            name="ratePercent"
            type="number"
            min={0}
            max={100}
            step={0.01}
            defaultValue={rate ? rate.commissionBps / 100 : 30}
            required
          />
        </FormLabel>
      </div>
      <FormLabel label="备注" help="谁 / 渠道 / 约定，例如「KOL 张三 抖音 30%」。">
        <TextInput name="note" defaultValue={rate?.note ?? ""} maxLength={200} />
      </FormLabel>

      <div className="flex items-center justify-between gap-2 border-t border-slate-200 pt-4">
        {rate && onRemove ? (
          <Button type="button" variant="outline" disabled={loading} onClick={onRemove}>
            <IconTrash className="size-4" />
            移除（回落默认比例）
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={loading}>
          <IconDeviceFloppy className="size-3.5" />
          保存
        </Button>
      </div>
    </form>
  );
}
