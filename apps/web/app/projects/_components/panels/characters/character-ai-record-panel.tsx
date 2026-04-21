"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { IconLoader2, IconRefresh, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { backendApi, type Paginated } from "@/src/lib/api";
import type { AssetRecord } from "@/src/types/workspace";
import { buildOssUrl } from "@/src/lib/uploads/workspace-upload";
import { submitImageTask, retryImageTask } from "@/src/lib/ai-image-queue";
import { removeTask, type Task } from "@/src/store/slices/taskSlice";
import { selectCharacterAiTasks } from "@/src/store/selectors/asset-ai-selectors";
import { useAppDispatch, useAppSelector } from "@/src/store";
import { getRecordPath, normalizeStoragePath, ROLE_RECORD_COLUMN_ID } from "./character-utils";

/**
 * Gallery over the character's AI-generated portrait history.
 *
 * Generation state lives in Redux (`taskSlice` via `submitImageTask`),
 * so in-flight tasks survive dialog close/reopen — and any sibling UI
 * (e.g. the character list on the main panel) can subscribe to the
 * same selector to show per-character loading indicators.
 *
 * History (server-confirmed images) is loaded on mount and stored
 * locally; it's effectively read-only cache. Tasks whose output path
 * shows up in the refreshed history are garbage-collected so the same
 * image doesn't render twice.
 *
 * Callers render their own prompt input + 生成 button below the panel
 * and trigger generation through the `generate()` method on the ref.
 */

type TilePath = { kind: "path"; path: string };
type TileTask = { kind: "task"; task: Task };
type GridItem = TilePath | TileTask;

const ROLE_COLUMN_KEY = String(ROLE_RECORD_COLUMN_ID);

export type CharacterAiRecordPanelHandle = {
  generate: () => void;
};

type Props = {
  characterId: string;
  prompt: string;
  /** Optional model id forwarded to the generate endpoint. */
  model?: string;
  referenceImageUrl?: string;
  selectedPath?: string;
  /** Called when the user picks a thumbnail as the character portrait. */
  onSelect: (path: string) => void;
  /** Optional — called when the user wants to see a full-size preview. */
  onPreview?: (path: string) => void;
};

