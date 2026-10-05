"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { defaultRangeExtractor, useVirtualizer, type Range } from "@tanstack/react-virtual";
import { IconLayoutList, IconPlus } from "@tabler/icons-react";
import { useProjectUIStore } from "@/app/[locale]/project/_stores/project-ui-store";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  STORYBOARD_COLUMNS,
  STORYBOARD_ESTIMATED_ROW_HEIGHT,
  STORYBOARD_GRID_TEMPLATE,
  STORYBOARD_TABLE_WIDTH,
  STORYBOARD_OVERSCAN,
  STORYBOARD_ROW_RULE,
  storyboardCellStyle,
  storyboardHeadClass,
} from "./storyboard-columns";
import { StoryboardPlayback } from "./storyboard-playback";
import { StoryboardRow } from "./storyboard-row";
import type { StoryboardRowActions } from "./storyboard-types";
import { useStoryboard } from "./use-storyboard";
import { useGridNavigation, type NavDirection } from "./use-grid-navigation";

const HIGHLIGHT_MS = 2000;

/**
 * "Don't ask again" for shot deletion — a per-browser preference, read at the
 * moment of the click rather than cached, so answering in one tab is honoured
 * in the others. Storage being unavailable (private mode, blocked) means the
 * dialog simply keeps asking, which is the safe direction to fail in.
 */
const SKIP_DELETE_CONFIRM_KEY = "fizzstudio.storyboard.skipDeleteConfirm";

