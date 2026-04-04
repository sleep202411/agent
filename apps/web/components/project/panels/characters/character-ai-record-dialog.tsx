"use client";

import { useCallback, useEffect, useState } from "react";
import { IconCirclePlus, IconLoader2, IconWand, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { AiImageGeneratorDialog } from "@/components/storyboard/ai-generator";
import { cn } from "@/lib/utils";
import { backendApi, type Paginated } from "@/src/lib/api";
import type { AssetRecord } from "@/src/types/workspace";
import { buildOssUrl } from "@/src/lib/uploads/workspace-upload";
import { getRecordPath, normalizeStoragePath, ROLE_RECORD_COLUMN_ID } from "./character-utils";

export function CharacterAiRecordDialog({
  open,
  onOpenChange,
  characterId,
  prompt,
  referenceImageUrl,
  selectedPath,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  characterId: string;
  prompt: string;
  referenceImageUrl?: string;
  selectedPath?: string;
  onSelect: (path: string) => void;
}) {
  const [records, setRecords] = useState<AssetRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewPath, setPreviewPath] = useState("");
  const [selectedRecordPath, setSelectedRecordPath] = useState("");
  const [generatorOpen, setGeneratorOpen] = useState(false);

  const loadHistory = useCallback(async () => {
    if (!characterId) {
      setRecords([]);
      return;
    }
    try {
      setLoading(true);
      const data = await backendApi.post<Paginated<AssetRecord>>("/api/ai/record/role/list", {
        data: { page: 1, pageSize: 50, roleId: characterId, type: "img", sort: 0 },
      });
      const list = (data?.list ?? []).filter((item) => getRecordPath(item));
      setRecords(list);
    } catch (error) {
      console.error("[CharacterAiRecordDialog] 获取历史失败:", error);
      toast.error("获取 AI 记录失败");
    } finally {
      setLoading(false);
    }
  }, [characterId]);

  useEffect(() => {
    if (!open) return;
    void loadHistory();
  }, [loadHistory, open]);

  useEffect(() => {
    if (!open) return;
    const nextPath = normalizeStoragePath(selectedPath);
    setSelectedRecordPath(nextPath);
    setPreviewPath(nextPath);
  }, [open, selectedPath]);

  useEffect(() => {
    if (!previewPath && records[0]) {
      setPreviewPath(getRecordPath(records[0]));
    }
  }, [previewPath, records]);

  const previewUrl = buildOssUrl(previewPath);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="w-[1000px] max-w-[calc(100vw-2rem)] overflow-hidden p-0 sm:max-w-[1000px]"
        >
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <DialogTitle>AI 生图</DialogTitle>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <IconX className="size-4" />
            </button>
          </div>

          <div className="flex h-[620px] gap-4 p-4">
            <div className="flex w-[360px] flex-col rounded-lg border border-border">
              <div className="grid grid-cols-3 gap-3 p-3">
                <button
                  type="button"
                  onClick={() => setGeneratorOpen(true)}
                  className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-primary bg-primary/10 text-primary transition-colors hover:bg-primary/15"
                >
                  <div className="flex flex-col items-center gap-2 text-xs">
                    <IconWand className="size-5" />
                    <span>AI 生图</span>
                  </div>
                </button>

                {loading ? (
                  <div className="col-span-2 flex aspect-square items-center justify-center rounded-lg border border-border bg-muted/30">
                    <IconLoader2 className="size-5 animate-spin text-muted-foreground" />
                  </div>
                ) : null}

                {records.map((record) => {
                  const path = getRecordPath(record);
                  const active = path === previewPath;
                  const selected = path === selectedRecordPath;
                  return (
                    <button
                      key={`${record.id ?? path}`}
                      type="button"
                      onClick={() => setPreviewPath(path)}
                      className={cn(
                        "relative aspect-square overflow-hidden rounded-lg border-2 border-transparent bg-muted/30 transition-colors",
                        active && "border-primary"
                      )}
                    >
                      <img src={buildOssUrl(path)} alt="" className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedRecordPath((current) => (current === path ? "" : path));
                        }}
                        className={cn(
                          "absolute right-1 top-1 flex size-5 items-center justify-center rounded-full border text-white transition-colors",
                          selected
                            ? "border-primary bg-primary"
                            : "border-white/25 bg-black/55 hover:border-white/45"
                        )}
                      >
                        {selected ? <IconCirclePlus className="size-3.5 rotate-45" /> : null}
                      </button>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex min-w-0 flex-1 items-center justify-center rounded-lg border border-border bg-black">
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt=""
                  className="max-h-full max-w-full rounded-lg object-contain p-4"
                />
              ) : (
                <div className="text-sm text-muted-foreground">点击左侧图片预览</div>
              )}
            </div>
          </div>

          <DialogFooter className="mt-0">
            <Button variant="outline" color="muted" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button
              onClick={() => {
                const nextPath = selectedRecordPath || previewPath;
                if (!nextPath) return;
                onSelect(nextPath);
                onOpenChange(false);
              }}
              disabled={!selectedRecordPath && !previewPath}
            >
              确认
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {characterId ? (
        <AiImageGeneratorDialog
          open={generatorOpen}
          onOpenChange={(nextOpen) => {
            setGeneratorOpen(nextOpen);
            if (!nextOpen) {
              void loadHistory();
            }
          }}
          shotId={characterId}
          shotColumnId={ROLE_RECORD_COLUMN_ID}
          defaultPrompt={prompt}
          defaultRefImage={referenceImageUrl}
        />
      ) : null}
    </>
  );
}
