"use client";

// 剧组巡查 — 管理员主动巡查所有剧组(含未上架/已下架),对任意剧组下架/恢复。
// 后审:剧组照常上线,管理员事后处置。下架的剧组从大厅/详情/招募全部消失。
// 数据经 Nest /admin/crews(AdminAuthGuard + crew.manage + 审计)。

import { useState } from "react";
import { IconSearch, IconShieldOff, IconShieldCheck } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  AdminDialog,
  ErrorBanner,
  Select,
  StatusPill,
  TextInput,
  formatDate,
} from "@/components/admin/billing/shared";
import { PageHeader } from "@/components/admin/page-header";

import { useModerationQueue } from "./use-moderation-queue";

type ModerationStatus = "ok" | "taken_down";

interface AdminCrew {
  id: string;
  name: string;
  logo: string;
  ownerUserId: string | null;
  listingStatus: string;
  moderationStatus: ModerationStatus;
  moderatedAt: string | null;
  moderatedByAdminId: string | null;
  moderationReason: string | null;
  memberCount: number;
  createdAt: string;
}

const STATUS_FILTERS = [
  { value: "", label: "全部状态" },
  { value: "ok", label: "正常" },
  { value: "taken_down", label: "已下架" },
] as const;

export function CrewModerationPanel() {
  const [queryInput, setQueryInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const { items, nextCursor, loading, error, acting, writing, load, moderate } =
    useModerationQueue<AdminCrew>("/api/admin/crews", activeQuery, statusFilter);
  const [takedownTarget, setTakedownTarget] = useState<AdminCrew | null>(null);
  const [reason, setReason] = useState("");
  const runSearch = () => {
    if (!writing.current) {
      const next = queryInput.trim();
      if (next === activeQuery) void load();
      else setActiveQuery(next);
    }
  };
  const applyModeration = async (crew: AdminCrew, status: ModerationStatus, why?: string) => {
    if (await moderate(crew, status, why)) {
      setTakedownTarget(null);
      setReason("");
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="剧组审核"
        description="巡查全部剧组并对违规剧组下架。下架后该剧组从大厅、详情、招募全部隐藏;可随时恢复。"
      />

      <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div
          inert={acting || loading}
          className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-4"
        >
          <div className="max-w-md flex-1">
            <TextInput
              value={queryInput}
              placeholder="剧组名称 / ID"
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
          <Select
            value={statusFilter}
            onChange={(value) => {
              if (!writing.current) setStatusFilter(value);
            }}
            title="审核状态"
          >
            {STATUS_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
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
                <th className="px-4 py-2 font-medium">剧组</th>
                <th className="px-4 py-2 font-medium">所有者</th>
                <th className="px-4 py-2 font-medium">成员</th>
                <th className="px-4 py-2 font-medium">审核状态</th>
                <th className="px-4 py-2 font-medium">创建时间</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {items.length > 0 ? (
                items.map((crew) => (
                  <tr key={crew.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={crew.logo}
                          alt=""
                          className="size-8 shrink-0 rounded-md border border-slate-200 object-cover"
                        />
                        <div className="min-w-0">
                          <div className="truncate font-medium text-slate-900">{crew.name}</div>
                          <div className="text-[11px] text-slate-400">#{crew.id}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-slate-600">{crew.ownerUserId ?? "—"}</td>
                    <td className="px-4 py-2 text-slate-600">{crew.memberCount}</td>
                    <td className="px-4 py-2">
                      {crew.moderationStatus === "taken_down" ? (
                        <div className="space-y-0.5">
                          <StatusPill tone="risk">已下架</StatusPill>
                          {crew.moderationReason ? (
                            <div
                              className="max-w-55 truncate text-[11px] text-slate-400"
                              title={crew.moderationReason}
                            >
                              {crew.moderationReason}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <StatusPill tone={crew.listingStatus === "listed" ? "success" : "muted"}>
                          {crew.listingStatus === "listed" ? "已上架" : "未上架"}
                        </StatusPill>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-500">{formatDate(crew.createdAt)}</td>
                    <td className="px-4 py-2 text-right">
                      {crew.moderationStatus === "taken_down" ? (
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          disabled={acting || loading}
                          onClick={() => void applyModeration(crew, "ok")}
                        >
                          <IconShieldCheck className="size-3.5" />
                          恢复
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="xs"
                          variant="destructive"
                          disabled={acting || loading}
                          onClick={() => {
                            if (writing.current) return;
                            setReason("");
                            setTakedownTarget(crew);
                          }}
                        >
                          <IconShieldOff className="size-3.5" />
                          下架
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-[13px] text-slate-400">
                    {loading ? "加载中…" : "无匹配剧组"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {nextCursor ? (
          <div className="border-t border-slate-200 px-4 py-3 text-center">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={loading}
              onClick={() => void load(nextCursor)}
            >
              {loading ? "加载中…" : "加载更多"}
            </Button>
          </div>
        ) : null}
      </section>

      <AdminDialog
        open={takedownTarget !== null}
        title="下架剧组"
        description={
          takedownTarget
            ? `确认下架「${takedownTarget.name}」?下架后该剧组对所有用户不可见。`
            : undefined
        }
        onClose={() => {
          if (!writing.current) setTakedownTarget(null);
        }}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={acting || loading}
              onClick={() => {
                if (!writing.current) setTakedownTarget(null);
              }}
            >
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={acting || !reason.trim()}
              onClick={() =>
                takedownTarget && void applyModeration(takedownTarget, "taken_down", reason.trim())
              }
            >
              {acting ? "处理中…" : "确认下架"}
            </Button>
          </div>
        }
      >
        <div inert={acting} className="space-y-1.5">
          <label className="text-[12px] font-medium text-slate-600">下架原因(必填)</label>
          <TextInput
            value={reason}
            placeholder="例:违反社区规范,发布违规内容"
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      </AdminDialog>
    </div>
  );
}
