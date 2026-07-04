"use client";

// 消费返佣白名单 (per-user commission rates) — table + upsert form, rendered by
// ReferralsPanel. Wire unit is bps (万分比); the form edits percent (bps / 100).

import { useMemo, useState } from "react";
import { IconDeviceFloppy, IconEdit, IconSearch, IconTrash } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { FormLabel, TextInput, requestEnvelope, toErrorMessage } from "../billing/shared";
import type { CommissionRateRow, UserLookupResult } from "./referrals-types";

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

function userLine(u: { userId: string; email: string | null; phone?: string | null }): string {
  return [u.userId, u.email, u.phone].filter(Boolean).join(" · ");
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
  const editing = Boolean(rate);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserLookupResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [selected, setSelected] = useState<UserLookupResult | null>(
    rate ? { userId: rate.userId, nickName: rate.nickName, email: rate.email, phone: null } : null
  );

  async function runLookup() {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setLookupError(null);
    setResults([]);
    try {
      const data = await requestEnvelope<UserLookupResult[]>(
        `/api/admin/referrals/user-lookup?q=${encodeURIComponent(q)}`
      );
      setResults(data);
      if (data.length === 0) setLookupError("未找到匹配用户。");
    } catch (err) {
      setLookupError(toErrorMessage(err));
    } finally {
      setSearching(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={onSubmit}>
      {editing ? (
        // Editing an existing rate — the user is fixed.
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
          <p className="text-sm font-semibold text-slate-900">{rate?.nickName || "（昵称未知）"}</p>
          <p className="mt-0.5 font-mono text-[12px] text-slate-500">
            {userLine({ userId: rate!.userId, email: rate!.email })}
          </p>
        </div>
      ) : selected ? (
        // A user was picked from the search results.
        <div className="flex items-center justify-between gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5">
          <div>
            <p className="text-sm font-semibold text-slate-900">
              {selected.nickName || "（昵称未知）"}
            </p>
            <p className="mt-0.5 font-mono text-[12px] text-slate-500">{userLine(selected)}</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setSelected(null)}>
            重选
          </Button>
        </div>
      ) : (
        // Search by email / phone / nickname / id.
        <div className="space-y-2">
          <FormLabel
            label="查找用户"
            help="输入邮箱 / 手机号 / 昵称 / 用户ID 搜索，选中确认是本人后再保存。"
          >
            <div className="flex gap-2">
              <TextInput
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="邮箱 / 手机 / 昵称 / ID"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void runLookup();
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void runLookup()}
                disabled={searching || !query.trim()}
              >
                <IconSearch className="size-4" />
                查找
              </Button>
            </div>
          </FormLabel>
          {lookupError ? <p className="text-[12px] text-red-600">{lookupError}</p> : null}
          {results.length > 0 ? (
            <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-1">
              {results.map((u) => (
                <button
                  key={u.userId}
                  type="button"
                  onClick={() => {
                    setSelected(u);
                    setResults([]);
                  }}
                  className="flex w-full flex-col items-start rounded px-2 py-1.5 text-left transition hover:bg-slate-50"
                >
                  <span className="text-sm font-medium text-slate-900">
                    {u.nickName || "（昵称未知）"}
                  </span>
                  <span className="font-mono text-[11px] text-slate-500">{userLine(u)}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}
      {/* Resolved on submit — the picked user's Java id. */}
      <input type="hidden" name="userId" value={rate?.userId ?? selected?.userId ?? ""} readOnly />

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
        <Button type="submit" disabled={loading || (!editing && !selected)}>
          <IconDeviceFloppy className="size-3.5" />
          保存
        </Button>
      </div>
    </form>
  );
}
