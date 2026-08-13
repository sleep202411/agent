"use client";

// MemberWorkspacesDrawer — 用户列表「查看」打开的抽屉：这个人的基本信息 + 他参与的
// **全部**工作区（自己创建的和被拉进去的都在内），每个工作区可以直接充值。
//
// 为什么工作区要单独列出来：算力积分（compute_point）是 **workspace 拥有**的，不是用户
// 拥有的。给「用户」加积分只会落到他的个人工作区；他和同事共用的团队池是另一个账户。
// 所以要回答「该给谁充值」，必须先看见他到底跟哪些池子有关系、每个池子是谁的。
//
// 数据来自两处：
//   GET /billing/workspaces?relatedUserId=<userId>&type=all —— 拥有 OR 参与，带该用户的角色
//   GET /legacy-points/users-by-ids?ids=…                   —— 把 ownerUserId 批量换成名字
// 后者是必要的：工作区表里只有外部 userId，没有用户名（我们库里根本没有用户表）。

import { useCallback, useEffect, useState } from "react";
import { IconCrown, IconExternalLink, IconUsers, IconWallet } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  ErrorBanner,
  StatusPill,
  formatDate,
  formatInteger,
  requestEnvelope,
  toErrorMessage,
} from "./shared";
import { WorkspaceGrantDialog } from "./workspace-grant-dialog";
import type {
  AdminBillingWorkspacesData,
  AdminWorkspaceMemberRole,
  AdminWorkspaceRow,
} from "./types";

export interface MemberSummaryForDrawer {
  userId: string;
  phone: string | null;
  email: string | null;
  nickName: string | null;
}

interface LegacyIdentity {
  userId: string;
  nickName: string | null;
  phone: string | null;
  email: string | null;
}

const ROLE_LABEL: Record<AdminWorkspaceMemberRole, string> = {
  owner: "所有者",
  admin: "管理员",
  member: "成员",
  viewer: "只读",
};

export function MemberWorkspacesDrawer({
  member,
  onClose,
}: {
  member: MemberSummaryForDrawer | null;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<AdminWorkspaceRow[]>([]);
  const [owners, setOwners] = useState<Record<string, LegacyIdentity>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [granting, setGranting] = useState<AdminWorkspaceRow | null>(null);

  const userId = member?.userId ?? null;

  // One fetch per opened user. The `cancelled` flag is not ceremony: opening
  // the drawer on user A then quickly on user B can land A's response last, and
  // the panel would show B's name over A's workspaces.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    void (async () => {
      setRows([]);
      setOwners({});
      setLoading(true);
      setError(null);
      try {
        const data = await requestEnvelope<AdminBillingWorkspacesData>(
          `/api/admin/billing/workspaces?relatedUserId=${encodeURIComponent(userId)}&type=all&limit=50`
        );
        if (cancelled) return;
        const items = data?.items ?? [];
        setRows(items);

        // Owners of OTHER people's workspaces are just ids until resolved.
        // Best-effort: a failure here leaves the ids on screen, which is still
        // usable — it must not blank out the list.
        const ids = [...new Set(items.map((row) => row.ownerUserId))].filter(Boolean);
        if (ids.length === 0) return;
        try {
          const identities = await requestEnvelope<{ items: LegacyIdentity[] }>(
            `/api/admin/legacy-points/users-by-ids?ids=${encodeURIComponent(ids.join(","))}`
          );
          if (cancelled) return;
          setOwners(
            Object.fromEntries((identities?.items ?? []).map((item) => [item.userId, item]))
          );
        } catch {
          /* names stay unresolved; the ids are still shown */
        }
      } catch (err) {
        if (cancelled) return;
        setError(toErrorMessage(err));
        setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  function applyBalance(workspaceId: string, availableBalance: string) {
    setRows((prev) =>
      prev.map((row) =>
        row.id === workspaceId ? { ...row, hasWallet: true, availableBalance } : row
      )
    );
  }

  return (
    <>
      <Sheet open={Boolean(member)} onOpenChange={(next) => (next ? null : onClose())}>
        <SheetContent
          side="right"
          className="flex w-[min(680px,calc(100vw-24px))] flex-col gap-0 p-0"
        >
          <SheetHeader className="border-b border-slate-200 px-4 py-3">
            <SheetTitle>{member?.nickName || "用户详情"}</SheetTitle>
          </SheetHeader>

          <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
            {member ? (
              <section className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-[13px] text-slate-700">
                <Line label="用户 ID" value={member.userId} mono />
                <Line label="昵称" value={member.nickName} />
                <Line label="手机" value={member.phone} />
                <Line label="邮箱" value={member.email} />
              </section>
            ) : null}

            {error ? <ErrorBanner message={error} /> : null}

            <section className="space-y-2">
              <header className="flex items-center justify-between">
                <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-950">
                  <IconUsers className="size-4 text-slate-400" />
                  参与的工作区
                  <span className="font-normal text-slate-400">({rows.length})</span>
                </h3>
                <p className="text-[11px] text-slate-400">算力积分按工作区记账</p>
              </header>

              {loading ? (
                <p className="py-6 text-center text-[13px] text-slate-400">加载中…</p>
              ) : rows.length === 0 ? (
                <p className="py-6 text-center text-[13px] text-slate-400">
                  该用户没有任何工作区。
                </p>
              ) : (
                <ul className="space-y-2">
                  {rows.map((row) => {
                    const owner = owners[row.ownerUserId];
                    const isOwner = row.relatedUserRole === "owner";
                    return (
                      <li
                        key={row.id}
                        className="rounded-lg border border-slate-200 px-4 py-3 text-[13px]"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-slate-950">{row.name}</span>
                              <StatusPill tone={row.type === "team" ? "success" : "muted"}>
                                {row.type === "team" ? "团队" : "个人"}
                              </StatusPill>
                              {isOwner ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                                  <IconCrown className="size-3" />
                                  所有者
                                </span>
                              ) : row.relatedUserRole ? (
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                                  {ROLE_LABEL[row.relatedUserRole]}
                                </span>
                              ) : null}
                            </div>
                            <p className="text-[11px] text-slate-500">
                              所有者 {owner?.nickName || "—"}
                              <span className="ml-1 font-mono text-slate-400">
                                UID {row.ownerUserId}
                              </span>
                              {isOwner ? (
                                <span className="ml-1 text-amber-700">（本人）</span>
                              ) : null}
                            </p>
                            <p className="text-[11px] text-slate-400">
                              成员 {row.memberCount} · 创建于 {formatDate(row.createdAt)}
                            </p>
                          </div>

                          <div className="flex shrink-0 flex-col items-end gap-2">
                            <span className="flex items-center gap-1 text-[13px] font-semibold text-slate-950">
                              <IconWallet className="size-3.5 text-slate-400" />
                              {row.hasWallet ? formatInteger(row.availableBalance) : "0"}
                            </span>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setGranting(row)}
                            >
                              充值
                            </Button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <p className="flex items-center gap-1 text-[11px] text-slate-400">
              <IconExternalLink className="size-3" />
              按名称搜索任意工作区请到「财务 → 团队算力池」。
            </p>
          </div>
        </SheetContent>
      </Sheet>

      {granting ? (
        <WorkspaceGrantDialog
          workspace={granting}
          onClose={() => setGranting(null)}
          onGranted={applyBalance}
        />
      ) : null}
    </>
  );
}

function Line({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className={mono ? "font-mono text-[12px] text-slate-950" : "text-slate-950"}>
        {value || "—"}
      </span>
    </div>
  );
}
