"use client";

import { useAdminOperation } from "../use-admin-operation";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  IconCloudUpload,
  IconCloudOff,
  IconEdit,
  IconPhoto,
  IconPlus,
  IconSearch,
  IconTrash,
  IconVideo,
} from "@tabler/icons-react";
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
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageHeader } from "@/components/admin/page-header";
import { ErrorBanner, Metric, StatusPill, formatDateTime } from "@/components/admin/news/shared";
import {
  COURSE_TYPES,
  courseDisplayCover,
  courseDisplayTitle,
  courseTypeLabel,
  parseCourseType,
  resolveCertificateImageUrl,
  resolveCourseCoverUrl,
  type Course,
} from "@/components/admin/courses/types";
import type { AdminCoursesListData, AdminCoursesStats } from "@/lib/admin-courses";

type PublishedFilter = "all" | "true" | "false";
type TypeFilter = "all" | "1" | "2" | "3";

const INSTRUCTOR_CHIP_TONES = [
  "border-indigo-200 bg-indigo-50 text-indigo-800",
  "border-sky-200 bg-sky-50 text-sky-800",
  "border-violet-200 bg-violet-50 text-violet-800",
  "border-teal-200 bg-teal-50 text-teal-800",
  "border-amber-200 bg-amber-50 text-amber-900",
  "border-rose-200 bg-rose-50 text-rose-800",
] as const;

function instructorChipClass(userId: string, index: number): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return INSTRUCTOR_CHIP_TONES[(hash + index) % INSTRUCTOR_CHIP_TONES.length];
}

async function fetchCoursesList(
  params: {
    q: string;
    published: PublishedFilter;
    type: TypeFilter;
    page: number;
    pageSize: number;
  },
  signal?: AbortSignal
): Promise<AdminCoursesListData> {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.published !== "all") search.set("published", params.published);
  if (params.type !== "all") search.set("type", params.type);
  search.set("page", String(params.page));
  search.set("pageSize", String(params.pageSize));
  const response = await fetch(`/api/admin/courses?${search.toString()}`, { signal });
  const body = (await response.json().catch(() => null)) as
    | AdminCoursesListData
    | { error?: string }
    | null;
  signal?.throwIfAborted();
  if (!response.ok) {
    throw new Error(
      body && "error" in body && body.error ? body.error : `加载失败：${response.status}`
    );
  }
  return body as AdminCoursesListData;
}

