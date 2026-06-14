"use client";

import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { toast } from "sonner";
import {
  IconClock,
  IconFileText,
  IconGripVertical,
  IconHash,
  IconList,
  IconMapPin,
  IconMessageCircle,
  IconMusic,
  IconPhoto,
  IconUserFilled,
  IconVideo,
  IconVideoPlus,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { updateShotOrder } from "@/src/services/storyboard";
import {
  buildMentionItems,
  CharacterCell,
  DurationCell,
  ImageCell,
  MediaCell,
  RichTextCell,
  SceneReferenceCell,
  SelectCell,
  ShotNoCell,
  SoundPathCell,
} from "@/app/(studio)/art-studio/projects/_components/storyboard/cells";
import { MusicCell } from "@/app/(studio)/art-studio/projects/_components/storyboard/cells/music-cell";
import { StoryboardDialogProvider } from "@/app/(studio)/art-studio/projects/_components/storyboard/storyboard-dialog-context";
import { StoryboardLiftedDialogs } from "@/app/(studio)/art-studio/projects/_components/storyboard/storyboard-lifted-dialogs";
import { LipSyncCell } from "@/app/(studio)/art-studio/projects/_components/storyboard-lipsync-cell";
import { StoryboardCardView } from "@/app/(studio)/art-studio/projects/_components/storyboard-card-view";
import { StoryboardColumnHeader } from "@/app/(studio)/art-studio/projects/_components/storyboard-column-header";
import { StoryboardToolbar } from "@/app/(studio)/art-studio/projects/_components/storyboard-toolbar";
import { TextCell } from "@/app/(studio)/art-studio/projects/_components/storyboard/cells/text-cell";
import { useTranslations } from "@/src/i18n/i18n";
import { useGuide } from "@/src/lib/guide/use-guide";
import { backendApi } from "@/src/lib/api";
import { useAppSelector, useAppDispatch } from "@/src/store";
import { store } from "@/src/store";
import {
  clearBatchGenerating,
  setRows,
  touchStoryboard,
  selectCurrentInstance,
  type ShotColumn,
  type ShotRow,
  type ShotValue,
} from "@/src/store/slices/projectSlice";

async function persistPlainTextCell(
  shotId: string,
  shotColumnId: string,
  value: string,
  // `silent` = network-only (no Redux write). The debounced autosave uses it
  // so an optimistic store update can't re-render the contenteditable mid-edit
  // and reset the caret. The blur save runs non-silent.
  options?: { silent?: boolean }
) {
  if (!options?.silent) {
    const currentRows = selectCurrentInstance(store.getState()).rows;
    store.dispatch(
      setRows(
        currentRows.map((row) => {
          if (row.shotId !== shotId) return row;

          const values = [...(row.shotValues ?? [])];
          const index = values.findIndex((item) => item.shotColumnId === shotColumnId);
          if (index >= 0) {
            values[index] = { ...values[index], value };
          } else {
            values.push({ shotColumnId, value });
          }

          return { ...row, shotValues: values };
        })
      )
    );
  }

  try {
    await backendApi.post("/api/user/shotValue/input", {
      data: { shotId, shotColumnId, value },
    });
  } catch (error) {
    console.error("[StoryboardView] 保存文本失败:", error);
    store.dispatch(touchStoryboard());
  }
}

function findCell(row: ShotRow, col: ShotColumn) {
  return row.shotValues?.find((value) => value.shotColumnId === col.id);
}

function getTextValue(cell?: ShotValue) {
  return cell?.richText?.content ?? cell?.value ?? "";
}

function getColumnIcon(type?: string): ReactNode {
  switch (type) {
    case "shot_no":
      return <IconHash className="size-3.5" />;
    case "image":
      return <IconPhoto className="size-3.5" />;
    case "video":
      return <IconVideo className="size-3.5" />;
    case "lip_sync":
      return <IconVideoPlus className="size-3.5" />;
    case "richtext":
      return <IconFileText className="size-3.5" />;
    case "dialogue":
      return <IconMessageCircle className="size-3.5" />;
    case "text":
      return <IconFileText className="size-3.5" />;
    case "number":
      return <IconClock className="size-3.5" />;
    case "select":
      return <IconList className="size-3.5" />;
    case "character":
      return <IconUserFilled className="size-3.5" />;
    case "scene":
      return <IconMapPin className="size-3.5" />;
    case "sound_path":
    case "audio":
    case "music":
      return <IconMusic className="size-3.5" />;
    default:
      return null;
  }
}

// 按 presetColumnKey 精确匹配（优先）
const PRESET_COLUMN_WIDTH: Record<string, number> = {
  shot_no: 140,
  scene: 136,
  character: 136,
  image_path: 246,
  video_path: 246,
  video_path_lip_sync: 246,
  sound_path: 200,
  music: 200,
  video_prompt: 266,
  image_prompt: 266,
  description: 266,
  dialogue: 266,
  duration: 142,
  style_planting: 160,
  shot_size: 148,
  perspective: 148,
  movement: 148,
  status: 148,
};

// 按 resolvedType 回退
const TYPE_COLUMN_WIDTH: Record<string, number> = {
  richtext: 266,
  text: 200,
  select: 148,
  number: 142,
  image: 246,
  video: 246,
  audio: 200,
  music: 200,
  character: 136,
  scene: 136,
};

const DEFAULT_COLUMN_WIDTH = 150;

function getColumnWidth(col: ShotColumn) {
  const preset = col.presetColumnKey;
  if (preset && PRESET_COLUMN_WIDTH[preset]) return PRESET_COLUMN_WIDTH[preset];
  const resolved = col.resolvedType;
  if (resolved && TYPE_COLUMN_WIDTH[resolved]) return TYPE_COLUMN_WIDTH[resolved];
  return DEFAULT_COLUMN_WIDTH;
}

function StoryboardCell({
  col,
  row,
  rowIndex,
  mentionItems,
}: {
  col: ShotColumn;
  row: ShotRow;
  rowIndex: number;
  mentionItems: ReturnType<typeof buildMentionItems>;
}) {
  const t = useTranslations("storyboard");
  const cell = findCell(row, col);
  const textValue = getTextValue(cell);
  const shotId = String(row.shotId ?? "");
  const columnId = String(col.id ?? "");

  switch (col.resolvedType) {
    case "shot_no":
      return <ShotNoCell row={row} rowIndex={rowIndex} />;
    case "image": {
      return (
        <ImageCell cell={cell} shotId={shotId} shotColumnId={columnId} row={row} column={col} />
      );
    }
    case "video":
      return (
        <MediaCell
          cell={cell}
          shotId={shotId}
          shotColumnId={columnId}
          type="video"
          row={row}
          column={col}
        />
      );
    case "lip_sync":
      return (
        <LipSyncCell cell={cell} shotId={shotId} shotColumnId={columnId} row={row} column={col} />
      );
    case "sound_path":
      return <SoundPathCell cell={cell} shotId={shotId} shotColumnId={columnId} row={row} />;
    case "music":
      return <MusicCell cell={cell} shotId={shotId} shotColumnId={columnId} column={col} />;
    case "richtext":
      return (
        <RichTextCell
          cell={cell}
          shotId={shotId}
          shotColumnId={columnId}
          mentionItems={mentionItems}
          placeholder={t("richtextPlaceholder")}
        />
      );
    case "dialogue":
      return (
        <RichTextCell
          cell={cell}
          shotId={shotId}
          shotColumnId={columnId}
          mentionItems={mentionItems}
          allowedMentionTypes={["character"]}
          placeholder={t("dialoguePlaceholder")}
          showAvatar={false}
          extraFields={["voiceId", "model"]}
        />
      );
    case "number":
      return <DurationCell cell={cell} shotId={shotId} shotColumnId={columnId} />;
    case "select":
      return <SelectCell column={col} cell={cell} shotId={shotId} shotColumnId={columnId} />;
    case "character":
      return <CharacterCell cell={cell} shotId={shotId} shotColumnId={columnId} />;
    case "scene":
      return <SceneReferenceCell cell={cell} shotId={shotId} shotColumnId={columnId} />;
    case "text":
    default:
      return (
        <TextCell
          value={textValue}
          height={120}
          onSave={(nextValue) => void persistPlainTextCell(shotId, columnId, nextValue)}
          onAutoSave={(nextValue) =>
            void persistPlainTextCell(shotId, columnId, nextValue, { silent: true })
          }
        />
      );
  }
}

const ROW_HEIGHT = 180;

function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function SortableShotRow({
  row,
  index,
  visibleColumns,
  mentionItems,
}: {
  row: ShotRow;
  index: number;
  visibleColumns: ShotColumn[];
  mentionItems: ReturnType<typeof buildMentionItems>;
}) {
  // New rows that haven't been persisted yet have no shotId — those
  // can't be reordered server-side, so just disable sortable for them.
  const sortableId = String(row.shotId ?? `pending-${index}`);
  const { ref, handleRef, isDragging } = useSortable({
    id: sortableId,
    index,
    disabled: !row.shotId,
  });

  return (
    <div
      ref={ref}
      data-storyboard-shot-id={String(row.shotId ?? "")}
      className={cn(
        "group relative flex border-b border-border/50 hover:bg-muted/20",
        isDragging && "z-30 opacity-60 shadow-lg"
      )}
      style={{ height: ROW_HEIGHT }}
    >
      {/* Drag handle — hover-only so it doesn't crowd the shot-no cell at rest. */}
      {row.shotId ? (
        <div
          ref={handleRef}
          className="absolute left-0 top-1/2 z-20 flex h-8 w-5 -translate-y-1/2 cursor-grab touch-none items-center justify-center rounded bg-background/70 text-muted-foreground/40 opacity-0 transition-opacity hover:text-muted-foreground group-hover:opacity-100 active:cursor-grabbing"
          title="Drag to reorder"
          aria-label="Drag to reorder this shot"
        >
          <IconGripVertical className="size-3.5" />
        </div>
      ) : null}

      {visibleColumns.map((column) => (
        <div
          key={column.id ?? column.presetColumnKey}
          className="relative border-r border-border/50 last:border-r-0"
          style={{ width: getColumnWidth(column), height: ROW_HEIGHT, flexShrink: 0 }}
        >
          <div className="absolute inset-0 overflow-hidden">
            <StoryboardCell col={column} row={row} rowIndex={index} mentionItems={mentionItems} />
          </div>
        </div>
      ))}
    </div>
  );
}

function VirtualStoryboardTable({
  rows,
  visibleColumns,
  mentionItems,
  onReorder,
}: {
  rows: ShotRow[];
  visibleColumns: ShotColumn[];
  mentionItems: ReturnType<typeof buildMentionItems>;
  onReorder: (reordered: ShotRow[], movedShotId: string) => void;
}) {
  const t = useTranslations("storyboard");
  const tableWidth = visibleColumns.reduce((sum, col) => sum + getColumnWidth(col), 0);

  // Drag state — accumulated through onDragOver, committed on onDragEnd.
  // Storing in refs (not state) so pointer moves don't re-render the table.
  const pendingReorderRef = useRef<ShotRow[] | null>(null);
  const movedShotIdRef = useRef<string | null>(null);

  const handleDragOver = useCallback(
    (event: unknown) => {
      const op = (
        event as {
          operation?: { source?: { id: string | number }; target?: { id: string | number } };
        }
      ).operation;
      const source = op?.source;
      const target = op?.target;
      if (!source || !target || source.id === target.id) return;

      const currentList = pendingReorderRef.current ?? rows;
      const fromIndex = currentList.findIndex((r) => String(r.shotId ?? "") === String(source.id));
      const toIndex = currentList.findIndex((r) => String(r.shotId ?? "") === String(target.id));
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;

      pendingReorderRef.current = arrayMove(currentList, fromIndex, toIndex);
      movedShotIdRef.current = String(source.id);
    },
    [rows]
  );

  const handleDragEnd = useCallback(() => {
    const reordered = pendingReorderRef.current;
    const movedShotId = movedShotIdRef.current;
    pendingReorderRef.current = null;
    movedShotIdRef.current = null;
    if (reordered && movedShotId) {
      onReorder(reordered, movedShotId);
    }
  }, [onReorder]);

  return (
    <DragDropProvider onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
      <div
        data-tour-step="storyboard-table"
        className="storyboard-table-scroll flex-1 overflow-auto"
      >
        <div style={{ width: tableWidth, minWidth: "100%" }} className="text-sm">
          {/* Header */}
          <div className="sticky top-0 z-10 flex bg-muted border-b border-border">
            {visibleColumns.map((column) => (
              <div
                key={column.id ?? column.presetColumnKey}
                style={{ width: getColumnWidth(column), flexShrink: 0 }}
                className="border-r border-border/50 px-2 py-3 text-center font-medium text-muted-foreground last:border-r-0"
              >
                <StoryboardColumnHeader column={column} icon={getColumnIcon(column.resolvedType)} />
              </div>
            ))}
          </div>

          {/* Rows — flat layout (not virtualized) so dnd-kit/react's
              collision detection lines up with DOM order. Storyboards
              are typically ≤ 50 rows per episode; the perf hit is
              negligible vs. the integration complexity of pairing
              tanstack-virtual's absolute-positioned rows with dnd-kit. */}
          {rows.map((row, index) => (
            <SortableShotRow
              key={row.shotId ?? index}
              row={row}
              index={index}
              visibleColumns={visibleColumns}
              mentionItems={mentionItems}
            />
          ))}

          {rows.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {t("noShotsData")}
            </div>
          ) : null}
        </div>
      </div>
    </DragDropProvider>
  );
}

