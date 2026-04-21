"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { IconLoader2, IconRefresh, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { backendApi, type Paginated } from "@/src/lib/api";
import type { AssetRecord } from "@/src/types/workspace";
import { buildOssUrl } from "@/src/lib/uploads/workspace-upload";
import { normalizeStoragePath } from "@/src/lib/asset-paths";
import { submitImageTask, retryImageTask } from "@/src/lib/ai-image-queue";
import { removeTask, type Task } from "@/src/store/slices/taskSlice";
import { selectAssetAiTasks } from "@/src/store/selectors/asset-ai-selectors";
import { useAppDispatch, useAppSelector } from "@/src/store";

/**
 * Inline gallery for a world-asset's AI-generated images (characters,
 * scenes, props — distinguished by `columnKey`). Used as the right-hand
 * stack in the corresponding edit sheet, alongside a prompt + 生成
 * composer rendered by the caller.
 *
 * State layers:
 *   • In-flight / just-completed / failed generations come from the
 *     Redux `taskSlice` (via `submitImageTask`) — that's why loading
 *     placeholders survive dialog close/reopen and why sibling UIs
 *     can subscribe to `selectAssetHasActiveAiTask`.
 *   • Server-confirmed history is pulled on mount into component state.
 *   • Once history catches up, completed tasks whose path is present
 *     in history are evicted so the same image doesn't render twice.
 *
 * Selection semantics are decided by the caller via `onSelect`:
 *   • Character dialog: replace the single portrait path.
 *   • Scene / Prop dialog: append to the collection (bounded), with
 *     "当前" badges on paths already in the collection (passed via
 *     `selectedPaths`).
 */

type TilePath = { kind: "path"; path: string };
type TileTask = { kind: "task"; task: Task };
type GridItem = TilePath | TileTask;

function pickRecordPath(item: AssetRecord): string {
  return String(item.storagePath ?? item.path ?? item.filePath ?? item.url ?? "");
}

export type AssetAiRecordPanelHandle = {
  generate: () => void;
};

type Props = {
  /** ID of the world asset (characterId / sceneId / propId). */
  assetId: string;
  /**
   * Column key used on the backend to scope generations + history.
   * String form of the numeric column ID (e.g. "-1" for character
   * portraits, "-3" for scenes, "-2" for props).
   */
  columnKey: string;
  prompt: string;
  /** Optional model id forwarded to the generate endpoint. */
  model?: string;
  referenceImageUrl?: string;
  /**
   * Paths currently considered "selected" by the caller — renders a
   * 当前 badge on any match. Pass a single-item array for pick-one
   * flows; pass the collection directly for multi-select flows.
   */
  selectedPaths?: string[];
  /** Fired with the storage path whenever the user clicks a thumbnail. */
  onSelect: (path: string) => void;
  /** Optional — fired on double-click for a full-size preview. */
  onPreview?: (path: string) => void;
};

export const AssetAiRecordPanel = forwardRef<AssetAiRecordPanelHandle, Props>(
  function AssetAiRecordPanel(
    { assetId, columnKey, prompt, model, referenceImageUrl, selectedPaths, onSelect, onPreview },
    ref
  ) {
    const tc = useTranslations("common");
    const dispatch = useAppDispatch();

    const tasks = useAppSelector((state) => selectAssetAiTasks(state, assetId, columnKey));

    const [historyImages, setHistoryImages] = useState<string[]>([]);
    const [isLoadingHistory, setIsLoadingHistory] = useState(false);

    const loadHistory = useCallback(async () => {
      if (!assetId) {
        setHistoryImages([]);
        return;
      }
      try {
        setIsLoadingHistory(true);
        const data = await backendApi.post<Paginated<AssetRecord>>("/api/ai/record/shot/list", {
          data: {
            page: 1,
            pageSize: 50,
            shotcolumnId: Number(columnKey),
            shotId: assetId,
            type: "img",
            sort: 1,
          },
        });
        const list = (data?.list ?? [])
          .map((item) => normalizeStoragePath(pickRecordPath(item)))
          .filter(Boolean);
        setHistoryImages(list);
      } catch (error) {
        console.error("[AssetAiRecordPanel] 获取历史失败:", error);
      } finally {
        setIsLoadingHistory(false);
      }
    }, [assetId, columnKey]);

    useEffect(() => {
      if (!assetId) return;
      void loadHistory();
    }, [assetId, loadHistory]);

    // Evict completed tasks whose output path has been confirmed in
    // the history refresh. Without this the same image renders twice
    // — once from the task cache, once from history.
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
      if (!assetId) {
        toast.warning("请先保存");
        return;
      }
      const trimmed = (prompt ?? "").trim();
      if (!trimmed) {
        toast.warning(tc("enterPrompt"));
        return;
      }
      submitImageTask({
        shotId: assetId,
        shotColumnId: columnKey,
        prompt: trimmed,
        model: model || undefined,
        referenceImageUrl: referenceImageUrl ? buildOssUrl(referenceImageUrl) : undefined,
        watermark: false,
      });
    }, [assetId, columnKey, model, prompt, referenceImageUrl, tc]);

    useImperativeHandle(ref, () => ({ generate }), [generate]);

    const selectedSet = useMemo(() => {
      if (!selectedPaths?.length) return new Set<string>();
      return new Set(selectedPaths.map((p) => normalizeStoragePath(p)).filter(Boolean));
    }, [selectedPaths]);

    // Grid: tasks first (newest = most visually prominent), then
    // history. Completed tasks not yet pruned still render via their
    // output path so the result shows up the moment the queue fires
    // completeTask — no wait for loadHistory.
    const items: GridItem[] = useMemo(() => {
      const byPath = new Set<string>();
      const list: GridItem[] = [];
      for (const task of tasks) {
        if (task.status === "completed" && task.output?.storagePath) {
          const normalized = normalizeStoragePath(task.output.storagePath);
          if (normalized && !byPath.has(normalized)) {
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
        {isLoadingHistory ? (
          <div className="text-[11px] text-muted-foreground/60">加载中…</div>
        ) : null}

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
                        title={task.error || tc("generateFailed")}
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
            const isSelected = selectedSet.has(normalizeStoragePath(path));
            const url = buildOssUrl(path);
            return (
              <button
                key={path}
                type="button"
                onClick={() => onSelect(path)}
                onDoubleClick={() => onPreview?.(path)}
                className={cn(
                  "relative aspect-square overflow-hidden rounded-md border-2 transition-colors",
                  isSelected ? "border-primary" : "border-transparent hover:border-primary/40"
                )}
                title={isSelected ? "已加入（双击查看大图）" : "点击加入"}
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
