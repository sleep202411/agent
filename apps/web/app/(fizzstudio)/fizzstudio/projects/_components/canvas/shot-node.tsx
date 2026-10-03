"use client";
import { memo, type CSSProperties } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  IconArrowsMaximize,
  IconDownload,
  IconLoader2,
  IconPhoto,
  IconPlus,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";
import { downloadMediaFile, inferDownloadFilename } from "@/src/lib/media-download";
import type { MediaItem, Shot } from "../../_data/storyboard-schema";
import { SHOT_NODE_WIDTH } from "./canvas-constants";
import { CanvasGenerationComposer } from "./canvas-generation-composer";
import type { CanvasGenerationDraft, CanvasGenerationRequest } from "./canvas-generation";
export type NodeComposerLayout = {
  offsetX: number;
  placement: "top" | "bottom";
};

export interface ShotNodeData {
  shot: Shot;
  index: number;
  columnIds: {
    image: string;
    video: string;
    description: string;
  };
  sourceHandleActive: boolean;
  targetHandleActive: boolean;
  inspectorSelected: boolean;
  relation: "selected" | "incoming" | "outgoing" | "neutral";
  composerVisible: boolean;
  composerLayout: NodeComposerLayout;
  composerState?: ShotComposerState;
  onComposerStateChange?: ShotComposerStateUpdater;
  onSubmitGeneration?: (shot: Shot, request: ShotGenerationRequest) => Promise<void>;
  onOpenPreview?: (mediaId: string) => void;
  viewportZoom: number;
  [key: string]: unknown;
}

type NodeMedia = {
  kind: "image" | "video";
  item: MediaItem;
};

type NodeTone = {
  accent: string;
  border: string;
  glow: string;
};

const NEUTRAL_TONE: NodeTone = {
  accent: "#9ba1aa",
  border: "rgba(255,255,255,0.12)",
  glow: "rgba(0,0,0,0.76)",
};

const SELECTED_TONE: NodeTone = {
  accent: "#d7dbe2",
  border: "rgba(215,219,226,0.72)",
  glow: "rgba(215,219,226,0.2)",
};

const INCOMING_TONE: NodeTone = {
  accent: "#aab6c5",
  border: "rgba(170,182,197,0.46)",
  glow: "rgba(157,170,188,0.16)",
};

const OUTGOING_TONE: NodeTone = {
  accent: "#d8dde5",
  border: "rgba(216,221,229,0.44)",
  glow: "rgba(222,227,234,0.16)",
};

export type ShotComposerState = CanvasGenerationDraft;
export type ShotGenerationRequest = CanvasGenerationRequest;
export type ShotComposerStateUpdater = (shotId: string, state: ShotComposerState) => void;
function preferredMedia(shot: Shot, columnId: string): MediaItem | undefined {
  const media = shot.cells[columnId]?.media ?? [];
  return media.find((item) => item.preferred) ?? media[0];
}

function resolveNodeMedia(shot: Shot, columnIds: ShotNodeData["columnIds"]): NodeMedia | null {
  const video = preferredMedia(shot, columnIds.video);
  if (video) return { kind: "video", item: video };

  const image = preferredMedia(shot, columnIds.image);
  if (image) return { kind: "image", item: image };

  return null;
}

function getCellText(shot: Shot, columnId: string): string {
  const cell = shot.cells[columnId] ?? {};
  return cell.richText ?? cell.text ?? "";
}

function resolveNodeTone(relation: ShotNodeData["relation"]) {
  if (relation === "selected") return SELECTED_TONE;
  if (relation === "incoming") return INCOMING_TONE;
  if (relation === "outgoing") return OUTGOING_TONE;
  return NEUTRAL_TONE;
}

