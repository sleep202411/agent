/* eslint-disable @next/next/no-img-element -- Java returns creator-managed media URLs */
"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  IconBook2,
  IconChevronRight,
  IconPhoto,
  IconRefresh,
  IconSearch,
} from "@tabler/icons-react";
import type { TextGameAdminStats, TextGameSummary } from "@repo/shared/text-game";
import type { AdminTextGameStatusFilter } from "@/lib/admin-text-games";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatTextGameDate, TextGameErrorBanner, TextGameStatusPill } from "./shared";

const TEXT_GAME_ID_PATTERN = /^tg_[A-Za-z0-9]{16}$/;

export function TextGameReviewList({
  siteLabel,
  databaseLabel,
  items,
  stats,
  total,
  status,
  q,
  page,
  pageSize,
  loadError,
}: {
  siteLabel: string;
  databaseLabel: string;
  items: TextGameSummary[];
  stats: TextGameAdminStats | null;
  total: number;
  status: AdminTextGameStatusFilter;
  q: string;
  page: number;
  pageSize: number;
  loadError: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [refreshing, startRefresh] = useTransition();
  const [searchInput, setSearchInput] = useState(q);
  const [syncedQuery, setSyncedQuery] = useState(q);

  if (q !== syncedQuery) {
    setSyncedQuery(q);
    setSearchInput(q);
  }

  const pushFilters = useCallback(
    (next: Partial<{ status: string; q: string; page: string }>) => {
      const merged = {
        status: next.status ?? status,
        q: next.q ?? q,
        page: next.page ?? "1",
      };
      const params = new URLSearchParams();
      if (merged.status !== "all") params.set("status", merged.status);
      if (merged.q) params.set("q", merged.q);
      if (merged.page !== "1") params.set("page", merged.page);
      const queryString = params.toString();
      router.push(queryString ? `${pathname}?${queryString}` : pathname);
    },
    [pathname, q, router, status]
  );

  useEffect(() => {
    if (searchInput === q) return;
    const timer = setTimeout(() => pushFilters({ q: searchInput.trim(), page: "1" }), 400);
    return () => clearTimeout(timer);
  }, [pushFilters, q, searchInput]);

  const directGameId = TEXT_GAME_ID_PATTERN.test(searchInput.trim()) ? searchInput.trim() : null;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const columns = useMemo<ColumnDef<TextGameSummary, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: "作品",
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div className="flex min-w-0 items-start gap-3">
              <div className="grid h-[66px] w-11 shrink-0 place-items-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                {item.posterUrl ? (
                  <img src={item.posterUrl} alt="" className="size-full object-cover" />
                ) : (
                  <IconPhoto className="size-4 text-slate-300" />
                )}
              </div>
              <div className="min-w-0 pt-0.5">
                <p className="max-w-[300px] truncate text-sm font-medium text-slate-950">
                  {item.name || "未命名文游"}
                </p>
                <p className="mt-1 font-mono text-[11px] text-slate-500">{item.gameId}</p>
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "synopsis",
        header: "简介",
        enableSorting: false,
        cell: ({ row }) => (
          <p className="max-w-[420px] line-clamp-2 text-[13px] leading-5 text-slate-600">
            {row.original.synopsis || "未填写简介"}
          </p>
        ),
      },
      {
        accessorKey: "status",
        header: "状态",
        cell: ({ row }) => <TextGameStatusPill status={row.original.status} />,
      },
      {
        accessorKey: "updatedAt",
        header: "更新时间",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-[12px] tabular-nums text-slate-600">
            {formatTextGameDate(row.original.updatedAt)}
          </span>
        ),
      },
      {
        id: "actions",
        header: "操作",
        enableSorting: false,
        meta: { pin: "right" },
        cell: ({ row }) => (
          <Button asChild variant="outline" size="sm">
            <Link href={`/ip/text-games/${encodeURIComponent(row.original.gameId)}`}>
              {row.original.status === "reviewing" ? "审核" : "查看"}
              <IconChevronRight className="size-3.5" />
            </Link>
          </Button>
        ),
      },
    ],
    []
  );

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={`${siteLabel} · ${databaseLabel}`}
        title="文游审核"
        description="查看全部文游状态，检查当前草稿版本，并处理发布、驳回和强制下架。"
        icon={<IconBook2 className="size-4" />}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => startRefresh(() => router.refresh())}
            disabled={refreshing}
          >
            <IconRefresh className={cn("size-3.5", refreshing && "animate-spin")} />
            刷新
          </Button>
        }
      />

      {loadError ? <TextGameErrorBanner message={loadError} /> : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <TextGameMetric label="全部" value={stats?.total} />
        <TextGameMetric label="草稿" value={stats?.draft} />
        <TextGameMetric label="审核中" value={stats?.reviewing} tone="warn" />
        <TextGameMetric label="已发布" value={stats?.published} tone="success" />
        <TextGameMetric label="已下架" value={stats?.offline} tone="risk" />
      </section>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex w-full items-center gap-2 sm:max-w-md">
          <div className="relative min-w-0 flex-1">
            <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="搜索名称、简介、作品 ID 或数字主键"
              aria-label="搜索文游作品"
              className="h-9 pl-8"
            />
          </div>
          {directGameId ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/ip/text-games/${encodeURIComponent(directGameId)}`}>打开</Link>
            </Button>
          ) : null}
        </div>
        <Select value={status} onValueChange={(value) => pushFilters({ status: value, page: "1" })}>
          <SelectTrigger className="h-9 w-full sm:w-[140px]" aria-label="作品状态筛选">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="draft">草稿</SelectItem>
            <SelectItem value="reviewing">审核中</SelectItem>
            <SelectItem value="published">已发布</SelectItem>
            <SelectItem value="offline">已下架</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={items}
        loading={refreshing}
        minWidth={960}
        getRowId={(row) => row.gameId}
        emptyLabel={q || status !== "all" ? "没有匹配的文游作品" : "暂无文游作品"}
      />

      {total > pageSize ? (
        <div className="flex items-center justify-between gap-3 text-[12px] text-slate-500">
          <span>
            第 {page} / {pageCount} 页 · 共 {total} 条
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => pushFilters({ page: String(page - 1) })}
            >
              上一页
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page >= pageCount}
              onClick={() => pushFilters({ page: String(page + 1) })}
            >
              下一页
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TextGameMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number | undefined;
  tone?: "default" | "warn" | "success" | "risk";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2",
        tone === "default" && "border-slate-200 bg-slate-50",
        tone === "warn" && "border-amber-200 bg-amber-50",
        tone === "success" && "border-emerald-200 bg-emerald-50",
        tone === "risk" && "border-red-200 bg-red-50"
      )}
    >
      <p
        className={cn(
          "text-[11px] font-medium",
          tone === "default" && "text-slate-500",
          tone === "warn" && "text-amber-700",
          tone === "success" && "text-emerald-700",
          tone === "risk" && "text-red-600"
        )}
      >
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold tracking-tight text-slate-950">{value ?? "—"}</p>
    </div>
  );
}