export function StoryboardView() {
  const t = useTranslations("storyboard");
  const columns = useAppSelector((s) => selectCurrentInstance(s).columns);
  const rows = useAppSelector((s) => selectCurrentInstance(s).rows);
  const isLoading = useAppSelector((s) => selectCurrentInstance(s).isStoryboardLoading);
  const viewMode = useAppSelector((s) => selectCurrentInstance(s).storyboardViewMode);

  // Guided tour — auto-starts on first visit
  useGuide("storyboard", { ready: !isLoading && rows.length > 0 });
  const activeEpisodeId = useAppSelector((s) => selectCurrentInstance(s).activeEpisodeId);
  const characters = useAppSelector((s) => selectCurrentInstance(s).characters);
  const scenes = useAppSelector((s) => selectCurrentInstance(s).scenes);
  const props = useAppSelector((s) => selectCurrentInstance(s).props);

  const mentionItems = buildMentionItems(characters, scenes, props);

  const visibleColumns = columns
    .filter((column) => !column.hide)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

  const dispatch = useAppDispatch();

  useEffect(() => {
    clearBatchGenerating();
  }, [activeEpisodeId, clearBatchGenerating]);

  // Drag-reorder: storyBoardId === activeEpisodeId per the existing
  // shot/insert convention (see shot-no-cell.tsx). The Java endpoint
  // takes (currentShotId, beforeShotId) — beforeShotId being null
  // means "place at the end".
  const handleReorder = useCallback(
    async (reordered: ShotRow[], movedShotId: string) => {
      if (!activeEpisodeId) return;

      const original = rows;
      // Optimistic update so the row visibly snaps to the new position.
      dispatch(setRows(reordered));

      const newIndex = reordered.findIndex((r) => String(r.shotId ?? "") === movedShotId);
      if (newIndex === -1) return;

      // beforeShotId = the next persisted row's shotId, or null if
      // we're at the tail. Skip pending (un-saved) rows in between.
      let beforeShotId: string | null = null;
      for (let i = newIndex + 1; i < reordered.length; i += 1) {
        const id = reordered[i].shotId;
        if (id) {
          beforeShotId = String(id);
          break;
        }
      }

      // eslint-disable-next-line no-console
      console.info("[storyboard reorder] payload", {
        storyBoardId: String(activeEpisodeId),
        currentTheShotId: movedShotId,
        beforeTheShotId: beforeShotId,
      });

      try {
        await updateShotOrder(String(activeEpisodeId), movedShotId, beforeShotId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.warn("[storyboard reorder] backend save failed:", err);
        toast.error(`${t("reorderFailed")}: ${msg}`);
        dispatch(setRows(original));
      }
    },
    [activeEpisodeId, rows, dispatch, t]
  );

  useEffect(() => {
    const handleFocusShot = (event: Event) => {
      const customEvent = event as CustomEvent<{ shotId?: string }>;
      const shotId = String(customEvent.detail?.shotId ?? "");
      if (!shotId) return;

      requestAnimationFrame(() => {
        const row = document.querySelector(
          `[data-storyboard-shot-id="${shotId}"]`
        ) as HTMLTableRowElement | null;
        if (!row) return;

        row.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    };

    window.addEventListener("workspace:focus-shot", handleFocusShot as EventListener);
    return () => {
      window.removeEventListener("workspace:focus-shot", handleFocusShot as EventListener);
    };
  }, []);

  return (
    <StoryboardDialogProvider>
      <div className="flex h-full flex-col gap-4">
        <StoryboardToolbar />

        {!activeEpisodeId ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-muted-foreground">{t("episodeNotSelected")}</p>
          </div>
        ) : isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-muted-foreground">{t("loadingStoryboard")}</p>
          </div>
        ) : visibleColumns.length === 0 && rows.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-muted-foreground">{t("noStoryboardData")}</p>
          </div>
        ) : viewMode === "card" ? (
          <StoryboardCardView onReorder={handleReorder} />
        ) : (
          <VirtualStoryboardTable
            rows={rows}
            visibleColumns={visibleColumns}
            mentionItems={mentionItems}
            onReorder={handleReorder}
          />
        )}
      </div>
      <StoryboardLiftedDialogs />
    </StoryboardDialogProvider>
  );
}
