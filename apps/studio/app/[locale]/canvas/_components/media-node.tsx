"use client";

import { memo, useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import type { Node, NodeProps } from "@xyflow/react";
import { IconDownload, IconMaximize, IconMusic, IconPencil, IconUpload } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useCanvasGraphContext } from "@/lib/collab/canvas-graph-context";
import { CanvasNodeToolbar, ToolbarButton } from "./node-toolbar";
import { PortPlus } from "./ports";
import { CanvasMediaViewer } from "./canvas-media-viewer";

export type MediaAssetNodeData = {
  src: string;
  mediaAssetId?: string;
  label?: string;
};

export type VideoAssetNodeType = Node<MediaAssetNodeData, "videoAsset">;
export type AudioAssetNodeType = Node<MediaAssetNodeData, "audioAsset">;

function downloadMedia(src: string, name: string) {
  const anchor = document.createElement("a");
  anchor.href = src;
  anchor.download = name;
  anchor.click();
}

function MediaAssetNodeComponent({
  id,
  data,
  selected,
  kind,
}: NodeProps<VideoAssetNodeType | AudioAssetNodeType> & { kind: "video" | "audio" }) {
  const t = useTranslations("canvasNodes");
  const [viewerOpen, setViewerOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const { patchNodeData, renameAssetsByMediaAssetId } = useCanvasGraphContext();
  const title = data.label ?? t(`media.${kind}.title`);

  const onDownload = useCallback(() => {
    downloadMedia(data.src, title);
  }, [data.src, title]);

  const commitName = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      patchNodeData(id, { label: trimmed || undefined });
      if (data.mediaAssetId) renameAssetsByMediaAssetId(data.mediaAssetId, trimmed);
      setRenaming(false);
    },
    [data.mediaAssetId, id, patchNodeData, renameAssetsByMediaAssetId]
  );

  return (
    <div className="relative">
      <div className="mb-1.5 flex max-w-[240px] items-center gap-1.5 px-0.5 text-xs text-white/50">
        <IconUpload className="size-3.5 shrink-0" stroke={1.8} />
        {renaming ? (
          <input
            autoFocus
            defaultValue={title}
            onBlur={(event) => commitName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              else if (event.key === "Escape") setRenaming(false);
            }}
            className="nodrag w-full min-w-0 bg-transparent text-white/80 outline-none"
          />
        ) : (
          <span className="truncate">{title}</span>
        )}
      </div>
      <div className={cn("relative rounded-xl bg-card", selected && "ring-2 ring-ring")}>
        <PortPlus type="source" id="output" side="right" dataType={kind} />
        <CanvasNodeToolbar nodeId={id} visible={selected ?? false}>
          {kind === "video" ? (
            <ToolbarButton label={t("media.preview")} onClick={() => setViewerOpen(true)} iconOnly>
              <IconMaximize className="size-4" stroke={1.8} />
            </ToolbarButton>
          ) : null}
          <ToolbarButton label={t("media.download")} onClick={onDownload} iconOnly>
            <IconDownload className="size-4" stroke={1.8} />
          </ToolbarButton>
          <ToolbarButton label={t("media.rename")} onClick={() => setRenaming(true)}>
            <IconPencil className="size-4" stroke={1.8} />
          </ToolbarButton>
        </CanvasNodeToolbar>

        {kind === "video" ? (
          <video
            src={data.src}
            muted
            playsInline
            draggable={false}
            onDoubleClick={(event) => {
              event.stopPropagation();
              setViewerOpen(true);
            }}
            className="block h-[136px] w-[240px] rounded-xl object-cover select-none"
          />
        ) : (
          <div className="flex h-[112px] w-[240px] flex-col justify-center gap-3 rounded-xl bg-card px-4">
            <div className="flex min-w-0 items-center gap-2 text-white/70">
              <IconMusic className="size-5 shrink-0" stroke={1.7} />
              <span className="truncate text-sm">{title}</span>
            </div>
            <audio src={data.src} controls className="h-8 w-full [color-scheme:dark]" />
          </div>
        )}
      </div>

      {viewerOpen && kind === "video" ? (
        <CanvasMediaViewer
          type="video"
          src={data.src}
          title={title}
          alt={title}
          downloadName={title}
          onClose={() => setViewerOpen(false)}
        />
      ) : null}
    </div>
  );
}

export const VideoAssetNode = memo((props: NodeProps<VideoAssetNodeType>) => (
  <MediaAssetNodeComponent {...props} kind="video" />
));
VideoAssetNode.displayName = "VideoAssetNode";

export const AudioAssetNode = memo((props: NodeProps<AudioAssetNodeType>) => (
  <MediaAssetNodeComponent {...props} kind="audio" />
));
AudioAssetNode.displayName = "AudioAssetNode";
