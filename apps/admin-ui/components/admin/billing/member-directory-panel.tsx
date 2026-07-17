"use client";

// 用户列表 — 只读检索 Java fizzdragon_client.client_user。搜手机/邮箱/ID/昵称,
// 分页展示资料 + 余额 + 状态。头部和每行的「加积分」打开弹窗(头部空标识符、
// 行内预填该用户)。数据经 LegacyMysql 桥(/admin/legacy-points/users),不经 Prisma。

import { useCallback, useEffect, useState } from "react";
import { IconSearch, IconCoins, IconCrown } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  ErrorBanner,
  PageHeader,
  TextInput,
  formatDate,
  requestEnvelope,
  toErrorMessage,
} from "./shared";
import { GrantPointsDialog } from "./grant-points-dialog";
import { GrantMembershipDialog } from "./grant-membership-dialog";

interface MemberSummary {
  userId: string;
  phone: string | null;
  email: string | null;
  nickName: string | null;
  scoreBalance: number;
  userLevel: string | null;
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

export function MemberDirectoryPanel() {
  const [queryInput, setQueryInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [page, setPage] = useState(1);

  const [result, setResult] = useState<MemberSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [grantOpen, setGrantOpen] = useState(false);
  const [grantIdentifier, setGrantIdentifier] = useState<string | undefined>(undefined);
  const [membershipOpen, setMembershipOpen] = useState(false);
  const [membershipIdentifier, setMembershipIdentifier] = useState<string | undefined>(undefined);

  const load = useCallback(async (query: string, pageNum: number) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(pageNum),
        pageSize: String(PAGE_SIZE),
      });
      if (query) params.set("query", query);
      const data = await requestEnvelope<MemberSearchResult>(
        `/api/admin/legacy-points/users?${params.toString()}`
      );
      setResult(data);
    } catch (err) {
      setError(toErrorMessage(err));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(activeQuery, page);
  }, [load, activeQuery, page]);

  function runSearch() {
    setPage(1);
    setActiveQuery(queryInput.trim());
  }

  function openGrant(identifier?: string) {
    setGrantIdentifier(identifier);
    setGrantOpen(true);
  }

  function openMembership(identifier?: string) {
    setMembershipIdentifier(identifier);
    setMembershipOpen(true);
  }

  const total = result?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <PageHeader
        title="用户列表"
        description="检索 Java 老系统的终端用户(client_user),查看资料与积分余额。仅读取。"
        actions={
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => openMembership(undefined)}
            >
              <IconCrown className="size-4" />
              开通会员
            </Button>
            <Button type="button" size="sm" onClick={() => openGrant(undefined)}>
              <IconCoins className="size-4" />
              加积分
            </Button>
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
                <th className="px-4 py-2 font-medium">等级</th>
                <th className="px-4 py-2 font-medium">积分余额</th>
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
                    <td className="px-4 py-2 text-slate-600">{m.userLevel || "—"}</td>
                    <td className="px-4 py-2 font-medium text-slate-900">{m.scoreBalance}</td>
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
                          onClick={() => openMembership(m.phone || m.email || undefined)}
                        >
                          <IconCrown className="size-3.5" />
                          开通会员
                        </Button>
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          onClick={() => openGrant(m.phone || m.email || undefined)}
                        >
                          <IconCoins className="size-3.5" />
                          加积分
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-[13px] text-slate-400">
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

      <GrantPointsDialog
        open={grantOpen}
        initialIdentifier={grantIdentifier}
        onClose={() => setGrantOpen(false)}
        onGranted={() => {
          // Keep the dialog open on its success view; just refresh the
          // list behind it so the granted user's balance updates.
          void load(activeQuery, page);
        }}
      />

      <GrantMembershipDialog
        open={membershipOpen}
        initialIdentifier={membershipIdentifier}
        onClose={() => setMembershipOpen(false)}
      />
    </div>
  );
}