function ShotNodeImpl({ data, selected }: NodeProps) {
  const d = data as ShotNodeData;
  const t = useTranslations("fizzStudio");
  const {
    shot,
    columnIds,
    composerVisible,
    inspectorSelected,
    relation,
    sourceHandleActive,
    targetHandleActive,
  } = d;
  const active = selected || inspectorSelected;
  const media = resolveNodeMedia(shot, columnIds);
  const visualRelation = active ? "selected" : relation;
  const relationActive = visualRelation !== "neutral";
  const tone = resolveNodeTone(visualRelation);
  const sourceHandleHighlighted = active || sourceHandleActive;
  const targetHandleHighlighted = active || targetHandleActive;
  const mediaStatus = media?.item.status;
  const mediaError = media?.item.error;
  const generating = mediaStatus === "pending" || mediaStatus === "generating";
  const failed = mediaStatus === "failed" || mediaStatus === "cancelled";
  const statusLabel =
    mediaStatus === "pending"
      ? t("sbGenerationQueued")
      : mediaStatus === "generating"
        ? t("sbGenerationRunning")
        : failed
          ? mediaError || t("sbGenerationFailed")
          : t("sbNoFrame");

  const mediaUrl = media?.item.url;

  return (
    <div
      className={cn(
        "group relative aspect-video overflow-visible rounded-md border bg-[#222226] transition-[border-color,box-shadow]",
        relationActive
          ? "shadow-[0_18px_48px_-26px_var(--node-glow)]"
          : "shadow-[0_16px_42px_-30px_rgba(0,0,0,0.95)]"
      )}
      style={
        {
          "--node-glow": tone.glow,
          borderColor: tone.border,
          width: SHOT_NODE_WIDTH,
        } as CSSProperties
      }
    >
      <Handle
        type="target"
        position={Position.Left}
        className={cn(
          "!flex !items-center !justify-center !border-2 !border-[#09090b] !opacity-95 transition-[background-color,box-shadow,width,height]",
          targetHandleHighlighted ? "!size-4" : "!size-3 group-hover:!bg-white"
        )}
        style={{
          backgroundColor: targetHandleHighlighted ? tone.accent : "rgba(155,161,170,0.88)",
          boxShadow: targetHandleHighlighted
            ? `0 0 0 4px ${tone.glow}`
            : "0 0 0 3px rgba(255,255,255,0.03)",
        }}
      >
        <IconPlus
          className={cn(
            "size-2.5 text-[#09090b] transition-opacity",
            active ? "opacity-85" : "opacity-0"
          )}
        />
      </Handle>
      <Handle
        type="source"
        position={Position.Right}
        className={cn(
          "!flex !items-center !justify-center !border-2 !border-[#09090b] !opacity-95 transition-[background-color,box-shadow,width,height]",
          sourceHandleHighlighted ? "!size-4" : "!size-3 group-hover:!bg-white"
        )}
        style={{
          backgroundColor: sourceHandleHighlighted ? tone.accent : "rgba(155,161,170,0.88)",
          boxShadow: sourceHandleHighlighted
            ? `0 0 0 4px ${tone.glow}`
            : "0 0 0 3px rgba(255,255,255,0.03)",
        }}
      >
        <IconPlus
          className={cn(
            "size-2.5 text-[#09090b] transition-opacity",
            active ? "opacity-85" : "opacity-0"
          )}
        />
      </Handle>

      {mediaUrl ? (
        <div className="nodrag nopan absolute right-2 top-2 z-20 flex items-center gap-1 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100">
          <button
            type="button"
            onClick={() => d.onOpenPreview?.(media.item.id)}
            aria-label={t("sbNodePreview")}
            title={t("sbNodePreview")}
            className="grid size-7 place-items-center rounded-lg bg-black/52 text-white backdrop-blur-md transition-colors hover:bg-black/72"
          >
            <IconArrowsMaximize className="size-3.5" stroke={1.8} />
          </button>
          <button
            type="button"
            onClick={() => {
              void (async () => {
                const saved = await downloadMediaFile(mediaUrl, {
                  filename: inferDownloadFilename(
                    mediaUrl,
                    media.item.mimeType,
                    `shot-${d.index + 1}`
                  ),
                });
                if (!saved) toast.error(t("sbDownloadFailed"));
              })();
            }}
            aria-label={t("sbNodeDownload")}
            title={t("sbNodeDownload")}
            className="grid size-7 place-items-center rounded-lg bg-black/52 text-white backdrop-blur-md transition-colors hover:bg-black/72"
          >
            <IconDownload className="size-3.5" stroke={1.8} />
          </button>
        </div>
      ) : null}

      {media?.kind === "image" && media.item.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={media.item.url}
          alt=""
          className="size-full rounded-[5px] object-cover"
          draggable={false}
        />
      ) : media?.kind === "video" && media.item.url ? (
        <video
          src={media.item.url}
          className="size-full rounded-[5px] object-cover"
          muted
          playsInline
          preload="metadata"
        />
      ) : (
        <div className="flex size-full flex-col items-center justify-center rounded-[5px] bg-[#242426] text-white/24">
          {generating ? (
            <IconLoader2 className="size-6 animate-spin text-white/42" />
          ) : (
            <IconPhoto className={cn("size-6", failed ? "text-white/34" : "text-white/22")} />
          )}
          <span
            className={cn(
              "mt-2 max-w-[80%] truncate text-[12px] font-normal leading-4",
              failed ? "text-white/45" : generating ? "text-white/46" : "text-white/28"
            )}
          >
            {statusLabel}
          </span>
        </div>
      )}

      {generating && media?.item.url ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-[5px] bg-black/18">
          <div className="inline-flex h-7 items-center gap-1.5 rounded-md border border-white/[0.13] bg-black/55 px-2 text-[11px] font-normal text-white/74 shadow-xl shadow-black/35">
            <IconLoader2 className="size-3 animate-spin" />
            {statusLabel}
          </div>
        </div>
      ) : null}

      {composerVisible ? (
        <CanvasGenerationComposer
          key={shot.id}
          type="video"
          initial={
            d.composerState ?? {
              prompt: getCellText(shot, columnIds.description),
              modelId: "",
              settings: {},
              referenceField: "",
            }
          }
          layout={d.composerLayout}
          zoom={d.viewportZoom}
          busy={generating}
          referenceUrl={preferredMedia(shot, columnIds.image)?.url}
          onChange={(draft) => d.onComposerStateChange?.(shot.id, draft)}
          onSubmit={
            d.onSubmitGeneration ? (request) => d.onSubmitGeneration!(shot, request) : undefined
          }
        />
      ) : null}
    </div>
  );
}

export const ShotNode = memo(ShotNodeImpl);
