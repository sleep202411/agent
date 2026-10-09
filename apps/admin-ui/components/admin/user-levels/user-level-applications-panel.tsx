"use client";

import { useMemo, useRef, useState } from "react";
import { useAdminOperation } from "../use-admin-operation";
import { encodeUserId } from "@repo/shared/user-id-codec";
import {
  IconCheck,
  IconChecklist,
  IconDownload,
  IconExternalLink,
  IconRefresh,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AdminDialog,
  ErrorBanner,
  FormLabel,
  PageHeader,
  StatusPill,
  TextInput,
  formatDate,
  requestEnvelope,
  toErrorMessage,
} from "@/components/admin/billing/shared";
import { adminUiApiPath } from "@/lib/admin-api";
import { cn } from "@/lib/utils";
import type { AdminUserLevelDefinition } from "@/lib/admin-user-levels";
import type {
  AdminUserLevelApplication,
  AdminUserLevelApplicationListResult,
  AdminUserLevelApplicationStatus,
} from "@/lib/admin-user-level-applications";

type AdminApiPayload<T> = {
  code?: number;
  msg?: string;
  message?: string;
  data?: T;
};

async function mutateApplication(
  url: string,
  body: { adminRemark?: string },
  signal: AbortSignal
): Promise<void> {
  const response = await fetch(adminUiApiPath(url), {
    method: "POST",
    signal,
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as AdminApiPayload<null> | null;
  signal.throwIfAborted();
  if (!response.ok || payload?.code !== 200) {
    throw new Error(payload?.msg ?? payload?.message ?? `请求失败：${response.status}`);
  }
}

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "0", label: "待审" },
  { value: "1", label: "已通过" },
  { value: "2", label: "已驳回" },
  { value: "3", label: "已取消" },
  { value: "all", label: "全部" },
];

function statusLabel(status: AdminUserLevelApplicationStatus): string {
  switch (status) {
    case 0:
      return "待审";
    case 1:
      return "已通过";
    case 2:
      return "已驳回";
    case 3:
      return "已取消";
    default:
      return String(status);
  }
}

function statusTone(status: AdminUserLevelApplicationStatus): "success" | "risk" | "muted" {
  if (status === 1) return "success";
  if (status === 2) return "risk";
  return "muted";
}

function publicUserId(raw: number): string {
  return encodeUserId(raw);
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function fileNameFromPath(path: string): string {
  try {
    const pathname = isHttpUrl(path) ? new URL(path).pathname : path;
    const parts = pathname.split(/[/\\]/).filter(Boolean);
    return decodeURIComponent(parts[parts.length - 1] || path);
  } catch {
    const parts = path.split(/[/\\]/);
    return parts[parts.length - 1] || path;
  }
}

/** Full OSS URL — browser downloads via `download` + disposition override. */
function AttachmentLink({ url }: { url: string | null }) {
  if (!url) return <span className="text-slate-400">—</span>;
  if (!isHttpUrl(url)) {
    return (
      <span className="max-w-[180px] truncate text-slate-500" title={url}>
        {fileNameFromPath(url)}
      </span>
    );
  }

  const fileName = fileNameFromPath(url);
  return (
    <a
      href={url}
      download={fileName}
      target="_blank"
      rel="noreferrer"
      className="inline-flex max-w-[200px] items-center gap-1 text-slate-700 underline-offset-2 hover:underline"
      title={`下载 ${fileName}`}
    >
      <IconDownload className="size-3.5 shrink-0" />
      <span className="truncate">{fileName}</span>
    </a>
  );
}

function EntityLink({ href, label }: { href: string; label: string }) {
  if (!href) return <span className="text-slate-500">{label || "—"}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex max-w-[200px] items-center gap-1 text-slate-800 underline-offset-2 hover:underline"
      title={href}
    >
      <span className="truncate">{label}</span>
      <IconExternalLink className="size-3 shrink-0 text-slate-400" />
    </a>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-3 border-b border-slate-100 py-2.5 last:border-0">
      <dt className="pt-0.5 text-[12px] text-slate-500">{label}</dt>
      <dd className="min-w-0 text-[13px] text-slate-900">{children}</dd>
    </div>
  );
}