export const CharacterAiRecordPanel = forwardRef<CharacterAiRecordPanelHandle, Props>(
  function CharacterAiRecordPanel(
    { characterId, prompt, model, referenceImageUrl, selectedPath, onSelect, onPreview },
    ref
  ) {
    const t = useTranslations("character");
    const tc = useTranslations("common");
    const dispatch = useAppDispatch();

    const tasks = useAppSelector((state) => selectCharacterAiTasks(state, characterId));

    const [historyImages, setHistoryImages] = useState<string[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);

    const loadHistory = useCallback(async () => {
      if (!characterId) {
        setHistoryImages([]);
        return;
      }
      try {
        setIsLoadingHistory(true);
        const data = await backendApi.post<Paginated<AssetRecord>>("/api/ai/record/shot/list", {
          data: {
            page: 1,
            pageSize: 50,
            shotcolumnId: -1,
            shotId: characterId,
            type: "img",
            sort: 1,
          },
        });
        const list = (data?.list ?? [])
          .map((item) => normalizeStoragePath(getRecordPath(item)))
          .filter(Boolean);
        setHistoryImages(list);
      } catch (error) {
        console.error("[CharacterAiRecordPanel] 获取历史失败:", error);
      } finally {
        setIsLoadingHistory(false);
      }
    }, [characterId]);

    useEffect(() => {
      if (!characterId) return;
      void loadHistory();
    }, [characterId, loadHistory]);

    // Once history catches up, evict completed tasks whose output path
    // is already in the refreshed list — otherwise the same image
    // renders twice (once as "just completed", once as "in history").
    useEffect(() => {
      if (historyImages.length === 0) return;
      const historyPaths = new Set(historyImages);
      for (const task of tasks) {
        if (
          task.status === "completed" &&
          task.output?.storagePath &&
          historyPaths.has(normalizeStoragePath(task.output.storagePath))
        ) {
          dispatch(removeTask(task.id));
        }
      }
    }, [historyImages, tasks, dispatch]);

    const generate = useCallback(() => {
      if (!characterId) {
        toast.warning(t("savePleaseFirst"));
        return;
      }
      const trimmed = (prompt ?? "").trim();
      if (!trimmed) {
        toast.warning(t("pleaseEnterPrompt"));
        return;
      }
      submitImageTask({
        shotId: characterId,
        shotColumnId: ROLE_COLUMN_KEY,
        prompt: trimmed,
        model: model || undefined,
        referenceImageUrl: referenceImageUrl ? buildOssUrl(referenceImageUrl) : undefined,
        watermark: false,
      });
    }, [characterId, model, prompt, referenceImageUrl, t]);

    useImperativeHandle(ref, () => ({ generate }), [generate]);

    // ─── Compose display grid ─────────────────────────────────
    // Tasks first (newest = most visually prominent), then history.
    // Completed tasks not yet pruned (because loadHistory hasn't
    // refreshed) render as normal thumbnails via their output path.
    const items: GridItem[] = useMemo(() => {
      const byPath = new Set<string>();
      const list: GridItem[] = [];
      for (const task of tasks) {
        if (task.status === "completed" && task.output?.storagePath) {
          const normalized = normalizeStoragePath(task.output.storagePath);
          if (!byPath.has(normalized)) {
            byPath.add(normalized);
            list.push({ kind: "path", path: normalized });
          }
        } else {
          list.push({ kind: "task", task });
        }
      }
      for (const path of historyImages) {
        if (byPath.has(path)) continue;
        byPath.add(path);
        list.push({ kind: "path", path });
      }
      return list;
    }, [tasks, historyImages]);

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[11px] text-muted-foreground/80">
            {t("aiGenerateImage")}
            {isLoadingHistory ? " · 加载中" : null}
          </div>
        </div>

        <div className="grid grid-cols-5 gap-2">
          {items.map((item) => {
            if (item.kind === "task") {
              const { task } = item;
              const isFailed = task.status === "failed";
              return (
                <div
                  key={task.id}
                  className={cn(
                    "relative flex aspect-square items-center justify-center rounded-md border bg-muted/10",
                    isFailed ? "border-destructive/40" : "border-border/40"
                  )}
                >
                  {isFailed ? (
                    <>
                      <button
                        type="button"
                        title={task.error || t("generateFailed")}
                        onClick={() => retryImageTask(task.id)}
                        className="flex flex-col items-center gap-1 text-destructive hover:text-destructive/80"
                      >
                        <IconRefresh className="size-4" />
                        <span className="text-[10px]">{tc("retry")}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => dispatch(removeTask(task.id))}
                        title={tc("delete")}
                        className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/60 text-white hover:bg-destructive"
                      >
                        <IconX className="size-3" />
                      </button>
                    </>
                  ) : (
                    <IconLoader2 className="size-4 animate-spin text-muted-foreground" />
                  )}
                </div>
              );
            }
            const path = item.path;
            const isSelected = Boolean(selectedPath) && selectedPath === path;
            const url = buildOssUrl(path);
            return (
              <button
                key={path}
                type="button"
                onClick={() => onSelect(path)}
                onDoubleClick={() => onPreview?.(url)}
                className={cn(
                  "relative aspect-square overflow-hidden rounded-md border-2 transition-colors",
                  isSelected ? "border-primary" : "border-transparent hover:border-primary/40"
                )}
                title={isSelected ? "已选为角色形象（双击查看大图）" : "点击选为角色形象"}
              >
                <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
                {isSelected && (
                  <div className="absolute inset-x-0 bottom-0 bg-primary/80 py-0.5 text-center text-[10px] font-medium text-white">
                    当前
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {items.length === 0 && !isLoadingHistory && (
          <p className="text-[11px] text-muted-foreground/60">
            还没生成过图片，下面输入提示词点「生成」。
          </p>
        )}
      </div>
    );
  }
);