function readSkipDeleteConfirm(): boolean {
  try {
    return window.localStorage.getItem(SKIP_DELETE_CONFIRM_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSkipDeleteConfirm() {
  try {
    window.localStorage.setItem(SKIP_DELETE_CONFIRM_KEY, "1");
  } catch {
    /* preference lost, the dialog keeps asking — no reason to fail the delete */
  }
}

/**
 * The storyboard: every `shot` node of the project canvas as a row, ordered by
 * its fractional key. Editing a cell, inserting a row or dragging one to a new
 * position are all ordinary canvas writes — there is no storyboard document to
 * keep in sync, which is the whole point of the projection.
 *
 * Rows are virtualized, which forces two things that are easy to get wrong:
 *   • rows are absolutely positioned, so column alignment comes from ONE shared
 *     grid track list rather than table layout (see storyboard-columns.ts);
 *   • the row being dragged is kept mounted even after it leaves the virtual
 *     window, or the gesture dies mid-drag — hence the rendered set is the
 *     virtual window UNION the active row.
 */
export function StoryboardTable({
  focusRowId,
  onOpenOnCanvas,
}: {
  /** Row to scroll to and flash, from the canvas's "open in storyboard". */
  focusRowId: string | null;
  onOpenOnCanvas: (nodeId: string) => void;
}) {
  const t = useTranslations("storyboard");
  const tCommon = useTranslations("common");
  const selectShot = useProjectUIStore((s) => s.selectShot);
  const selectedShotId = useProjectUIStore((s) => s.selectedShotId);
  const closeShotDrawer = useProjectUIStore((s) => s.closeShotDrawer);
  const { rows, canEdit, insertShot, patchShot, deleteShot, moveShotToIndex } = useStoryboard();

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [skipNextTime, setSkipNextTime] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const focusedRef = useRef<string | null>(null);

  const rowIds = useMemo(() => rows.map((row) => row.id), [rows]);
  const activeIndex = activeId ? rowIds.indexOf(activeId) : -1;

  // Keep the dragged row in the rendered range even after it scrolls out of
  // view: an unmounted element ends the gesture, and a storyboard drag crosses
  // the whole viewport by definition.
  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range);
      if (activeIndex >= 0 && !indexes.includes(activeIndex)) {
        return [...indexes, activeIndex].sort((left, right) => left - right);
      }
      return indexes;
    },
    [activeIndex]
  );

  // TanStack Virtual returns live methods that read mutable internal state, which
  // the React Compiler lint flags as unsafe to memoize. The compiler is NOT
  // enabled in this app; if it is ever turned on, this component needs a
  // `"use no memo"` directive — silently memoizing it would freeze the window.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => STORYBOARD_ESTIMATED_ROW_HEIGHT,
    overscan: STORYBOARD_OVERSCAN,
    rangeExtractor,
    // Keyed by shot id, so inserting or reordering re-associates measured
    // heights with the right shot instead of shifting the whole cache by one.
    getItemKey: (index) => rows[index]?.id ?? index,
  });

  // Excel-style grid navigation: Tab/Enter/Esc move focus between editable cells.
  const { pendingFocus, moveFocus, resolvePendingFocus } = useGridNavigation({
    rowCount: rows.length,
    scrollToIndex: (idx, opts) =>
      virtualizer.scrollToIndex(idx, opts as { align?: "start" | "center" | "end" }),
  });

  const virtualItems = virtualizer.getVirtualItems();

  // After virtual items render, resolve any pending focus (target row was outside the virtual window).
  useEffect(() => {
    resolvePendingFocus(rowIds);
  }, [resolvePendingFocus, rowIds, pendingFocus, virtualItems]);

  const handleNavigate = useCallback(
    (rowIndex: number, columnKey: string, direction: NavDirection) => {
      moveFocus(direction, rowIndex, columnKey, rowIds);
    },
    [moveFocus, rowIds]
  );

  const sensors = useSensors(
    // A few pixels of slop, so clicking into a cell is never read as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Arriving from the canvas: scroll that shot's row into view and flash it once.
  // The row may not be mounted, so this goes through the virtualizer's index
  // rather than a DOM ref.
  useEffect(() => {
    if (!focusRowId || focusedRef.current === focusRowId) return;
    const index = rowIds.indexOf(focusRowId);
    if (index < 0) return;
    focusedRef.current = focusRowId;
    virtualizer.scrollToIndex(index, { align: "center", behavior: "smooth" });
    setHighlightId(focusRowId);
  }, [focusRowId, rowIds, virtualizer]);

  // Fade the flash on its own clock — tying it to the effect above would let a
  // concurrent edit (which re-runs that effect) cancel the timer and leave the
  // row highlighted forever.
  useEffect(() => {
    if (!highlightId) return;
    const timer = window.setTimeout(() => setHighlightId(null), HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [highlightId]);

  const onDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const target = rowIds.indexOf(String(over.id));
      if (target < 0) return;
      moveShotToIndex(String(active.id), target);
    },
    [moveShotToIndex, rowIds]
  );

  // Deleting a shot cascades its wires and this mode has no undo, so it asks
  // first — once per browser, until the user says not to. The dialog lives
  // here, not in the row: a virtualized row unmounts the moment it scrolls out
  // of view, which would take its own dialog down with it.
  const requestDelete = useCallback(
    (shotId: string) => {
      if (readSkipDeleteConfirm()) {
        deleteShot(shotId);
        return;
      }
      setPendingDeleteId(shotId);
    },
    [deleteShot]
  );

  const rowActions = useMemo<StoryboardRowActions>(
    () => ({
      onPatch: patchShot,
      onDelete: requestDelete,
      onInsert: insertShot,
      onMoveToIndex: moveShotToIndex,
      onSelect: (shotId, slot) => {
        selectShot(shotId, slot);
      },
      onOpenOnCanvas,
    }),
    [insertShot, moveShotToIndex, onOpenOnCanvas, patchShot, requestDelete, selectShot]
  );

  const pendingDeleteRow = rows.find((row) => row.id === pendingDeleteId) ?? null;

  const confirmDelete = useCallback(() => {
    if (!pendingDeleteId) return;
    if (skipNextTime) writeSkipDeleteConfirm();
    deleteShot(pendingDeleteId);
    setPendingDeleteId(null);
    setSkipNextTime(false);
  }, [deleteShot, pendingDeleteId, skipNextTime]);

  // A collaborator deleting the same shot first closes the question.
  useEffect(() => {
    if (pendingDeleteId && !pendingDeleteRow) setPendingDeleteId(null);
  }, [pendingDeleteId, pendingDeleteRow]);

  // A shot deleted by anyone (including a collaborator) closes its drawer.
  useEffect(() => {
    if (selectedShotId && !rows.some((row) => row.id === selectedShotId)) closeShotDrawer();
  }, [rows, selectedShotId, closeShotDrawer]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-w-0 flex-1 flex-col px-2 pt-2 pb-2">
        {/* The board sits on its own surface, one tone step above the page —
            elevation carries it, since DESIGN.md §4 rules out an outline. The
            drawer beside it is a step above again (page 0.13 → card 0.175 →
            popover 0.19), so the three regions read in depth order. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-card">
          {/* Header is part of the card — title + shot count + add-shot action. */}
          <header className="flex shrink-0 items-center gap-3 px-4 py-3">
            <h1 className="text-sm font-semibold text-white/88">{t("title")}</h1>
            <span className="text-xs text-white/35 tabular-nums">
              {t("shotCount", { count: rows.length })}
            </span>
            <div className="ml-auto">
              <StoryboardPlayback rows={rows} />
            </div>
            {canEdit ? (
              <Button size="sm" onClick={() => insertShot(rows.length)}>
                <IconPlus data-icon="inline-start" />
                {t("addShot")}
              </Button>
            ) : null}
          </header>
          <div className="h-px bg-white/[0.07]" />
          {rows.length === 0 ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-center">
              <span className="flex size-10 items-center justify-center rounded-full bg-white/[0.06] text-white/40">
                <IconLayoutList className="size-5" stroke={1.6} />
              </span>
              <p className="text-sm font-medium text-white/80">{t("emptyTitle")}</p>
              <p className="max-w-sm text-xs text-white/40">
                {canEdit ? t("emptyBody") : t("emptyReadOnly")}
              </p>
            </div>
          ) : (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDragCancel={() => setActiveId(null)}
              >
                {/* The container owns vertical scroll (the virtualizer measures it);
                the primitive's own overflow-x keeps narrow viewports usable. */}
                <Table
                  containerRef={scrollRef}
                  containerClassName="min-h-0 flex-1 overflow-y-auto"
                  className="grid"
                  style={{ width: `${STORYBOARD_TABLE_WIDTH}px` }}
                >
                  <TableHeader className="sticky top-0 z-20 bg-card">
                    <TableRow
                      className={cn(
                        "grid w-max min-w-full hover:bg-transparent",
                        STORYBOARD_ROW_RULE
                      )}
                      style={{ gridTemplateColumns: STORYBOARD_GRID_TEMPLATE }}
                    >
                      {STORYBOARD_COLUMNS.map((column) => {
                        const label = t(`column.${column.key}`);
                        return (
                          <TableHead
                            key={column.key}
                            scope="col"
                            // A pinned header cell is sticky BOTH ways, so it
                            // outranks its sticky-left siblings inside the
                            // already-sticky header row — and it takes an
                            // explicit fill, since the header row itself is
                            // transparent and there is nothing to inherit.
                            className={storyboardHeadClass(
                              column,
                              column.pin ? "z-20 bg-card" : undefined
                            )}
                            style={storyboardCellStyle(column)}
                          >
                            {column.header.kind === "glyph" ? (
                              <span aria-hidden>{column.header.glyph}</span>
                            ) : null}
                            {column.header.kind === "label" ? (
                              label
                            ) : (
                              <span className="sr-only">{label}</span>
                            )}
                          </TableHead>
                        );
                      })}
                    </TableRow>
                  </TableHeader>

                  {/* The body owns the full scroll height; rows are placed inside it
                  by transform, so only the visible slice exists in the DOM. */}
                  <TableBody
                    className="relative grid"
                    style={{ height: virtualizer.getTotalSize() }}
                  >
                    <SortableContext items={rowIds} strategy={verticalListSortingStrategy}>
                      {virtualItems.map((item) => {
                        const row = rows[item.index];
                        if (!row) return null;
                        return (
                          <StoryboardRow
                            key={row.id}
                            row={row}
                            index={item.index}
                            rowCount={rows.length}
                            canEdit={canEdit}
                            selected={selectedShotId === row.id}
                            start={item.start}
                            highlighted={highlightId === row.id}
                            measureRef={virtualizer.measureElement}
                            actions={rowActions}
                            onNavigate={(dir, columnKey) =>
                              handleNavigate(item.index, columnKey, dir)
                            }
                          />
                        );
                      })}
                    </SortableContext>
                  </TableBody>
                </Table>
              </DndContext>
            </div>
          )}
        </div>
      </div>

      <AlertDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (open) return;
          setPendingDeleteId(null);
          // The tick is scoped to the question that was asked — dismissing
          // without deleting doesn't quietly save it.
          setSkipNextTime(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("delete.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("delete.description", { number: pendingDeleteRow?.number ?? 0 })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-center gap-2 rounded-xl bg-white/[0.04] px-3 py-2.5 text-xs text-white/54">
            <input
              type="checkbox"
              checked={skipNextTime}
              onChange={(event) => setSkipNextTime(event.target.checked)}
            />
            {t("delete.dontAskAgain")}
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete}>
              {tCommon("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
