"use client";

// 岗位管理 — 管理员巡查各剧组发布的招募岗位(CrewPosition),对违规岗位下架/恢复。
// 后审:岗位照常上线,管理员事后处置。下架的岗位从招募广场/剧组页全部隐藏。
// 数据经 Nest /admin/crew-positions(AdminAuthGuard + crew.manage + 审计)。

import { useCallback, useEffect, useState } from "react";
import { IconSearch, IconShieldOff, IconShieldCheck } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  AdminDialog,
  ErrorBanner,
  Select,
  StatusPill,
  TextInput,
  formatDate,
  mutateEnvelope,
  requestEnvelope,
  toErrorMessage,
} from "@/components/admin/billing/shared";
import { PageHeader } from "@/components/admin/page-header";

type ModerationStatus = "ok" | "taken_down";

interface AdminPosition {
  id: string;
  crewId: string;
  crewName: string;
  crewLogo: string;
  positionType: string;
  description: string;
  status: string;
  moderationStatus: ModerationStatus;
  moderationReason: string | null;
  moderatedAt: string | null;
  createdAt: string;
}

interface PositionListResult {
  items: AdminPosition[];
  nextCursor: string | null;
}

const STATUS_FILTERS = [
  { value: "", label: "全部状态" },
  { value: "ok", label: "正常" },
  { value: "taken_down", label: "已下架" },
] as const;

export function CrewPositionModerationPanel() {
  const [queryInput, setQueryInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [items, setItems] = useState<AdminPosition[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [takedownTarget, setTakedownTarget] = useState<AdminPosition | null>(null);
  const [reason, setReason] = useState("");
  const [acting, setActing] = useState(false);

  const load = useCallback(async (query: string, status: string, cursor: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "30" });
      if (query) params.set("q", query);
      if (status) params.set("moderationStatus", status);
      if (cursor) params.set("cursor", cursor);
      const data = await requestEnvelope<PositionListResult>(`/api/admin/crew-positions?${params}`);
      setItems((prev) => (cursor ? [...prev, ...data.items] : data.items));
      setNextCursor(data.nextCursor);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(activeQuery, statusFilter, null);
  }, [load, activeQuery, statusFilter]);

  const runSearch = () => setActiveQuery(queryInput.trim());

  const applyModeration = async (
    position: AdminPosition,
    status: ModerationStatus,
    why?: string
  ) => {
    setActing(true);
    setError(null);
    try {
      const updated = await mutateEnvelope<AdminPosition>(
        `/api/admin/crew-positions/${position.id}/moderation`,
        { status, ...(why ? { reason: why } : {}) }
      );
      setItems((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      setTakedownTarget(null);
      setReason("");
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="岗位管理"
        description="巡查各剧组发布的招募岗位并对违规岗位下架。下架后该岗位从招募广场、剧组页全部隐藏;可随时恢复。"
      />

      <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-4">
          <div className="max-w-md flex-1">
            <TextInput
              value={queryInput}
              placeholder="剧组名称 / 岗位类型 / 岗位 ID"
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
          <Select value={statusFilter} onChange={setStatusFilter} title="审核状态">
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
                <th className="px-4 py-2 font-medium">岗位</th>
                <th className="px-4 py-2 font-medium">所属剧组</th>
                <th className="px-4 py-2 font-medium">审核状态</th>
                <th className="px-4 py-2 font-medium">发布时间</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {items.length > 0 ? (
                items.map((position) => (
                  <tr key={position.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2">
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900">{position.positionType}</div>
                        <div
                          className="max-w-80 truncate text-[11px] text-slate-400"
                          title={position.description}
                        >
                          {position.description || "—"}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={position.crewLogo}
                          alt=""
                          className="size-6 shrink-0 rounded-md border border-slate-200 object-cover"
                        />
                        <span className="truncate text-slate-700">{position.crewName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      {position.moderationStatus === "taken_down" ? (
                        <div className="space-y-0.5">
                          <StatusPill tone="risk">已下架</StatusPill>
                          {position.moderationReason ? (
                            <div
                              className="max-w-55 truncate text-[11px] text-slate-400"
                              title={position.moderationReason}
                            >
                              {position.moderationReason}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <StatusPill tone="success">正常</StatusPill>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-500">{formatDate(position.createdAt)}</td>
                    <td className="px-4 py-2 text-right">
                      {position.moderationStatus === "taken_down" ? (
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          disabled={acting}
                          onClick={() => void applyModeration(position, "ok")}
                        >
                          <IconShieldCheck className="size-3.5" />
                          恢复
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="xs"
                          variant="destructive"
                          disabled={acting}
                          onClick={() => {
                            setReason("");
                            setTakedownTarget(position);
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
                  <td colSpan={5} className="px-4 py-10 text-center text-[13px] text-slate-400">
                    {loading ? "加载中…" : "无匹配岗位"}
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
              onClick={() => void load(activeQuery, statusFilter, nextCursor)}
            >
              {loading ? "加载中…" : "加载更多"}
            </Button>
          </div>
        ) : null}
      </section>

      <AdminDialog
        open={takedownTarget !== null}
        title="下架岗位"
        description={
          takedownTarget
            ? `确认下架「${takedownTarget.crewName} · ${takedownTarget.positionType}」?下架后该岗位对所有用户不可见。`
            : undefined
        }
        onClose={() => {
          if (!acting) setTakedownTarget(null);
        }}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={acting}
              onClick={() => setTakedownTarget(null)}
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
        <div className="space-y-1.5">
          <label className="text-[12px] font-medium text-slate-600">下架原因(必填)</label>
          <TextInput
            value={reason}
            placeholder="例:招募信息违规,含不实或不当内容"
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
      </AdminDialog>
    </div>
  );
}
