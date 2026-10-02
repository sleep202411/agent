/* eslint-disable @next/next/no-img-element -- Java returns creator-managed media URLs */
"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  IconChevronRight,
  IconDeviceGamepad2,
  IconPhoto,
  IconRefresh,
  IconSearch,
} from "@tabler/icons-react";
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
import type {
  AdminInteractiveFilmStats,
  AdminInteractiveFilmStatusFilter,
  AdminInteractiveFilmSummary,
} from "@/lib/interactive-film-admin-contract";
import { cn } from "@/lib/utils";
import {
  HlsDistributionCell,
  HlsDistributionError,
  useHlsDistribution,
} from "./playback/hls-distribution-cell";
import {
  formatInteractiveFilmDate,
  InteractiveFilmErrorBanner,
  InteractiveFilmMetric,
  InteractiveFilmStatusPill,
} from "./shared";

export function InteractiveFilmReviewList({
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
  hlsEnabled,
}: {
  siteLabel: string;
  databaseLabel: string;
  items: AdminInteractiveFilmSummary[];
  stats: AdminInteractiveFilmStats | null;
  total: number;
  status: AdminInteractiveFilmStatusFilter;
  q: string;
  page: number;
  pageSize: number;
  loadError: string | null;
  /** HLS distribution exists only on the cn site; the column reads it client-side. */
  hlsEnabled: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [refreshing, startRefresh] = useTransition();
  const [searchInput, setSearchInput] = useState(q);
  const [syncedQuery, setSyncedQuery] = useState(q);
  const {
    games: hlsGames,
    generatedAt: hlsGeneratedAt,
    loading: hlsLoading,
    error: hlsError,
  } = useHlsDistribution(hlsEnabled ? items : null);

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

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const columns = useMemo<ColumnDef<AdminInteractiveFilmSummary, unknown>[]>(() => {
    const hlsColumn: ColumnDef<AdminInteractiveFilmSummary, unknown> = {
      id: "hls",
      header: "HLS",
      enableSorting: false,
      cell: ({ row }) => (
        <HlsDistributionCell
          game={hlsGames.get(row.original.gameId)}
          generatedAt={hlsGeneratedAt}
          loading={hlsLoading}
        />
      ),
    };
    return [
      {
        accessorKey: "title",
        header: "作品",
        cell: ({ row }) => {
          const item = row.original;
          return (
            <div className="flex min-w-0 items-start gap-3">
              <div className="grid h-[63px] w-28 shrink-0 place-items-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                {item.coverUrl ? (
                  <img
                    src={item.coverUrl}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="size-full object-cover"
                  />
                ) : (
                  <IconPhoto className="size-4 text-slate-300" />
                )}
              </div>
              <div className="min-w-0 pt-0.5">
                <p className="max-w-[280px] truncate text-sm font-medium text-slate-950">
                  {item.title}
                </p>
                <p className="mt-1 max-w-[280px] truncate text-[12px] text-slate-500">
                  {item.subtitle || "未填写副标题"}
                </p>
                <p className="mt-1 max-w-[280px] truncate font-mono text-[10px] text-slate-400">
                  {item.gameId}
                </p>
              </div>
            </div>
          );
        },
      },
      {
        id: "versions",
        header: "版本",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="space-y-1 font-mono text-[11px] text-slate-600">
            <p className="max-w-[220px] truncate" title={row.original.draftVersion ?? undefined}>
              待审 · {row.original.draftVersion ?? "-"}
            </p>
            <p className="max-w-[220px] truncate" title={row.original.currentVersion ?? undefined}>
              线上 · {row.original.currentVersion ?? "-"}
            </p>
          </div>
        ),
      },
      {
        accessorKey: "status",
        header: "状态",
        cell: ({ row }) => <InteractiveFilmStatusPill status={row.original.status} />,
      },
      ...(hlsEnabled ? [hlsColumn] : []),
      {
        accessorKey: "updatedAt",
        header: "更新时间",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-[12px] tabular-nums text-slate-600">
            {formatInteractiveFilmDate(row.original.updatedAt)}
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
            <Link href={`/ip/interactive-films/${encodeURIComponent(row.original.gameId)}`}>
              {row.original.status === "reviewing" ? "审核" : "查看"}
              <IconChevronRight className="size-3.5" />
            </Link>
          </Button>
        ),
      },
    ];
  }, [hlsEnabled, hlsGames, hlsGeneratedAt, hlsLoading]);

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={`${siteLabel} · ${databaseLabel}`}
        title="影游审核"
        description="查看影游发布状态，核验待审版本与 Manifest，并处理通过、驳回和强制下架。"
        icon={<IconDeviceGamepad2 className="size-4" />}
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

      {loadError ? <InteractiveFilmErrorBanner message={loadError} /> : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <InteractiveFilmMetric label="全部" value={stats?.total} />
        <InteractiveFilmMetric label="草稿" value={stats?.draft} />
        <InteractiveFilmMetric label="审核中" value={stats?.reviewing} tone="warn" />
        <InteractiveFilmMetric label="已发布" value={stats?.published} tone="success" />
        <InteractiveFilmMetric label="已下架" value={stats?.offline} tone="risk" />
      </section>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-md">
          <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="搜索标题、副标题或作品 ID"
            aria-label="搜索影游作品"
            className="h-9 pl-8"
          />
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

      {hlsError ? <HlsDistributionError message={hlsError} /> : null}

      <DataTable
        columns={columns}
        data={items}
        loading={refreshing}
        minWidth={hlsEnabled ? 1080 : 960}
        getRowId={(row) => row.gameId}
        emptyLabel={q || status !== "all" ? "没有匹配的影游作品" : "暂无影游作品"}
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
