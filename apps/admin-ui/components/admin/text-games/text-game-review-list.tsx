/* eslint-disable @next/next/no-img-element -- Java returns creator-managed media URLs */
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  IconBook2,
  IconChevronRight,
  IconPhoto,
  IconRefresh,
  IconSearch,
} from "@tabler/icons-react";
import type { TextGameSummary } from "@repo/shared/text-game";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  formatTextGameDate,
  requestAdminTextGame,
  TextGameErrorBanner,
  TextGameStatusPill,
  textGameErrorMessage,
} from "./shared";

const TEXT_GAME_ID_PATTERN = /^tg_[A-Za-z0-9]{16}$/;

export function TextGameReviewList({
  siteLabel,
  databaseLabel,
  initialItems,
  initialError,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialItems: TextGameSummary[];
  initialError: string | null;
}) {
  const [items, setItems] = useState(initialItems);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      [item.name, item.synopsis, item.gameId]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLocaleLowerCase().includes(needle))
    );
  }, [items, query]);
  const directGameId = TEXT_GAME_ID_PATTERN.test(query.trim()) ? query.trim() : null;

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setItems(await requestAdminTextGame<TextGameSummary[]>("/api/admin/text-games"));
    } catch (reason) {
      setError(textGameErrorMessage(reason));
    } finally {
      setLoading(false);
    }
  }

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
              审核
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
        description="检查世界观文档、封面、简介、解析角色和剧照，并执行发布审核。"
        icon={<IconBook2 className="size-4" />}
        actions={
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
            <IconRefresh className={cn("size-3.5", loading && "animate-spin")} />
            刷新
          </Button>
        }
      />

      {error ? <TextGameErrorBanner message={error} /> : null}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-950">待审核作品</h3>
            <p className="mt-0.5 text-[12px] text-slate-500">
              {query.trim()
                ? `${filteredItems.length} / ${items.length} 条`
                : `共 ${items.length} 条`}
            </p>
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <div className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
              <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索名称、简介或作品 ID"
                aria-label="搜索待审核文游"
                className="h-8 pl-8"
              />
            </div>
            {directGameId ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/ip/text-games/${encodeURIComponent(directGameId)}`}>打开作品</Link>
              </Button>
            ) : null}
          </div>
        </div>
        <DataTable
          columns={columns}
          data={filteredItems}
          loading={loading}
          minWidth={960}
          pageSize={20}
          getRowId={(row) => row.gameId}
          emptyLabel={query.trim() ? "没有匹配的待审核文游" : "暂无待审核文游"}
          className="rounded-none border-0"
        />
      </section>
    </div>
  );
}
