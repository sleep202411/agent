"use client";

// User identity lookup; compute balances and adjustments belong to workspaces.

import { useCallback, useEffect, useRef, useState } from "react";
import { useAdminSessionRequests } from "../admin-session-boundary";
import {
  IconSearch,
  IconWallet,
  IconCrown,
  IconUsers,
  IconPencil,
  IconBan,
  IconDownload,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  ErrorBanner,
  PageHeader,
  TextInput,
  formatDate,
  requestEnvelope,
  toErrorMessage,
} from "./shared";
import Link from "next/link";
import { adminUiPath } from "@/lib/admin-api";
import { GrantMembershipDialog } from "./grant-membership-dialog";
import { ClientUserModerationDialog, type ClientUserTarget } from "./client-user-moderation-dialog";
import { MemberWorkspacesDrawer } from "./member-workspaces-drawer";

interface MemberSummary {
  userId: string;
  phone: string | null;
  email: string | null;
  nickName: string | null;
  accountStatus: number | null;
  createTime: string | null;
}

interface MemberSearchResult {
  items: MemberSummary[];
  total: number;
  page: number;
  pageSize: number;
}

const PAGE_SIZE = 20;

const ACCOUNT_STATUS_LABEL: Record<number, string> = {
  0: "正常",
  5: "禁用",
  9: "注销",
};

