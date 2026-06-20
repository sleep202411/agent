"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
import { formatDateTime, Metric, PageHeader, StatusPill } from "./shared";
import { deleteNews, listNews, listNewsTags } from "./news-store";
import {
  isLocaleFilled,
  newsStatusLabel,
  newsStatusTone,
  NEWS_LOCALES,
  NEWS_PRIMARY_LOCALE,
  type NewsArticle,
  type NewsStatus,
} from "./types";

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
}: {
  siteLabel: string;
  databaseLabel: string;
}) {
  const router = useRouter();
  const [items, setItems] = useState<NewsArticle[]>(() => listNews());
  const tags = useMemo(() => listNewsTags(), []);

  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const tagLabel = (id: string) => tags.find((t) => t.id === id)?.label[NEWS_PRIMARY_LOCALE] ?? id;

  const metrics = useMemo(
    () => ({
      total: items.length,
      published: items.filter((n) => n.status === "published").length,
      draft: items.filter((n) => n.status === "draft").length,
      incomplete: items.filter((n) => !isFullyTranslated(n)).length,
    }),
    [items]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((article) => {
      if (kindFilter !== "all" && article.kind !== kindFilter) return false;
      if (statusFilter !== "all" && article.status !== statusFilter) return false;
      if (!q) return true;
      const haystack = [
        article.author,
        article.url,
        ...NEWS_LOCALES.flatMap((l) => [
          article.localized[l.code].title,
          article.localized[l.code].summary,
        ]),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [items, query, kindFilter, statusFilter]);

  function remove(article: NewsArticle) {
    deleteNews(article.id);
    setItems(listNews().slice());
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
                  <img src={cover} alt="" className="size-full object-cover" />
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
              onClick={() => router.push(`/news/${row.original.id}/edit`)}
            >
              编辑
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => remove(row.original)}
              aria-label="删除"
            >
              <IconTrash className="size-3.5" />
            </Button>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tags]
  );

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={`${siteLabel} · ${databaseLabel}`}
        title="新闻资讯"
        description="维护多语言资讯：内部文章走站内详情页，外部链接跳转第三方。简体中文为主语言，其余语言留空则回退到简体。"
      >
        <Button type="button" size="sm" onClick={() => router.push("/news/new")}>
          <IconPlus className="size-4" />
          新建资讯
        </Button>
      </PageHeader>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="全部" value={metrics.total} />
        <Metric label="已发布" value={metrics.published} />
        <Metric label="草稿" value={metrics.draft} />
        <Metric
          label="缺翻译"
          value={metrics.incomplete}
          tone={metrics.incomplete > 0 ? "warn" : "default"}
        />
      </section>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
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
                onClick={() => setKindFilter(tab.value)}
                className={cn(
                  "rounded-md px-3 py-1 text-[13px] font-medium transition",
                  kindFilter === tab.value
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:text-slate-900"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <Select
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as StatusFilter)}
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
        data={filtered}
        minWidth={920}
        pageSize={20}
        emptyLabel={
          query || kindFilter !== "all" || statusFilter !== "all" ? "没有匹配的资讯" : "暂无资讯"
        }
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
