"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdminOperation } from "../use-admin-operation";
import { adminUiApiPath } from "@/lib/admin-api";
import { usePathname, useRouter } from "next/navigation";
import { IconExternalLink, IconPhoto, IconPlus, IconSearch, IconTrash } from "@tabler/icons-react";
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
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorBanner, formatDateTime, Metric, PageHeader, StatusPill } from "./shared";
import {
  isLocaleFilled,
  newsStatusLabel,
  newsStatusTone,
  NEWS_LOCALES,
  NEWS_PRIMARY_LOCALE,
  resolveCoverUrl,
  type NewsArticle,
  type NewsStatus,
  type NewsTag,
} from "./types";
import type { AdminNewsStats } from "@/lib/admin-news";

const KIND_TABS = [
  { value: "all", label: "全部" },
  { value: "article", label: "内部文章" },
  { value: "external", label: "外部链接" },
] as const;

type KindFilter = (typeof KIND_TABS)[number]["value"];
type StatusFilter = "all" | NewsStatus;

export function NewsListPage({
  siteLabel,
  databaseLabel,
  items,
  stats,
  total,
  tags,
  loadError,
  kind,
  status,
  q,
  page,
  pageSize,
}: {
  siteLabel: string;
  databaseLabel: string;
  items: NewsArticle[];
  stats: AdminNewsStats | null;
  total: number;
  tags: NewsTag[];
  loadError: string | null;
  kind: KindFilter;
  status: StatusFilter;
  q: string;
  page: number;
  pageSize: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { busy, begin } = useAdminOperation();
  const pending = useRef<ReturnType<typeof begin>>(null);
  const navigate = useCallback(
    (url: string) => {
      pending.current?.cancel();
      pending.current?.finish();
      router.push(url);
    },
    [router]
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<NewsArticle | null>(null);

  // Keyword input is local (for debounce); the committed value lives in the URL (q).
  // Sync to q on external changes (back/forward nav) via the guarded
  // adjust-state-during-render pattern — not an effect (avoids a wasted commit).
  const [searchInput, setSearchInput] = useState(q);
  const [syncedQ, setSyncedQ] = useState(q);
  if (q !== syncedQ) {
    setSyncedQ(q);
    setSearchInput(q);
  }

  const tagLabel = (id: string) => tags.find((t) => t.id === id)?.label[NEWS_PRIMARY_LOCALE] ?? id;

  const metrics = useMemo(
    () =>
      stats ?? {
        total: items.length,
        published: items.filter((n) => n.status === "published").length,
        draft: items.filter((n) => n.status === "draft").length,
        incompleteTranslation: items.filter((n) => !isFullyTranslated(n)).length,
      },
    [items, stats]
  );

  // Filters + pagination are server-driven via URL searchParams — the App Router
  // re-runs the server component on push. No client-side filtering.
  const pushFilters = useCallback(
    (next: Partial<{ kind: string; status: string; q: string; page: string }>) => {
      const params = new URLSearchParams();
      const merged = {
        kind: next.kind ?? kind,
        status: next.status ?? status,
        q: next.q ?? q,
        page: next.page ?? "1",
      };
      if (merged.kind && merged.kind !== "all") params.set("kind", merged.kind);
      if (merged.status && merged.status !== "all") params.set("status", merged.status);
      if (merged.q) params.set("q", merged.q);
      if (merged.page && merged.page !== "1") params.set("page", merged.page);
      const queryString = params.toString();
      setDeleteTarget(null);
      navigate(queryString ? `${pathname}?${queryString}` : pathname);
    },
    [kind, status, q, pathname, navigate]
  );

  // Debounce keyword → URL (resets to page 1); skip when unchanged.
  useEffect(() => {
    if (searchInput === q) return;
    const timer = setTimeout(() => pushFilters({ q: searchInput, page: "1" }), 400);
    return () => clearTimeout(timer);
  }, [searchInput, q, pushFilters]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  async function confirmDelete() {
    if (!deleteTarget) return;
    const operation = begin();
    if (!operation) return;
    pending.current = operation;
    setActionError(null);
    try {
      const response = await fetch(
        adminUiApiPath(`/api/admin/news/${encodeURIComponent(deleteTarget.id)}`),
        { method: "DELETE", signal: operation.signal }
      );
      if (!operation.current()) return;
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!operation.current()) return;
        throw new Error(body?.error ?? `删除失败：${response.status}`);
      }
      router.refresh();
    } catch (error) {
      if (operation.current()) {
        setActionError(error instanceof Error ? error.message : "删除失败。");
        throw error;
      }
    } finally {
      operation.finish();
    }
  }

  const columns = useMemo<ColumnDef<NewsArticle, unknown>[]>(
    () => [
      {
        accessorKey: "title",
        header: "资讯",
        cell: ({ row }) => {
          const article = row.original;
          const cover = primaryCover(article);
          return (
            <div className="flex min-w-0 items-start gap-3">
              <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
                {cover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={resolveCoverUrl(cover)} alt="" className="size-full object-cover" />
                ) : (
                  <IconPhoto className="size-4 text-slate-300" />
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-950">
                  {resolveTitle(article)}
                </p>
                <p className="mt-0.5 truncate text-[12px] text-slate-500">
                  {article.author || "未署名"}
                </p>
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "kind",
        header: "类型",
        cell: ({ row }) => {
          const article = row.original;
          if (article.kind === "external") {
            return (
              <a
                href={article.url || undefined}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => event.stopPropagation()}
                className="inline-flex max-w-[200px] items-center gap-1 truncate text-[12px] text-sky-700 hover:underline"
                title={article.url}
              >
                <IconExternalLink className="size-3.5 shrink-0" />
                <span className="truncate">{externalHost(article.url)}</span>
              </a>
            );
          }
          return (
            <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[12px] font-medium text-slate-600">
              内部文章
            </span>
          );
        },
      },
      {
        id: "locales",
        header: "多语言",
        enableSorting: false,
        cell: ({ row }) => <LocaleChips article={row.original} />,
      },
      {
        id: "tags",
        header: "标签",
        enableSorting: false,
        cell: ({ row }) => {
          const ids = row.original.tagIds;
          if (ids.length === 0) return <span className="text-slate-300">—</span>;
          return (
            <div className="flex flex-wrap gap-1">
              {ids.slice(0, 2).map((id) => (
                <span
                  key={id}
                  className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600"
                >
                  {tagLabel(id)}
                </span>
              ))}
              {ids.length > 2 ? (
                <span className="text-[11px] text-slate-400">+{ids.length - 2}</span>
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: "status",
        header: "状态",
        cell: ({ row }) => (
          <StatusPill tone={newsStatusTone(row.original.status)}>
            {newsStatusLabel(row.original.status)}
          </StatusPill>
        ),
      },
      {
        accessorKey: "publishedAt",
        header: "发布时间",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-[12px] tabular-nums text-slate-600">
            {formatDateTime(row.original.publishedAt)}
          </span>
        ),
      },
      {
        id: "actions",
        header: "操作",
        enableSorting: false,
        meta: { pin: "right" },
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => navigate(`/news/${encodeURIComponent(row.original.id)}/edit`)}
            >
              编辑
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setDeleteTarget(row.original)}
              aria-label="删除"
            >
              <IconTrash className="size-3.5" />
            </Button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tags, busy, navigate]
  );

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={`${siteLabel} · ${databaseLabel}`}
        title="新闻资讯"
        description="维护多语言资讯：内部文章走站内详情页，外部链接跳转第三方。简体中文为主语言，其余语言留空则回退到简体。"
      >
        <Button type="button" size="sm" onClick={() => navigate("/news/new")}>
          <IconPlus className="size-4" />
          新建资讯
        </Button>
      </PageHeader>

      {loadError ? <ErrorBanner message={`资讯服务暂不可用：${loadError}`} /> : null}
      {actionError ? <ErrorBanner message={actionError} /> : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="全部" value={metrics.total} />
        <Metric label="已发布" value={metrics.published} />
        <Metric label="草稿" value={metrics.draft} />
        <Metric
          label="缺翻译"
          value={metrics.incompleteTranslation}
          tone={metrics.incompleteTranslation > 0 ? "warn" : "default"}
        />
      </section>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="搜索标题、摘要、作者或链接"
            className="h-9 pl-8"
            aria-label="搜索资讯"
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            {KIND_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => pushFilters({ kind: tab.value, page: "1" })}
                className={cn(
                  "rounded-md px-3 py-1 text-[13px] font-medium transition",
                  kind === tab.value
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:text-slate-900"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <Select
            value={status}
            onValueChange={(value) => pushFilters({ status: value, page: "1" })}
          >
            <SelectTrigger className="h-9 w-[120px]" aria-label="状态筛选">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="published">已发布</SelectItem>
              <SelectItem value="draft">草稿</SelectItem>
              <SelectItem value="offline">已下线</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={items}
        minWidth={920}
        emptyLabel={q || kind !== "all" || status !== "all" ? "没有匹配的资讯" : "暂无资讯"}
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

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="删除资讯"
        description={
          deleteTarget ? `确定删除「${resolveTitle(deleteTarget)}」？此操作不可恢复。` : undefined
        }
        confirmLabel="删除"
        destructive
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function LocaleChips({ article }: { article: NewsArticle }) {
  return (
    <div className="flex gap-1">
      {NEWS_LOCALES.map((locale) => {
        const filled = isLocaleFilled(article.localized[locale.code], article.kind);
        return (
          <span
            key={locale.code}
            title={filled ? locale.label : `${locale.label} · 缺翻译`}
            className={cn(
              "inline-flex h-5 min-w-[26px] items-center justify-center rounded px-1 text-[11px] font-medium",
              filled ? "bg-slate-100 text-slate-700" : "bg-slate-50 text-slate-300 line-through"
            )}
          >
            {locale.short}
          </span>
        );
      })}
    </div>
  );
}

function isFullyTranslated(article: NewsArticle): boolean {
  return NEWS_LOCALES.every((locale) =>
    isLocaleFilled(article.localized[locale.code], article.kind)
  );
}

function resolveTitle(article: NewsArticle): string {
  const primary = article.localized[NEWS_PRIMARY_LOCALE].title.trim();
  if (primary) return primary;
  for (const locale of NEWS_LOCALES) {
    const title = article.localized[locale.code].title.trim();
    if (title) return title;
  }
  return "（未命名）";
}

function primaryCover(article: NewsArticle): string {
  const primary = article.localized[NEWS_PRIMARY_LOCALE].coverUrl.trim();
  if (primary) return primary;
  for (const locale of NEWS_LOCALES) {
    const cover = article.localized[locale.code].coverUrl.trim();
    if (cover) return cover;
  }
  return "";
}

function externalHost(url: string): string {
  if (!url) return "外部链接";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