export function UserLevelApplicationsPanel({
  siteLabel,
  databaseLabel,
  initialList,
  initialLevels,
  initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialList: AdminUserLevelApplicationListResult | null;
  initialLevels: AdminUserLevelDefinition[];
  initialError: string | null;
}) {
  const pageSize = initialList?.pageSize ?? 20;

  const [items, setItems] = useState<AdminUserLevelApplication[]>(initialList?.items ?? []);
  const [total, setTotal] = useState(initialList?.total ?? 0);
  const [page, setPage] = useState(initialList?.page ?? 1);
  const [levels] = useState(initialLevels);
  const [statusFilter, setStatusFilter] = useState("0");
  const [levelFilter, setLevelFilter] = useState("all");
  const [userIdInput, setUserIdInput] = useState("");
  const [activeUserId, setActiveUserId] = useState("");
  const { busy: loading, begin } = useAdminOperation();
  const decisionOperation = useRef<ReturnType<typeof begin>>(null);
  const [error, setError] = useState<string | null>(initialError);

  const [reviewTarget, setReviewTarget] = useState<AdminUserLevelApplication | null>(null);
  const [adminRemark, setAdminRemark] = useState("");
  const [acting, setActing] = useState<"approve" | "reject" | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const levelOptions = useMemo(() => [...levels].sort((a, b) => a.id - b.id), [levels]);
  const pendingCountHint = statusFilter === "0" ? total : null;

  type ListOptions = { page?: number; status?: string; levelId?: string; userId?: string };
  type Operation = NonNullable<ReturnType<typeof begin>>;
  async function readList(operation: Operation, opts: ListOptions = {}) {
    const params = new URLSearchParams({
      page: String(opts.page ?? page),
      pageSize: String(pageSize),
    });
    const status = opts.status ?? statusFilter;
    const levelId = opts.levelId ?? levelFilter;
    const userId = (opts.userId ?? activeUserId).trim();
    if (status !== "all") params.set("status", status);
    if (levelId !== "all") params.set("levelId", levelId);
    if (userId) {
      if (!/^\d+$/.test(userId) || !Number.isSafeInteger(Number(userId)) || Number(userId) <= 0)
        throw new Error("User ID must be a positive safe integer.");
      params.set("userId", String(Number(userId)));
    }
    const data = await requestEnvelope<AdminUserLevelApplicationListResult>(
      `/api/admin/user-level-applications?${params.toString()}`,
      operation.signal
    );
    if (!operation.current()) return;
    setItems(data.items);
    setTotal(data.total);
    setPage(data.page);
  }
  async function loadList(opts: ListOptions = {}) {
    const operation = begin("read");
    if (!operation) return;
    setError(null);
    try {
      await readList(operation, opts);
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
    } finally {
      operation.finish();
    }
  }

  function runSearch() {
    if (decisionOperation.current) return;
    const next = userIdInput.trim();
    setActiveUserId(next);
    void loadList({ page: 1, userId: next });
  }

  function openReview(row: AdminUserLevelApplication) {
    if (decisionOperation.current) return;
    setReviewTarget(row);
    setAdminRemark(row.adminRemark ?? "");
    setFormError(null);
    setActing(null);
  }

  function closeReview() {
    if (decisionOperation.current) return;
    setReviewTarget(null);
    setAdminRemark("");
    setFormError(null);
  }

  async function runDecision(decision: "approve" | "reject") {
    if (!reviewTarget || reviewTarget.status !== 0) return;
    const operation = begin();
    if (!operation) return;
    decisionOperation.current = operation;
    setActing(decision);
    setFormError(null);
    setError(null);
    let accepted = false;
    try {
      const remark = adminRemark.trim();
      await mutateApplication(
        `/api/admin/user-level-applications/${reviewTarget.id}/${decision}`,
        remark ? { adminRemark: remark } : {},
        operation.signal
      );
      if (!operation.current()) return;
      accepted = true;
      setReviewTarget(null);
      setAdminRemark("");
      await readList(operation, { page: 1 });
    } catch (err) {
      if (operation.current()) {
        if (accepted) setError(toErrorMessage(err));
        else setFormError(toErrorMessage(err));
      }
    } finally {
      if (decisionOperation.current === operation) {
        decisionOperation.current = null;
        if (operation.current()) setActing(null);
      }
      operation.finish();
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={`${siteLabel} · ${databaseLabel}`}
        icon={<IconChecklist className="size-4" />}
        title="等级申请审批"
        description="审核用户提交的 FD 认证等级申请。通过后写入用户等级关联。"
      />

      <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-4">
          <div className="min-w-[220px] max-w-md flex-1">
            <TextInput
              disabled={Boolean(acting)}
              value={userIdInput}
              placeholder="用户 ID（可选）"
              onChange={(event) => setUserIdInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") runSearch();
              }}
            />
          </div>
          <select
            disabled={Boolean(acting)}
            value={statusFilter}
            aria-label="状态"
            title="状态"
            onChange={(event) => {
              const next = event.target.value;
              setStatusFilter(next);
              void loadList({ page: 1, status: next });
            }}
            className="h-9 min-w-[112px] rounded-md border border-slate-200 bg-white px-2.5 text-[13px] text-slate-800 outline-none focus:border-slate-400"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            disabled={Boolean(acting)}
            value={levelFilter}
            aria-label="等级"
            title="等级"
            onChange={(event) => {
              const next = event.target.value;
              setLevelFilter(next);
              void loadList({ page: 1, levelId: next });
            }}
            className="h-9 min-w-[140px] max-w-[220px] rounded-md border border-slate-200 bg-white px-2.5 text-[13px] text-slate-800 outline-none focus:border-slate-400"
          >
            <option value="all">全部等级</option>
            {levelOptions.map((level) => (
              <option key={level.id} value={String(level.id)}>
                {level.name}
              </option>
            ))}
          </select>
          <Button type="button" size="sm" disabled={loading} onClick={runSearch}>
            <IconSearch className="size-4" />
            {loading ? "查询中" : "搜索"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => void loadList()}
          >
            <IconRefresh className={cn("size-4", loading && "animate-spin")} />
            刷新
          </Button>
          {pendingCountHint !== null ? (
            <span className="ml-auto text-[12px] text-slate-500">
              待审 <span className="font-semibold text-slate-800">{pendingCountHint}</span>
            </span>
          ) : null}
        </div>

        {error ? (
          <div className="border-b border-slate-100 p-4">
            <ErrorBanner message={error} />
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-[13px]">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[12px] text-slate-500">
                <th className="px-4 py-2 font-medium">用户</th>
                <th className="px-4 py-2 font-medium">申请等级</th>
                <th className="px-4 py-2 font-medium">剧组</th>
                <th className="px-4 py-2 font-medium">IP</th>
                <th className="px-4 py-2 font-medium">附件</th>
                <th className="px-4 py-2 font-medium">状态</th>
                <th className="px-4 py-2 font-medium">提交时间</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {items.length > 0 ? (
                items.map((row) => (
                  <tr
                    key={row.id}
                    className={cn(
                      "border-b border-slate-100 last:border-0 hover:bg-slate-50/80",
                      row.status === 0 && "bg-amber-50/30"
                    )}
                  >
                    <td className="px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">
                          {row.userName || "（昵称未知）"}
                        </p>
                        <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                          #{publicUserId(row.userId)}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-800">
                      {row.levelName || `等级 ${row.levelId}`}
                    </td>
                    <td className="px-4 py-2.5">
                      <EntityLink href={row.crewLink} label={row.crewName} />
                    </td>
                    <td className="px-4 py-2.5">
                      <EntityLink href={row.ipLink} label={row.ipName} />
                    </td>
                    <td className="px-4 py-2.5">
                      <AttachmentLink url={row.attachmentUrl} />
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusPill tone={statusTone(row.status)}>
                        {statusLabel(row.status)}
                      </StatusPill>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">
                      {row.createTime ? formatDate(row.createTime) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Button
                        type="button"
                        size="xs"
                        variant={row.status === 0 ? "default" : "outline"}
                        disabled={Boolean(acting)}
                        onClick={() => openReview(row)}
                      >
                        {row.status === 0 ? "审批" : "查看"}
                      </Button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-slate-400">
                    {loading ? "加载中…" : "暂无申请记录"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-[12px] text-slate-500">
          <span>
            共 {total} 条 · 第 {page} / {totalPages} 页
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={loading || page <= 1}
              onClick={() => void loadList({ page: page - 1 })}
            >
              上一页
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={loading || page >= totalPages}
              onClick={() => void loadList({ page: page + 1 })}
            >
              下一页
            </Button>
          </div>
        </div>
      </section>

      <AdminDialog
        open={Boolean(reviewTarget)}
        title={reviewTarget?.status === 0 ? "审批申请" : "申请详情"}
        description={
          reviewTarget
            ? `${reviewTarget.userName || "用户"} · ${reviewTarget.levelName || `等级 ${reviewTarget.levelId}`} · #${reviewTarget.id}`
            : undefined
        }
        onClose={closeReview}
        footer={
          reviewTarget?.status === 0 ? (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={Boolean(acting)}
                onClick={closeReview}
              >
                取消
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={Boolean(acting)}
                onClick={() => void runDecision("reject")}
              >
                {acting === "reject" ? (
                  "驳回中…"
                ) : (
                  <>
                    <IconX className="size-3.5" />
                    驳回
                  </>
                )}
              </Button>
              <Button
                type="button"
                disabled={Boolean(acting)}
                onClick={() => void runDecision("approve")}
              >
                {acting === "approve" ? (
                  "通过中…"
                ) : (
                  <>
                    <IconCheck className="size-3.5" />
                    通过
                  </>
                )}
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" onClick={closeReview}>
              关闭
            </Button>
          )
        }
      >
        {reviewTarget ? (
          <div className="space-y-4 text-[13px]">
            {formError ? <ErrorBanner message={formError} /> : null}

            <div className="flex items-center gap-2">
              <StatusPill tone={statusTone(reviewTarget.status)}>
                {statusLabel(reviewTarget.status)}
              </StatusPill>
              <span className="font-mono text-[11px] text-slate-400">#{reviewTarget.id}</span>
            </div>

            <dl>
              <DetailRow label="用户">
                {reviewTarget.userName || "（昵称未知）"}
                <span className="ml-2 font-mono text-[11px] text-slate-400">
                  {publicUserId(reviewTarget.userId)}
                </span>
              </DetailRow>
              <DetailRow label="申请等级">
                {reviewTarget.levelName || `等级 ${reviewTarget.levelId}`}
              </DetailRow>
              <DetailRow label="剧组">
                <EntityLink href={reviewTarget.crewLink} label={reviewTarget.crewName} />
              </DetailRow>
              <DetailRow label="IP">
                <EntityLink href={reviewTarget.ipLink} label={reviewTarget.ipName} />
              </DetailRow>
              <DetailRow label="附件">
                <AttachmentLink url={reviewTarget.attachmentUrl} />
              </DetailRow>
              <DetailRow label="其它信息">
                <p className="whitespace-pre-wrap text-slate-700">
                  {reviewTarget.extraInfo || "—"}
                </p>
              </DetailRow>
              {reviewTarget.status !== 0 && reviewTarget.adminRemark ? (
                <DetailRow label="审批备注">
                  <p className="whitespace-pre-wrap text-slate-700">{reviewTarget.adminRemark}</p>
                </DetailRow>
              ) : null}
              <DetailRow label="提交时间">
                {reviewTarget.createTime ? formatDate(reviewTarget.createTime) : "—"}
              </DetailRow>
            </dl>

            {reviewTarget.status === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
                <FormLabel label="审批备注（可选）">
                  <Textarea
                    className="mt-0 min-h-20 border-slate-200 bg-white text-sm"
                    value={adminRemark}
                    disabled={Boolean(acting)}
                    placeholder="通过或驳回时可填写原因，会随审批结果保存"
                    onChange={(event) => setAdminRemark(event.target.value)}
                  />
                </FormLabel>
              </div>
            ) : null}
          </div>
        ) : null}
      </AdminDialog>
    </div>
  );
}
