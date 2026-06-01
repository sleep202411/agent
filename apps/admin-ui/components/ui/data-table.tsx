"use client";

/**
 * Generic admin DataTable — TanStack Table (headless) + shadcn <Table> primitives.
 *
 * The single standardized table surface for the admin console. Every admin
 * list (IP, billing, users, audit, …) renders through this so behavior is
 * uniform: client-side sorting, optional pagination, a pinned (sticky) action
 * column, horizontal scroll for wide tables, and consistent empty/loading rows.
 *
 * Usage:
 *   const columns: ColumnDef<Row>[] = [
 *     { accessorKey: "title", header: "IP", cell: ({ row }) => <…/> },
 *     { id: "actions", header: "操作", cell: ({ row }) => <Button…/>, meta: { pin: "right" } },
 *   ];
 *   <DataTable columns={columns} data={rows} loading={loading} minWidth={1180} />
 *
 * Pin a column to the right (stays visible while scrolling) via
 * `meta: { pin: "right" }` on its ColumnDef. Set `enableSorting: false` on a
 * column to opt it out of sort (action/pill columns).
 */

import * as React from "react";
import {
  type ColumnDef,
  type RowData,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { IconChevronDown, IconChevronUp, IconLoader2, IconSelector } from "@tabler/icons-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Per-column admin metadata (TanStack merges this into column.columnDef.meta).
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Pin the column so it stays visible during horizontal scroll. */
    pin?: "right";
    /** Extra className applied to both <th> and <td> of this column. */
    cellClassName?: string;
  }
}

const PINNED_CELL = "sticky right-0 z-10 bg-white";
const PINNED_HEAD = "sticky right-0 z-20 bg-slate-50";

export interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  /** Show a loading skeleton row instead of empty state. */
  loading?: boolean;
  /** Min table width (px) before horizontal scroll kicks in. */
  minWidth?: number;
  /** Empty-state label. */
  emptyLabel?: string;
  /** Enable client-side pagination at this page size (omit = no pagination). */
  pageSize?: number;
  /** Stable row id (defaults to `id` field if present). */
  getRowId?: (row: TData, index: number) => string;
  className?: string;
}

export function DataTable<TData>({
  columns,
  data,
  loading = false,
  minWidth,
  emptyLabel = "暂无数据",
  pageSize,
  getRowId,
  className,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    ...(pageSize
      ? {
          getPaginationRowModel: getPaginationRowModel(),
          initialState: { pagination: { pageSize } },
        }
      : {}),
    getRowId:
      getRowId ??
      ((row, index) => {
        const maybe = (row as { id?: unknown }).id;
        return typeof maybe === "string" || typeof maybe === "number"
          ? String(maybe)
          : String(index);
      }),
  });

  const colCount = columns.length;
  const rows = table.getRowModel().rows;

  // Non-destructive loading: a full-body "加载中…" row only on the initial load
  // (no rows yet). On in-place refresh (rows already present) we keep the rows
  // and dim them under an overlay instead of wiping the table.
  const initialLoading = loading && rows.length === 0;
  const refreshing = loading && rows.length > 0;

  return (
    <div className={cn("overflow-hidden rounded-xl border border-slate-200 bg-white", className)}>
      <div className="relative overflow-x-auto" aria-busy={loading}>
        {refreshing ? (
          <div className="pointer-events-none absolute inset-0 z-30 flex items-start justify-center bg-white/40">
            <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium text-slate-500 shadow-sm">
              <IconLoader2 className="size-3.5 animate-spin" />
              刷新中…
            </span>
          </div>
        ) : null}
        <Table
          className="border-separate border-spacing-0 text-left"
          style={minWidth ? { minWidth } : undefined}
        >
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => {
                  const pinned = header.column.columnDef.meta?.pin === "right";
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      className={cn(
                        "h-auto border-b border-slate-200 bg-slate-50 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500",
                        header.column.columnDef.meta?.cellClassName,
                        pinned && PINNED_HEAD
                      )}
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="inline-flex items-center gap-1 uppercase tracking-[0.08em] transition hover:text-slate-900"
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === "asc" ? (
                            <IconChevronUp className="size-3" />
                          ) : sorted === "desc" ? (
                            <IconChevronDown className="size-3" />
                          ) : (
                            <IconSelector className="size-3 text-slate-300" />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {initialLoading ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={colCount}
                  className="px-4 py-12 text-center text-sm text-slate-400"
                >
                  加载中…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={colCount}
                  className="px-4 py-12 text-center text-sm text-slate-500"
                >
                  {emptyLabel}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id} className="group transition hover:bg-slate-50/60">
                  {row.getVisibleCells().map((cell) => {
                    const pinned = cell.column.columnDef.meta?.pin === "right";
                    return (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          "border-b border-slate-100 px-3 py-3 align-top text-sm text-slate-700",
                          cell.column.columnDef.meta?.cellClassName,
                          pinned && cn(PINNED_CELL, "group-hover:bg-slate-50")
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {pageSize && rows.length > 0 ? (
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-2.5 text-[12px] text-slate-500">
          <span>
            第 {table.getState().pagination.pageIndex + 1} / {table.getPageCount()} 页 · 共{" "}
            {table.getRowCount()} 条
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              上一页
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              下一页
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export type { ColumnDef } from "@tanstack/react-table";
