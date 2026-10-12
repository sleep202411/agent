"use client";

// Search and adjust workspace compute wallets; grants share one dialog.

import { useState } from "react";
import { useAdminOperation } from "../use-admin-operation";
import { IconSearch, IconUsers, IconWallet } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  ErrorBanner,
  Metric,
  PageHeader,
  StatusPill,
  TextInput,
  formatInteger,
  requestEnvelope,
  toErrorMessage,
} from "./shared";
import type { AdminBillingWorkspacesData, AdminWorkspaceRow } from "./types";
import { WorkspaceGrantDialog } from "./workspace-grant-dialog";

export function BillingWorkspaceWalletPanel({
  siteLabel,
  databaseLabel,
  canWrite,
  initialRows,
  initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  /** Pax-only direct-grant capability — gates the 加/扣积分 action (server enforces regardless). */
  canWrite: boolean;
  initialRows: AdminWorkspaceRow[];
  initialError?: string | null;
}) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<AdminWorkspaceRow[]>(initialRows);
  const { busy: loading, begin } = useAdminOperation();
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [target, setTarget] = useState<AdminWorkspaceRow | null>(null);

  async function search() {
    const operation = begin("read");
    if (!operation) return;
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "30" });
      if (query.trim()) params.set("query", query.trim());
      const data = await requestEnvelope<AdminBillingWorkspacesData>(
        `/api/admin/billing/workspaces?${params.toString()}`,
        operation.signal
      );
      if (operation.current()) setRows(data.items);
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      operation.finish();
    }
  }

  // Apply a fresh balance to the matching row after a grant lands.
  function applyBalance(workspaceId: string, availableBalance: string) {
    setTarget((current) =>
      current?.id === workspaceId ? { ...current, hasWallet: true, availableBalance } : current
    );
    setRows((prev) =>
      prev.map((row) =>
        row.id === workspaceId ? { ...row, hasWallet: true, availableBalance } : row
      )
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow={`${siteLabel} · ${databaseLabel}`}
        title="工作区积分"
        icon={<IconWallet className="size-5" />}
        description="给指定工作区的算力积分池加 / 扣分，即时生效并写入审计。"
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex w-full max-w-md gap-2 sm:w-auto">
          <TextInput
            value={query}
            placeholder="工作区名称 / ID / 拥有者用户ID"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void search();
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={() => void search()}
          >
            <IconSearch className="size-4" />
            {loading ? "查询中" : "查询"}
          </Button>
        </div>
      </div>

      <div className="max-w-48">
        <Metric label="当前结果" value={rows.length} />
      </div>

      {error ? <ErrorBanner message={error} /> : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-[12px] font-semibold text-slate-500">
              <th className="px-4 py-2.5">工作区</th>
              <th className="px-4 py-2.5">状态</th>
              <th className="px-4 py-2.5 text-right">成员</th>
              <th className="px-4 py-2.5 text-right tabular-nums">可用积分</th>
              <th className="px-4 py-2.5 text-right tabular-nums">冻结积分</th>
              <th className="px-4 py-2.5 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && !loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-[13px] text-slate-400">
                  没有匹配的工作区。换个名称 / ID 再试。
                </td>
              </tr>
            ) : null}
            {rows.map((row) => (
              <tr key={row.id} className="text-slate-700 hover:bg-slate-50/60">
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-950">{row.name}</p>
                  <p className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-slate-400">
                    <span className="truncate" title={row.id}>
                      {row.id}
                    </span>
                    <span className="inline-flex items-center gap-1 text-slate-400">
                      <IconUsers className="size-3" />
                      owner {row.ownerUserId}
                    </span>
                  </p>
                </td>
                <td className="px-4 py-3">
                  <StatusPill tone={row.status === "active" ? "success" : "muted"}>
                    {row.status}
                  </StatusPill>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{row.memberCount}</td>
                <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-950">
                  {row.hasWallet ? formatInteger(row.availableBalance) : "—"}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                  {row.hasWallet && row.heldBalance !== "0" ? formatInteger(row.heldBalance) : "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={loading || !canWrite || row.status !== "active"}
                    title={
                      canWrite
                        ? undefined
                        : "Only the designated points administrator may grant points directly."
                    }
                    onClick={() => setTarget(row)}
                  >
                    调整积分
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {target && canWrite ? (
        <WorkspaceGrantDialog
          key={target.id}
          workspace={target}
          onClose={() => setTarget(null)}
          onGranted={applyBalance}
        />
      ) : null}
    </div>
  );
}
