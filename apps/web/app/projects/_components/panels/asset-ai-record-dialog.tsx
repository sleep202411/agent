"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { IconCheck, IconLoader2, IconRefresh, IconWand, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppDispatch, useAppSelector } from "@/src/store";
import { removeTask, type Task } from "@/src/store/slices/taskSlice";
import { selectAssetAiTasks } from "@/src/store/selectors/asset-ai-selectors";
import { submitImageTask, retryImageTask } from "@/src/lib/ai-image-queue";
import { normalizeStoragePath, ossUrl } from "@/src/lib/asset-paths";

type TilePath = { kind: "path"; path: string; source: "task" | "selected"; taskId?: string };
type TileTask = { kind: "task"; task: Task };
type Tile = TilePath | TileTask;

export function AssetAiRecordDialog({
  open,
  onOpenChange,
  title,
  shotId,
  shotColumnId,
  prompt,
  referenceImageUrl,
  selectedPath,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  shotId: string;
  shotColumnId: string;
  prompt: string;
  referenceImageUrl?: string;
  selectedPath?: string;
  onSelect: (path: string) => void;
}) {
  const tc = useTranslations("common");
  const dispatch = useAppDispatch();

  const tasks = useAppSelector((state) => selectAssetAiTasks(state, shotId, shotColumnId));
  const normalizedSelectedPath = useMemo(() => normalizeStoragePath(selectedPath), [selectedPath]);

  const [previewPath, setPreviewPath] = useState("");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  // ─── Compose grid ─────────────────────────────────────
  // Completed task result paths → tile (path, source="task"), so the
  // user can still see "things I generated this session" after the
  // loading spinner disappears. Pending/running/failed stay as task
  // tiles so retry/dismiss affordances remain on the same card.
  const tiles: Tile[] = useMemo(() => {
    const seen = new Set<string>();
    const items: Tile[] = [];

    for (const task of tasks) {
      if (task.status === "completed" && task.output?.storagePath) {
        const path = normalizeStoragePath(task.output.storagePath);
        if (path && !seen.has(path)) {
          seen.add(path);
          items.push({ kind: "path", path, source: "task", taskId: task.id });
        }
      } else {
        items.push({ kind: "task", task });
      }
    }

    // Preserve the caller's current selection in the grid even if it
    // wasn't generated this session — otherwise the checkbox/preview
    // syncing has nothing to point at when the dialog opens.
    if (normalizedSelectedPath && !seen.has(normalizedSelectedPath)) {
      seen.add(normalizedSelectedPath);
      items.push({ kind: "path", path: normalizedSelectedPath, source: "selected" });
    }

    return items;
  }, [tasks, normalizedSelectedPath]);

  // Seed the preview panel when the dialog opens.
  useEffect(() => {
    if (!open) return;
    if (normalizedSelectedPath) {
      setPreviewPath(normalizedSelectedPath);
      return;
    }
    const firstPath = tiles.find((tile) => tile.kind === "path");
    setPreviewPath(firstPath?.kind === "path" ? firstPath.path : "");
  }, [open, normalizedSelectedPath, tiles]);

  // Keep the selected checkbox index in sync with the previewed path.
  useEffect(() => {
    if (!previewPath) {
      setSelectedIndex(null);
      return;
    }
    const normalizedTarget = normalizeStoragePath(previewPath);
    const nextIndex = tiles.findIndex(
      (tile) => tile.kind === "path" && normalizeStoragePath(tile.path) === normalizedTarget
    );
    setSelectedIndex(nextIndex >= 0 ? nextIndex : null);
  }, [previewPath, tiles]);

  const handleGenerate = useCallback(() => {
    if (!prompt.trim()) {
      toast.warning("请先填写描述或提示词");
      return;
    }
    submitImageTask({
      shotId,
      shotColumnId,
      prompt,
      referenceImageUrl: referenceImageUrl || undefined,
      watermark: false,
    });
  }, [prompt, referenceImageUrl, shotColumnId, shotId]);

  const handleConfirm = useCallback(() => {
    if (selectedIndex !== null) {
      const tile = tiles[selectedIndex];
      if (tile?.kind === "path") {
        onSelect(tile.path);
        onOpenChange(false);
        return;
      }
    }
    if (previewPath) {
      onSelect(previewPath);
      onOpenChange(false);
      return;
    }
    toast.warning("请选择一张图片");
  }, [onOpenChange, onSelect, previewPath, selectedIndex, tiles]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[1000px] max-w-[calc(100vw-2rem)] overflow-hidden p-0 sm:max-w-[1000px]"
        onInteractOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="flex h-[520px] gap-5 p-5">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="grid flex-1 grid-cols-4 content-start gap-3 overflow-y-auto rounded-lg border border-dashed border-border bg-muted/10 p-3">
              <button
                type="button"
                onClick={handleGenerate}
                className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-border bg-background/30 text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-primary"
              >
                <div className="flex flex-col items-center gap-2 text-xs">
                  <IconWand className="size-5" />
                  <span>{tc("aiGenerate")}</span>
                </div>
              </button>

              {tiles.map((tile, index) => {
                if (tile.kind === "task") {
                  const { task } = tile;
                  const isFailed = task.status === "failed";
                  return (
                    <div
                      key={task.id}
                      className={
                        isFailed
                          ? "relative flex aspect-square items-center justify-center rounded-lg border-2 border-destructive/40 bg-muted/30"
                          : "relative flex aspect-square items-center justify-center rounded-lg border-2 border-transparent bg-muted/30"
                      }
                    >
                      {isFailed ? (
                        <>
                          <button
                            type="button"
                            title={task.error || tc("generateFailed")}
                            onClick={() => retryImageTask(task.id)}
                            className="flex flex-col items-center gap-1 text-destructive hover:text-destructive/80"
                          >
                            <IconRefresh className="size-5" />
                            <span className="text-[10px]">{tc("retry")}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => dispatch(removeTask(task.id))}
                            title={tc("delete")}
                            className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-black/55 text-white hover:bg-destructive"
                          >
                            <IconX className="size-3" />
                          </button>
                        </>
                      ) : (
                        <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
                      )}
                    </div>
                  );
                }

                const { path } = tile;
                const active = normalizeStoragePath(previewPath) === normalizeStoragePath(path);
                const checked = selectedIndex === index;
                return (
                  <button
                    key={`${path}_${index}`}
                    type="button"
                    onClick={() => setPreviewPath(path)}
                    className={`relative aspect-square overflow-hidden rounded-lg border-2 transition-colors ${
                      active
                        ? "border-primary"
                        : "border-transparent bg-muted/30 hover:border-primary/40"
                    }`}
                  >
                    <img src={ossUrl(path)} alt="" className="h-full w-full object-cover" />
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedIndex((current) => (current === index ? null : index));
                        setPreviewPath(path);
                      }}
                      className={`absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full border transition-colors ${
                        checked
                          ? "border-primary bg-primary text-white"
                          : "border-white/30 bg-black/55 text-transparent hover:border-primary hover:bg-primary/35"
                      }`}
                    >
                      <IconCheck className="size-3" />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="w-[360px] shrink-0 rounded-lg border border-border bg-black">
            {previewPath ? (
              <img
                src={ossUrl(previewPath)}
                alt=""
                className="h-full w-full rounded-lg object-contain p-4"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                点击左侧图片预览
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="mt-0">
          <Button variant="outline" color="muted" onClick={() => onOpenChange(false)}>
            {tc("cancel")}
          </Button>
          <Button onClick={handleConfirm} disabled={selectedIndex === null && !previewPath}>
            {tc("confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
