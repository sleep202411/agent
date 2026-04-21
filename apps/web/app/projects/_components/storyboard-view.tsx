"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  IconClock,
  IconFileText,
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
} from "@/app/projects/_components/storyboard/cells";
import { MusicCell } from "@/app/projects/_components/storyboard/cells/music-cell";
import { StoryboardDialogProvider } from "@/app/projects/_components/storyboard/storyboard-dialog-context";
import { StoryboardLiftedDialogs } from "@/app/projects/_components/storyboard/storyboard-lifted-dialogs";
import { LipSyncCell } from "@/app/projects/_components/storyboard-lipsync-cell";
import { StoryboardCardView } from "@/app/projects/_components/storyboard-card-view";
import { StoryboardColumnHeader } from "@/app/projects/_components/storyboard-column-header";
import { StoryboardToolbar } from "@/app/projects/_components/storyboard-toolbar";
import { TextCell } from "@/app/projects/_components/storyboard/cells/text-cell";
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

async function persistPlainTextCell(shotId: string, shotColumnId: string, value: string) {
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
        />
      );
  }
}

const ROW_HEIGHT = 180;

function VirtualStoryboardTable({
  rows,
  visibleColumns,
  mentionItems,
}: {
  rows: ShotRow[];
  visibleColumns: ShotColumn[];
  mentionItems: ReturnType<typeof buildMentionItems>;
}) {
  const t = useTranslations("storyboard");
  const scrollRef = useRef<HTMLDivElement>(null);
  const tableWidth = visibleColumns.reduce((sum, col) => sum + getColumnWidth(col), 0);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 3,
  });

  return (
    <div
      ref={scrollRef}
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

        {/* Virtualized rows */}
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            return (
              <div
                key={row.shotId ?? virtualRow.index}
                data-storyboard-shot-id={String(row.shotId ?? "")}
                className="flex border-b border-border/50 hover:bg-muted/20"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: ROW_HEIGHT,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {visibleColumns.map((column) => (
                  <div
                    key={column.id ?? column.presetColumnKey}
                    className="relative border-r border-border/50 last:border-r-0"
                    style={{ width: getColumnWidth(column), height: ROW_HEIGHT, flexShrink: 0 }}
                  >
                    <div className="absolute inset-0 overflow-hidden">
                      <StoryboardCell
                        col={column}
                        row={row}
                        rowIndex={virtualRow.index}
                        mentionItems={mentionItems}
                      />
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        {rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">{t("noShotsData")}</div>
        ) : null}
      </div>
    </div>
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

  useEffect(() => {
    clearBatchGenerating();
  }, [activeEpisodeId, clearBatchGenerating]);

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
          <StoryboardCardView />
        ) : (
          <VirtualStoryboardTable
            rows={rows}
            visibleColumns={visibleColumns}
            mentionItems={mentionItems}
          />
        )}
      </div>
      <StoryboardLiftedDialogs />
    </StoryboardDialogProvider>
  );
}
