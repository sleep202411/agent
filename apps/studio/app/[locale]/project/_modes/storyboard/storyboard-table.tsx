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
import { CANVAS_DRAWER_WIDTH } from "@/components/canvas/canvas-drawer-panel";
import { useProjectContext } from "@/app/[locale]/project/_components/project-context";
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
  STORYBOARD_OVERSCAN,
  STORYBOARD_ROW_RULE,
  storyboardCellStyle,
  storyboardHeadClass,
} from "./storyboard-columns";
import { ShotPictureDrawer, type ShotPictureDrawerActions } from "./shot-picture-drawer";
import { StoryboardRow } from "./storyboard-row";
import type { ShotSlotKind, StoryboardRowActions } from "./storyboard-types";
import { useStoryboard } from "./use-storyboard";

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
  const { setShellInset } = useProjectContext();
  const {
    rows,
    canvasSources,
    canEdit,
    insertShot,
    patchShot,
    deleteShot,
    moveShotToIndex,
    attachSource,
    detachPicture,
    createPictureSource,
    uploadPictureSource,
  } = useStoryboard();

  // Master-detail: the drawer follows the SELECTED SHOT, not a generation node,
  // so switching rows swaps the detail instead of opening a new surface.
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  // Which of the shot's pictures the drawer opened on — the cell that was
  // clicked decides, and the drawer's own tabs can move it afterwards.
  const [selectedSlot, setSelectedSlot] = useState<ShotSlotKind>("image");
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
        setSelectedShotId(shotId);
        setSelectedSlot(slot);
      },
      onOpenOnCanvas,
    }),
    [insertShot, moveShotToIndex, onOpenOnCanvas, patchShot, requestDelete]
  );

  const drawerActions = useMemo<ShotPictureDrawerActions>(
    () => ({
      onGenerate: (shotId, modality) => createPictureSource(shotId, modality),
      onUpload: uploadPictureSource,
      onAttach: attachSource,
      onDetach: detachPicture,
      onOpenOnCanvas,
    }),
    [attachSource, createPictureSource, detachPicture, onOpenOnCanvas, uploadPictureSource]
  );

  const selectedRow = rows.find((row) => row.id === selectedShotId) ?? null;
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

  // The drawer stands in the shell's LEFT region: tell the shell so its chrome
  // (back + project name) slides aside instead of being covered — the same
  // contract the canvas uses for its asset drawer.
  useEffect(() => {
    setShellInset({ left: selectedShotId ? CANVAS_DRAWER_WIDTH : 0 });
    return () => setShellInset({ left: 0 });
  }, [selectedShotId, setShellInset]);
  // A shot deleted by anyone (including a collaborator) closes its drawer.
  useEffect(() => {
    if (selectedShotId && !rows.some((row) => row.id === selectedShotId)) setSelectedShotId(null);
  }, [rows, selectedShotId]);

  return (
    <div className="flex h-full">
      {/* LEFT region — edge to edge, full height, like the canvas's asset drawer. */}
      {selectedRow ? (
        <ShotPictureDrawer
          row={selectedRow}
          slot={selectedSlot}
          sources={canvasSources}
          canEdit={canEdit}
          actions={drawerActions}
          onClose={() => setSelectedShotId(null)}
        />
      ) : null}

      {/* CENTER region — the board. Not full-bleed, so the drawer shrinks it. */}
      <div className="flex min-w-0 flex-1 flex-col px-2 pt-16 pb-2">
        <header className="flex shrink-0 items-center justify-between gap-3 pb-3">
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-lg font-semibold tracking-[-0.01em] text-white">{t("title")}</h1>
            <span className="text-xs text-white/35 tabular-nums">
              {t("shotCount", { count: rows.length })}
            </span>
          </div>
          {canEdit ? (
            <button
              type="button"
              onClick={() => insertShot(rows.length)}
              className="flex h-8 items-center gap-1.5 rounded-full bg-white/[0.07] px-3.5 text-xs font-medium text-white/80 transition-colors hover:bg-white/[0.13] hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
            >
              <IconPlus className="size-3.5" stroke={2} />
              {t("addShot")}
            </button>
          ) : null}
        </header>

        {/* The board sits on its own surface, one tone step above the page —
            elevation carries it, since DESIGN.md §4 rules out an outline. The
            drawer beside it is a step above again (page 0.13 → card 0.175 →
            popover 0.19), so the three regions read in depth order. */}
        <div className="flex min-h-0 flex-1 overflow-hidden rounded-2xl bg-card">
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
                >
                  {/* Sticky on the panel's own tone — `background` here would
                      cut a lighter seam across the top of the surface. */}
                  <TableHeader className="sticky top-0 z-20 grid bg-card">
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
                      {virtualizer.getVirtualItems().map((item) => {
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