export function MemberDirectoryPanel({
  canReadWorkspaces,
  canWriteBilling,
}: {
  canReadWorkspaces: boolean;
  canWriteBilling: boolean;
}) {
  const [queryInput, setQueryInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [page, setPage] = useState(1);

  const [result, setResult] = useState<MemberSearchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The row whose detail drawer is open — its workspaces are what decides
  // which pot a top-up should go to.
  const [viewing, setViewing] = useState<MemberSummary | null>(null);
  const [membershipOpen, setMembershipOpen] = useState(false);
  const [membershipIdentifier, setMembershipIdentifier] = useState<string | undefined>(undefined);
  // C-end user moderation (edit profile / block) — actions go through the Java
  // admin API. `mode` null closes the shared dialog.
  const [moderation, setModeration] = useState<{
    mode: "edit" | "block";
    user: ClientUserTarget;
  } | null>(null);
  const [exporting, setExporting] = useState(false);

  const scope = useAdminSessionRequests();
  const pending = useRef<ReturnType<typeof scope.begin>>(null);
  const requestSequence = useRef(0);
  const queryKey = `${activeQuery}:${page}`;
  const [previousQueryKey, setPreviousQueryKey] = useState(queryKey);
  if (previousQueryKey !== queryKey) {
    setPreviousQueryKey(queryKey);
    setLoading(true);
    setError(null);
  }

  const fetchRows = useCallback(
    (query: string, pageNum: number) => {
      pending.current?.cancel();
      const operation = scope.begin();
      if (!operation) return Promise.resolve();
      pending.current = operation;
      const ticket = ++requestSequence.current;
      const params = new URLSearchParams({
        page: String(pageNum),
        pageSize: String(PAGE_SIZE),
      });
      if (query) params.set("query", query);
      return requestEnvelope<MemberSearchResult>(
        `/api/admin/legacy-points/users?${params.toString()}`,
        operation.signal
      )
        .then((data) => {
          if (!operation.current() || ticket !== requestSequence.current) return;
          setError(null);
          setResult(data);
        })
        .catch((err: unknown) => {
          if (!operation.current() || ticket !== requestSequence.current) return;
          setError(toErrorMessage(err));
          setResult(null);
        })
        .finally(() => {
          if (operation.current() && ticket === requestSequence.current) setLoading(false);
          operation.release();
        });
    },
    [scope]
  );

  const load = (...args: Parameters<typeof fetchRows>) => {
    setLoading(true);
    setError(null);
    return fetchRows(...args);
  };

  useEffect(() => {
    void fetchRows(activeQuery, page);
    return () => {
      requestSequence.current += 1;
      pending.current?.cancel();
    };
  }, [fetchRows, activeQuery, page]);

  function runSearch() {
    setPage(1);
    setActiveQuery(queryInput.trim());
  }

  function openMembership(identifier?: string) {
    setMembershipIdentifier(identifier);
    setMembershipOpen(true);
  }

  function exportActiveEmails() {
    pending.current?.cancel();
    const operation = scope.begin();
    if (!operation) return;
    pending.current = operation;
    setExporting(true);
    setError(null);
    void requestEnvelope<{ workbook: string; filename: string; count: number }>(
      "/api/admin/legacy-points/users-emails",
      operation.signal
    )
      .then((data) => {
        if (!operation.current()) return;
        if (!data?.workbook || data.count === 0) {
          setError("没有状态为正常且填写了邮箱的用户");
          return;
        }
        const url = URL.createObjectURL(
          new Blob([data.workbook], { type: "application/vnd.ms-excel" })
        );
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = data.filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      })
      .catch((err: unknown) => {
        if (!operation.current()) return;
        setError(toErrorMessage(err));
      })
      .finally(() => {
        if (operation.current()) setExporting(false);
        operation.release();
      });
  }

  const total = result?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <PageHeader
        title="用户列表"
        description="检索用户资料，查看其参与的工作区。算力积分按工作区管理。"
        actions={
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={exportActiveEmails}
              disabled={exporting}
            >
              <IconDownload className="size-4" />
              {exporting ? "导出中" : "导出邮箱"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => openMembership(undefined)}
              disabled={!canWriteBilling}
            >
              <IconCrown className="size-4" />
              开通会员
            </Button>
            {canReadWorkspaces ? (
              <Button size="sm" asChild>
                <Link href={adminUiPath("/billing/workspace-wallet")}>
                  <IconWallet className="size-4" />
                  工作区积分
                </Link>
              </Button>
            ) : null}
          </div>
        }
      />

      <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex items-center gap-2 border-b border-slate-200 p-4">
          <div className="max-w-md flex-1">
            <TextInput
              value={queryInput}
              placeholder="手机号 / 邮箱 / 昵称 / ID"
              onChange={(event) => setQueryInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") runSearch();
              }}
            />
          </div>
          <Button type="button" size="sm" disabled={loading} onClick={runSearch}>
            <IconSearch className="size-4" />
            {loading ? "查询中" : "搜索"}
          </Button>
          {total > 0 ? (
            <span className="ml-auto text-[12px] text-slate-500">共 {total} 个用户</span>
          ) : null}
        </div>

        {error ? (
          <div className="p-4">
            <ErrorBanner message={error} />
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[12px] text-slate-500">
                <th className="px-4 py-2 font-medium">昵称</th>
                <th className="px-4 py-2 font-medium">手机 / 邮箱</th>
                <th className="px-4 py-2 font-medium">状态</th>
                <th className="px-4 py-2 font-medium">注册时间</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {result && result.items.length > 0 ? (
                result.items.map((m) => (
                  <tr key={m.userId} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2 text-slate-900">
                      {m.nickName || "—"}
                      <span className="ml-1 text-[11px] text-slate-400">#{m.userId}</span>
                    </td>
                    <td className="px-4 py-2 text-slate-600">{m.phone || m.email || "—"}</td>
                    <td className="px-4 py-2 text-slate-600">
                      {m.accountStatus == null
                        ? "—"
                        : (ACCOUNT_STATUS_LABEL[m.accountStatus] ?? m.accountStatus)}
                    </td>
                    <td className="px-4 py-2 text-slate-500">
                      {m.createTime ? formatDate(m.createTime) : "—"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-1.5">
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          onClick={() => setViewing(m)}
                          disabled={!canReadWorkspaces}
                        >
                          <IconUsers className="size-3.5" />
                          工作区
                        </Button>
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          onClick={() => openMembership(m.phone || m.email || undefined)}
                          disabled={!canWriteBilling}
                        >
                          <IconCrown className="size-3.5" />
                          开通会员
                        </Button>

                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          onClick={() =>
                            setModeration({
                              mode: "edit",
                              user: { userId: m.userId, nickName: m.nickName },
                            })
                          }
                        >
                          <IconPencil className="size-3.5" />
                          编辑
                        </Button>
                        {m.accountStatus === 5 ? (
                          <span className="inline-flex h-6 items-center rounded-md border border-red-200 bg-red-50 px-2 text-[11px] font-medium text-red-700">
                            已屏蔽
                          </span>
                        ) : (
                          <Button
                            type="button"
                            size="xs"
                            variant="destructive"
                            onClick={() =>
                              setModeration({
                                mode: "block",
                                user: { userId: m.userId, nickName: m.nickName },
                              })
                            }
                          >
                            <IconBan className="size-3.5" />
                            屏蔽
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-[13px] text-slate-400">
                    {loading ? "加载中…" : "无匹配用户"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {total > 0 ? (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-[12px] text-slate-500">
            <span>
              第 {page} / {totalPages} 页
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                下一页
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      <MemberWorkspacesDrawer
        key={viewing?.userId ?? "closed"}
        member={viewing}
        canWrite={canWriteBilling}
        onClose={() => setViewing(null)}
      />

      <GrantMembershipDialog
        open={membershipOpen}
        initialIdentifier={membershipIdentifier}
        onClose={() => setMembershipOpen(false)}
      />

      <ClientUserModerationDialog
        mode={moderation?.mode ?? null}
        user={moderation?.user ?? null}
        onClose={() => setModeration(null)}
        onDone={() => void load(activeQuery, page)}
      />
    </div>
  );
}