export function CoursesListPage({
  siteLabel,
  databaseLabel,
  initialItems,
  initialStats,
  initialTotal,
  loadError,
  initialQ,
  initialPublished,
  initialType,
  initialPage,
  pageSize,
}: {
  siteLabel: string;
  databaseLabel: string;
  initialItems: Course[];
  initialStats: AdminCoursesStats;
  initialTotal: number;
  loadError: string | null;
  initialQ: string;
  initialPublished: PublishedFilter;
  initialType: TypeFilter;
  initialPage: number;
  pageSize: number;
}) {
  const [items, setItems] = useState(initialItems);
  const [stats, setStats] = useState(initialStats);
  const [total, setTotal] = useState(initialTotal);
  const [q, setQ] = useState(initialQ);
  const [searchInput, setSearchInput] = useState(initialQ);
  const [published, setPublished] = useState<PublishedFilter>(initialPublished);
  const [type, setType] = useState<TypeFilter>(initialType);
  const [page, setPage] = useState(initialPage);
  const { busy: loading, begin } = useAdminOperation();
  const [error, setError] = useState<string | null>(loadError);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Course | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [catalogue, setCatalogue] = useState<
    Record<number, { name: string; imagePath: string | null }>
  >({});

  const applyData = useCallback(
    (
      data: AdminCoursesListData,
      next: { q: string; published: PublishedFilter; type: TypeFilter; page: number }
    ) => {
      setItems(data.items);
      setStats(data.stats);
      setTotal(data.total);
      setQ(next.q);
      setPublished(next.published);
      setType(next.type);
      setPage(next.page);
    },
    []
  );
  const reload = useCallback(
    async (next: { q: string; published: PublishedFilter; type: TypeFilter; page: number }) => {
      const operation = begin("read");
      if (!operation) return;
      setError(null);
      try {
        const data = await fetchCoursesList({ ...next, pageSize }, operation.signal);
        if (operation.current()) applyData(data, next);
      } catch (err) {
        if (operation.current())
          setError(err instanceof Error ? err.message : "加载课程列表失败。");
      } finally {
        operation.finish();
      }
    },
    [pageSize, begin, applyData]
  );

  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/admin/user-levels/levels", {
          signal: abort.signal,
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as {
          code?: number;
          data?: Array<{ id?: number; name?: string; imagePath?: string | null }>;
        } | null;
        if (!response.ok || payload?.code !== 200) return;
        const next: Record<number, { name: string; imagePath: string | null }> = {};
        for (const row of payload.data ?? []) {
          if (row.id == null || !row.name) continue;
          next[row.id] = { name: row.name, imagePath: row.imagePath ?? null };
        }
        if (!abort.signal.aborted) setCatalogue(next);
      } catch {
        if (!abort.signal.aborted) setCatalogue({});
      }
    })();
    return () => abort.abort();
  }, []);

  useEffect(() => {
    if (busyId !== null || searchInput === q) return;
    const timer = setTimeout(() => {
      void reload({ q: searchInput, published, type, page: 1 });
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput, q, published, type, reload, busyId]);

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const togglePublish = useCallback(
    async (course: Course) => {
      const operation = begin();
      if (!operation) return;
      setActionError(null);
      setBusyId(course.id);
      try {
        const response = await fetch(`/api/admin/courses/${course.id}/publish`, {
          method: "PATCH",
          signal: operation.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ published: !course.published }),
        });
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!operation.current()) return;
        if (!response.ok) throw new Error(body?.error ?? `操作失败：${response.status}`);
        const next = { q, published, type, page };
        const data = await fetchCoursesList({ ...next, pageSize }, operation.signal);
        if (operation.current()) applyData(data, next);
      } catch (err) {
        if (operation.current())
          setActionError(err instanceof Error ? err.message : "更新发布状态失败。");
      } finally {
        if (operation.current()) setBusyId(null);
        operation.finish();
      }
    },
    [begin, q, published, type, page, pageSize, applyData]
  );

  async function confirmDelete() {
    if (!deleteTarget) return;
    const operation = begin();
    if (!operation) throw new Error("An operation is already in progress.");
    setActionError(null);
    setBusyId(deleteTarget.id);
    try {
      const response = await fetch(`/api/admin/courses/${deleteTarget.id}`, {
        method: "DELETE",
        signal: operation.signal,
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!operation.current()) return;
      if (!response.ok) throw new Error(body?.error ?? `删除失败：${response.status}`);
      setDeleteTarget(null);
      const next = { q, published, type, page };
      const data = await fetchCoursesList({ ...next, pageSize }, operation.signal);
      if (operation.current()) applyData(data, next);
    } catch (err) {
      if (!operation.current()) return;
      setActionError(err instanceof Error ? err.message : "删除失败。");
      throw err;
    } finally {
      if (operation.current()) setBusyId(null);
      operation.finish();
    }
  }

  const columns = useMemo<ColumnDef<Course, unknown>[]>(
    () => [
      {
        accessorKey: "title",
        header: "课程",
        enableSorting: false,
        cell: ({ row }) => {
          const course = row.original;
          const cover = resolveCourseCoverUrl(courseDisplayCover(course));
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
                <p className="truncate text-sm font-semibold text-slate-950">
                  {courseDisplayTitle(course)}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-slate-400">#{course.id}</p>
              </div>
            </div>
          );
        },
      },
      {
        id: "type",
        header: "分类",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-sm text-slate-700">
            {courseTypeLabel(parseCourseType(row.original.type))}
          </span>
        ),
      },
      {
        id: "certificate",
        header: "认证",
        enableSorting: false,
        cell: ({ row }) => {
          const certificateId = row.original.certificateId;
          if (certificateId == null) return <span className="text-sm text-slate-400">—</span>;
          const certificate = catalogue[certificateId] ?? {
            name: `#${certificateId}`,
            imagePath: null,
          };
          const src = resolveCertificateImageUrl(certificate.imagePath);
          return (
            <span className="inline-flex items-center gap-1.5" title={certificate.name}>
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src} alt="" className="size-7 rounded-md object-contain" />
              ) : (
                <span className="grid size-7 place-items-center rounded-md border border-slate-200 bg-slate-50 text-[10px] font-medium text-slate-500">
                  证
                </span>
              )}
            </span>
          );
        },
      },
      {
        accessorKey: "published",
        header: "状态",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.published ? (
            <StatusPill tone="success">已上架</StatusPill>
          ) : (
            <StatusPill tone="muted">未上架</StatusPill>
          ),
      },
      {
        id: "videos",
        header: "视频",
        enableSorting: false,
        cell: ({ row }) => {
          const count = row.original.videoCount ?? row.original.videos.length;
          if (count <= 0) {
            return (
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-400">
                <IconVideo className="size-3.5" />
                无视频
              </span>
            );
          }
          return (
            <span className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-800">
              <IconVideo className="size-3.5 text-slate-600" />
              {count} 集
            </span>
          );
        },
      },
      {
        id: "instructors",
        header: "讲师",
        enableSorting: false,
        cell: ({ row }) => {
          const instructors = row.original.instructors.filter((i) => i.nickName.trim());
          if (instructors.length === 0) {
            return <span className="text-sm text-slate-400">—</span>;
          }
          return (
            <div className="flex max-w-[240px] flex-wrap gap-1">
              {instructors.map((instructor, index) => (
                <span
                  key={instructor.userId}
                  className={`inline-flex max-w-full items-center truncate rounded-full border px-2 py-0.5 text-[11px] font-medium ${instructorChipClass(instructor.userId, index)}`}
                  title={instructor.nickName.trim()}
                >
                  {instructor.nickName.trim()}
                </span>
              ))}
            </div>
          );
        },
      },
      {
        accessorKey: "updateTime",
        header: "更新",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-[12px] text-slate-500">
            {formatDateTime(row.original.updateTime)}
          </span>
        ),
      },
      {
        id: "actions",
        header: "操作",
        enableSorting: false,
        meta: { pin: "right", cellClassName: "w-[280px]" },
        cell: ({ row }) => {
          const course = row.original;
          const busy = busyId !== null;
          return (
            <div className="flex flex-wrap items-center gap-1.5">
              <Button variant="outline" size="sm" asChild>
                <Link href={`/courses/${course.id}/edit`}>
                  <IconEdit className="size-4" />
                  编辑
                </Link>
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void togglePublish(course)}
              >
                {course.published ? (
                  <>
                    <IconCloudOff className="size-4" />
                    下架
                  </>
                ) : (
                  <>
                    <IconCloudUpload className="size-4" />
                    发布
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => setDeleteTarget(course)}
              >
                <IconTrash className="size-4" />
                删除
              </Button>
            </div>
          );
        },
      },
    ],
    [busyId, catalogue, togglePublish]
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="课程管理"
        description={`${siteLabel} · ${databaseLabel}`}
        actions={
          <Button asChild>
            <Link href="/courses/new">
              <IconPlus className="size-4" />
              新建课程
            </Link>
          </Button>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}
      {actionError ? <ErrorBanner message={actionError} /> : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="全部" value={stats.total} />
        <Metric label="已上架" value={stats.published} />
        <Metric label="未上架" value={stats.unpublished} />
        <Metric label="讲师" value={stats.instructors} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              disabled={busyId !== null}
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="按标题搜索…"
              className="pl-8"
            />
          </div>
          <Select
            disabled={busyId !== null}
            value={published}
            onValueChange={(value) => {
              const next = value as PublishedFilter;
              void reload({ q: searchInput, published: next, type, page: 1 });
            }}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="发布状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="true">已上架</SelectItem>
              <SelectItem value="false">未上架</SelectItem>
            </SelectContent>
          </Select>
          <Select
            disabled={busyId !== null}
            value={type}
            onValueChange={(value) => {
              const next = value as TypeFilter;
              void reload({ q: searchInput, published, type: next, page: 1 });
            }}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="课程分类" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部分类</SelectItem>
              {COURSE_TYPES.map((item) => (
                <SelectItem key={item.value} value={String(item.value)}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DataTable
          columns={columns}
          data={items}
          loading={loading}
          minWidth={1040}
          emptyLabel="暂无课程"
        />

        <div className="mt-4 flex items-center justify-between gap-3 text-sm text-slate-500">
          <span>
            共 {total} 门 · 第 {page} / {pageCount} 页
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={loading || page <= 1}
              onClick={() => void reload({ q, published, type, page: page - 1 })}
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={loading || page >= pageCount}
              onClick={() => void reload({ q, published, type, page: page + 1 })}
            >
              下一页
            </Button>
          </div>
        </div>
      </section>

      <ConfirmDialog
        key={deleteTarget?.id ?? "closed"}
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="确认删除课程？"
        description={
          deleteTarget
            ? `将永久删除「${courseDisplayTitle(deleteTarget)}」，不可恢复。仅需下架请用「下架」。`
            : ""
        }
        confirmLabel="删除"
        onConfirm={confirmDelete}
      />
    </div>
  );
}
