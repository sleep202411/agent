"use client";

// BillingTeamWalletPanel — 给**工作区**（团队 / 个人）的算力积分池（compute_point）加 / 扣分。
//
// 为什么单独一页：compute_point 是 workspace-owned 的池。给「用户」加积分的 /wallets/user-credits
// 只会落到该用户的个人 workspace；团队池无法通过它充值。本页直接按 workspaceId 定位团队池，
// 调 POST /billing/wallets/workspace-credits（正数加、负数扣，服务端按 admin_adjustment 落账）。
// 即时生效、写审计。单位是积分（1 积分 = 1 美分，不是金额）。
//
// idempotencyKey 每次「打开对话框」生成一次并复用：网络失败后重试不会重复发放（补上了旧
// 加积分弹窗每次提交都换 key 的双发放缺口）。金额以字符串传输，避免大额经 JS number 丢精度。

import { useMemo, useState } from "react";
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

type WorkspaceTypeFilter = "team" | "personal" | "all";

const TYPE_TABS: { key: WorkspaceTypeFilter; label: string }[] = [
  { key: "team", label: "团队" },
  { key: "personal", label: "个人" },
  { key: "all", label: "全部" },
];

export function BillingTeamWalletPanel({
  siteLabel,
  databaseLabel,
  canWrite,
  initialRows,
  initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  /** billing.write — gates the 加/扣积分 action (server enforces regardless). */
  canWrite: boolean;
  initialRows: AdminWorkspaceRow[];
  initialError?: string | null;
}) {
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<WorkspaceTypeFilter>("team");
  const [rows, setRows] = useState<AdminWorkspaceRow[]>(initialRows);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [target, setTarget] = useState<AdminWorkspaceRow | null>(null);

  async function search(nextType?: WorkspaceTypeFilter) {
    const type = nextType ?? typeFilter;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ type, limit: "30" });
      if (query.trim()) params.set("query", query.trim());
      const data = await requestEnvelope<AdminBillingWorkspacesData>(
        `/api/admin/billing/workspaces?${params.toString()}`
      );
      setRows(data.items);
    } catch (err) {
      setError(toErrorMessage(err));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  function selectType(next: WorkspaceTypeFilter) {
    setTypeFilter(next);
    void search(next);
  }

  // Apply a fresh balance to the matching row after a grant lands.
  function applyBalance(workspaceId: string, availableBalance: string) {
    setRows((prev) =>
      prev.map((row) =>
        row.id === workspaceId ? { ...row, hasWallet: true, availableBalance } : row
      )
    );
  }

  const teamCount = useMemo(() => rows.filter((row) => row.type === "team").length, [rows]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow={`${siteLabel} · ${databaseLabel}`}
        title="团队算力池"
        icon={<IconWallet className="size-5" />}
        description="给工作区（团队 / 个人）的算力积分池直接加 / 扣分。团队池只能从这里充值，用户加积分不会进团队池。即时生效并写入审计。"
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-0.5">
          {TYPE_TABS.map((tab) => {
            const active = tab.key === typeFilter;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => selectType(tab.key)}
                className={
                  active
                    ? "rounded-md bg-white px-3 py-1.5 text-[13px] font-medium text-slate-950 shadow-[0_1px_2px_rgba(15,23,42,0.08)]"
                    : "rounded-md px-3 py-1.5 text-[13px] font-medium text-slate-500 transition-colors hover:text-slate-800"
                }
              >
                {tab.label}
              </button>
            );
          })}
        </div>

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

      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <Metric label="当前结果" value={rows.length} />
        <Metric label="其中团队" value={teamCount} />
      </div>

      {error ? <ErrorBanner message={error} /> : null}

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-[12px] font-semibold text-slate-500">
              <th className="px-4 py-2.5">工作区</th>
              <th className="px-4 py-2.5">类型</th>
              <th className="px-4 py-2.5 text-right">成员</th>
              <th className="px-4 py-2.5 text-right tabular-nums">可用算力</th>
              <th className="px-4 py-2.5 text-right tabular-nums">冻结</th>
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
                  <StatusPill tone={row.type === "team" ? "success" : "muted"}>
                    {row.type === "team" ? "团队" : "个人"}
                  </StatusPill>
                  {row.status !== "active" ? (
                    <span className="ml-1 text-[11px] text-amber-600">{row.status}</span>
                  ) : null}
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
                    disabled={!canWrite}
                    title={canWrite ? undefined : "需要 billing.write 权限"}
                    onClick={() => setTarget(row)}
                  >
                    加 / 扣积分
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {target ? (
        <WorkspaceGrantDialog
          workspace={target}
          onClose={() => setTarget(null)}
          onGranted={applyBalance}
        />
      ) : null}
    </div>
  );
}

// Mounted only while a workspace is selected — a fresh mount per open gives us a
// fresh idempotencyKey (below) and cleared fields with zero reset effects.
