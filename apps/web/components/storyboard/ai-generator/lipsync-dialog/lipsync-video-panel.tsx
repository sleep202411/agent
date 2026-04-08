"use client";

import { useTranslations } from "next-intl";
import {
  IconCircleCheck,
  IconDownload,
  IconLoader2,
  IconMask,
  IconPlayerPlay,
  IconRefresh,
  IconSparkles,
  IconUserCircle,
  IconVideo,
  IconX,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { MediaPreviewPanel } from "../media-preview-panel";
import type { ToolbarAction } from "@/components/ui/floating-toolbar";
import type { RawAiModel } from "@/src/types/workspace";
import {
  ossUrl,
  getVideoThumbnail,
  type VideoResultItem,
  type PickerTarget,
} from "./lipsync-types";

export interface LipsyncVideoPanelProps {
  // Video results
  allVideoItems: VideoResultItem[];
  loadingVideoHistory: boolean;
  currentPreviewPath: string;
  onSelectPreview: (path: string) => void;

  // Preview actions
  currentPreviewItem: VideoResultItem | null;
  previewIsPreferred: boolean;
  onDownload: (path: string, filename: string) => void;
  onSetPreferred?: (item: { id: string; url?: string; storagePath?: string }) => void;

  // References
  referenceVideo: string;
  onReferenceVideoChange: (path: string) => void;
  referenceFace: string;
  onReferenceFaceChange: (path: string) => void;
  referenceAudio: string;

  // Lip sync model
  lipSyncModel: string;
  onLipSyncModelChange: (model: string) => void;
  lipSyncModels: RawAiModel[];
  loadingLipSyncModels: boolean;
  lipSyncModelCost: number;

  // Actions
  onGenerateVideo: () => void;
  onRetryVideo: (item: VideoResultItem) => void;
  onOpenPicker: (target: PickerTarget) => void;
  isGenerating: boolean;
  shotNumber?: number;
  shotId: string;
}

export function LipsyncVideoPanel({
  allVideoItems,
  loadingVideoHistory,
  currentPreviewPath,
  onSelectPreview,
  currentPreviewItem,
  previewIsPreferred,
  onDownload,
  onSetPreferred,
  referenceVideo,
  onReferenceVideoChange,
  referenceFace,
  onReferenceFaceChange,
  referenceAudio,
  lipSyncModel,
  onLipSyncModelChange,
  lipSyncModels,
  loadingLipSyncModels,
  lipSyncModelCost,
  onGenerateVideo,
  onRetryVideo,
  onOpenPicker,
  isGenerating,
  shotNumber,
  shotId,
}: LipsyncVideoPanelProps) {
  const t = useTranslations("storyboard");
  const previewUrl = currentPreviewItem?.path ? ossUrl(currentPreviewItem.path) : "";

  const toolbarActions: ToolbarAction[] = currentPreviewItem?.path
    ? [
        {
          key: "download",
          icon: <IconDownload className="size-4" />,
          title: t("download"),
          onClick: () =>
            onDownload(currentPreviewItem.path, `lip_sync_shot_${shotNumber ?? shotId}.mp4`),
        },
        ...(onSetPreferred
          ? [
              {
                key: "prefer",
                icon: <IconCircleCheck className="size-4" />,
                active: previewIsPreferred,
                title: previewIsPreferred ? t("finalizedVersion") : t("setAsFinalized"),
                onClick: () =>
                  onSetPreferred({
                    id: currentPreviewItem.id,
                    storagePath: currentPreviewItem.path,
                    url: ossUrl(currentPreviewItem.path),
                  }),
              },
            ]
          : []),
      ]
    : [];

  return (
    <div className="flex h-full flex-col gap-4">
      {/* ── Top: Video list sidebar + Preview ── */}
      <div className="flex min-h-0 flex-1 gap-4">
        {/* Video list sidebar (140px) */}
        <div className="flex w-35 shrink-0 flex-col bg-white/2">
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
            {!allVideoItems.length ? (
              <div className="flex h-full items-center justify-center text-center text-xs text-[#8F8F92]">
                {t("noVideo")}
              </div>
            ) : (
              allVideoItems.map((item, index) => {
                const selected = item.path === currentPreviewPath;
                return (
                  <button
                    key={item.id || `${item.path}_${index}`}
                    type="button"
                    className={cn(
                      "relative w-full overflow-hidden rounded border bg-black transition-colors",
                      selected ? "border-[#E52227]" : "border-white/10 hover:border-white/20"
                    )}
                    onClick={() => {
                      if (item.status === "failed") {
                        onRetryVideo(item);
                        return;
                      }
                      if (!item.path) return;
                      onSelectPreview(item.path);
                    }}
                  >
                    {item.status === "generating" ? (
                      <div className="flex aspect-video items-center justify-center">
                        <IconLoader2 className="size-5 animate-spin text-white/80" />
                      </div>
                    ) : item.status === "failed" ? (
                      <div className="flex aspect-video flex-col items-center justify-center gap-1 text-[#E52227]">
                        <IconRefresh className="size-4" />
                        <span className="text-[10px]">重试</span>
                      </div>
                    ) : (
                      <>
                        <img
                          src={getVideoThumbnail(item.path)}
                          alt=""
                          className="aspect-video w-full object-cover"
                        />
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                          <div className="flex size-7 items-center justify-center rounded-full bg-black/55 text-white">
                            <IconPlayerPlay className="ml-0.5 size-3.5" />
                          </div>
                        </div>
                      </>
                    )}
                    {selected ? (
                      <div className="absolute inset-x-0 bottom-0 bg-[#E52227] py-0.5 text-center text-[9px] text-white">
                        {t("previewing")}
                      </div>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Video preview */}
        <MediaPreviewPanel
          type="video"
          previewUrl={previewUrl}
          emptyText={t("selectLeftToPreview")}
          emptyIcon={<IconMask className="size-10" />}
          toolbarActions={toolbarActions}
          className="flex-1"
        />
      </div>

      {/* ── Bottom: Reference config + Generate (210px) ── */}
      <div className="flex h-52.5 shrink-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-white/3 p-3">
        {/* Top row: video + face pickers (flex-1) */}
        <div className="flex min-h-0 flex-1 items-start gap-3">
          {/* Reference video */}
          <div className="w-[100px] space-y-1.5">
            <div className="text-xs text-[#8F8F92]">{t("video")}</div>
            {referenceVideo ? (
              <div className="relative aspect-square overflow-hidden rounded-lg border border-white/10 bg-black">
                <img
                  src={getVideoThumbnail(referenceVideo)}
                  alt=""
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                  onClick={() => onReferenceVideoChange("")}
                >
                  <IconX className="size-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onOpenPicker("video")}
                className="flex aspect-square w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#E52227]/60 bg-[#E52227]/10 text-[#E52227] transition-colors hover:bg-[#E52227]/15"
              >
                <IconVideo className="size-6" />
                <span className="text-xs">上传</span>
              </button>
            )}
          </div>

          {/* Reference face */}
          <div className="w-[100px] space-y-1.5">
            <div className="text-xs text-[#8F8F92]">角色</div>
            {referenceFace ? (
              <div className="relative aspect-square overflow-hidden rounded-lg border border-white/10 bg-black">
                <img src={ossUrl(referenceFace)} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                  onClick={() => onReferenceFaceChange("")}
                >
                  <IconX className="size-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onOpenPicker("face")}
                className="flex aspect-square w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#E52227]/60 bg-[#E52227]/10 text-[#E52227] transition-colors hover:bg-[#E52227]/15"
              >
                <IconUserCircle className="size-6" />
                <span className="text-xs">{t("selectCharacter")}</span>
              </button>
            )}
          </div>
        </div>

        {/* Bottom row: model + generate (same line) */}
        <div className="mt-auto flex shrink-0 items-center gap-3 pt-2">
          <NativeSelect
            value={lipSyncModel}
            onChange={(event) => onLipSyncModelChange(event.target.value)}
            disabled={loadingLipSyncModels}
            className="h-8 max-w-[160px] text-xs"
          >
            <NativeSelectOption value="" disabled>
              {loadingLipSyncModels ? t("loadingModels") : t("lipSyncModel")}
            </NativeSelectOption>
            {lipSyncModels.map((item) => {
              const value = String(item.serviceCode ?? "");
              return (
                <NativeSelectOption key={value} value={value}>
                  {item.serviceName ?? value}
                </NativeSelectOption>
              );
            })}
          </NativeSelect>

          {lipSyncModelCost ? (
            <span className="text-[11px] text-[#8F8F92]">{lipSyncModelCost}积分</span>
          ) : null}

          <span className="text-[11px] text-[#8F8F92]">
            {t("audio")}：
            <span className={referenceAudio ? "text-white/90" : "text-[#E52227]"}>
              {referenceAudio ? t("selected") : t("notSelected")}
            </span>
          </span>

          <div className="flex-1" />

          <Button
            className="h-8 bg-[#E52227] px-4 text-white hover:bg-[#FF3D42]"
            onClick={onGenerateVideo}
            disabled={isGenerating || !lipSyncModel}
          >
            {isGenerating ? (
              <IconLoader2 className="size-3.5 animate-spin" />
            ) : (
              <IconSparkles className="size-3.5" />
            )}
            {t("generateLipSync")}
          </Button>
        </div>
      </div>
    </div>
  );
}
