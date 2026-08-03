"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  IconAlertTriangle,
  IconArtboard,
  IconLoader2,
  IconMaximize,
  IconPhoto,
  IconSparkles,
  IconUnlink,
  IconUpload,
  IconVideo,
} from "@tabler/icons-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CanvasDrawerPanel } from "@/components/canvas/canvas-drawer-panel";
import { CanvasMediaViewer } from "@/components/canvas/authoring/canvas-media-viewer";
import { useCanvasGraphContext } from "@/lib/canvas-core/canvas-graph-context";
import { SHOT_REFERENCE_FIELDS } from "@/lib/canvas-authoring/shot-node";
import type { GenerationState } from "@/lib/canvas-authoring/generation-api";
import { cn } from "@/lib/utils";
import { ShotGenerationPanel } from "./shot-generation-panel";
import type { CanvasSource, ShotPicture, ShotRow } from "./use-storyboard";

const ACCEPT: Record<"image" | "video", string> = {
  image: "image/jpeg,image/png,image/webp",
  video: "video/mp4,video/quicktime",
};

export interface ShotPictureDrawerActions {
  onGenerate: (shotId: string, modality: "image" | "video") => void;
  onUpload: (
    shotId: string,
    file: File,
    kind: "image" | "video",
    onProgress: (progress: number) => void
  ) => Promise<void>;
  onAttach: (shotId: string, sourceNodeId: string) => void;
  onDetach: (shotId: string, edgeId: string) => void;
  onOpenOnCanvas: (nodeId: string) => void;
}

/**
 * The working panel for one shot's picture — a master-detail companion to the
 * table, not a modal.
 *
 * A storyboard is read as a sequence, so the surface that edits one shot must
 * not cover the ones around it: the drawer sits beside the table, the table
 * reflows, and generation (which takes minutes) runs while the board stays
 * usable. Selecting another row swaps the detail without any open/close cycle.
 */
export function ShotPictureDrawer({
  row,
  sources,
  canEdit,
  actions,
  onClose,
}: {
  row: ShotRow;
  sources: readonly CanvasSource[];
  canEdit: boolean;
  actions: ShotPictureDrawerActions;
  onClose: () => void;
}) {
  const t = useTranslations("storyboard");

  return (
    // The app's one drawer slot — same chrome as the canvas asset library, just
    // laid out inline so the table gives way instead of being covered.
    <CanvasDrawerPanel
      placement="inline"
      title={t("drawer.title", { index: row.number })}
      icon={<IconPhoto className="size-4" stroke={1.8} />}
      count={row.pictures.length}
      closeLabel={t("drawer.close")}
      onClose={onClose}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pt-4 pb-5">
        {SHOT_REFERENCE_FIELDS.map((field) => {
          const kind = field.kind === "video" ? "video" : "image";
          return (
            <PictureSlot
              key={field.field}
              shotId={row.id}
              kind={kind}
              picture={row.pictures.find((candidate) => candidate.kind === field.kind)}
              sources={sources.filter((source) => source.kind === field.kind)}
              canEdit={canEdit}
              actions={actions}
            />
          );
        })}
      </div>
    </CanvasDrawerPanel>
  );
}

function PictureSlot({
  shotId,
  kind,
  picture,
  sources,
  canEdit,
  actions,
}: {
  shotId: string;
  kind: "image" | "video";
  picture: ShotPicture | undefined;
  sources: readonly CanvasSource[];
  canEdit: boolean;
  actions: ShotPictureDrawerActions;
}) {
  const t = useTranslations("storyboard");
  const { nodes } = useCanvasGraphContext();
  const fileRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [picking, setPicking] = useState(false);

  const source = picture ? nodes.find((node) => node.id === picture.sourceNodeId) : undefined;
  const generation = (source?.data as { generation?: GenerationState } | undefined)?.generation;
  const isGenerationSource = picture?.generationModality != null;

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setUploadError(null);
    setProgress(0);
    try {
      await actions.onUpload(shotId, file, kind, setProgress);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : t("drawer.uploadFailed"));
    } finally {
      setProgress(null);
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-white/40">
        {kind === "video" ? (
          <IconVideo className="size-3.5" stroke={1.8} />
        ) : (
          <IconPhoto className="size-3.5" stroke={1.8} />
        )}
        {t(kind === "video" ? "drawer.slotClip" : "drawer.slotFrame")}
        {picture ? (
          <div className="ml-auto flex items-center gap-1">
            {picture.url ? (
              <SlotAction
                label={t("drawer.openViewer")}
                icon={<IconMaximize className="size-3.5" stroke={1.8} />}
                onClick={() => setViewerOpen(true)}
              />
            ) : null}
            <SlotAction
              label={t("frame.viewOnCanvas")}
              icon={<IconArtboard className="size-3.5" stroke={1.8} />}
              onClick={() => actions.onOpenOnCanvas(picture.sourceNodeId)}
            />
            {canEdit ? (
              <SlotAction
                label={t("frame.unlink")}
                icon={<IconUnlink className="size-3.5" stroke={1.8} />}
                onClick={() => actions.onDetach(shotId, picture.edgeId)}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Preview */}
      <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-white/[0.05]">
        {picture?.url ? (
          kind === "video" ? (
            <video src={picture.url} controls playsInline className="size-full object-contain" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={picture.url} alt="" className="size-full object-contain" />
          )
        ) : picture?.status === "failed" ? (
          <div className="flex flex-col items-center gap-1.5 px-6 text-center">
            <IconAlertTriangle className="size-5 text-destructive" stroke={1.7} />
            <p className="text-[11px] text-white/45">{picture.error ?? t("frame.failed")}</p>
          </div>
        ) : (
          <p className="text-[11px] text-white/30">{t("drawer.emptySlot")}</p>
        )}
        {picture?.status === "running" || progress !== null ? (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/55">
            <IconLoader2 className="size-6 animate-spin text-white/70" stroke={1.8} />
            <span className="text-[11px] text-white/60">
              {progress !== null
                ? t("drawer.uploading", { progress: Math.round(progress) })
                : t("frame.generating")}
            </span>
          </span>
        ) : null}
      </div>

      {uploadError ? <p className="text-[11px] text-destructive">{uploadError}</p> : null}

      {/* Candidates — reserved, honestly: the take history it needs doesn't exist yet. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            disabled
            className="flex h-7 items-center gap-1.5 self-start rounded-lg px-2 text-[11px] text-white/25"
          >
            <IconSparkles className="size-3.5" stroke={1.8} />
            {t("drawer.candidates")}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("drawer.candidatesSoon")}</TooltipContent>
      </Tooltip>

      {/* How this was made — the artifact's own recipe, read-only. */}
      {picture && isGenerationSource ? (
        <div className="flex flex-col gap-1 rounded-xl bg-white/[0.03] px-3 py-2.5">
          <p className="text-[11px] font-medium text-white/45">{t("drawer.sourceHeading")}</p>
          <p className="text-xs/relaxed whitespace-pre-wrap text-white/70">
            {generation?.outputs?.length && source
              ? ((source.data as { prompt?: string }).prompt ?? t("drawer.noPrompt"))
              : t("drawer.noPrompt")}
          </p>
          {(source?.data as { modelName?: string } | undefined)?.modelName ? (
            <p className="text-[11px] text-white/35">
              {t("drawer.sourceModel")} · {(source?.data as { modelName?: string }).modelName}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Controls: the generation card's own composer, or the ways to fill an empty slot. */}
      {canEdit ? (
        isGenerationSource && picture ? (
          <ShotGenerationPanel nodeId={picture.sourceNodeId} />
        ) : picture ? (
          <p className="text-[11px] text-white/35">
            {t(
              source?.type === "image" || source?.type === "videoAsset"
                ? "drawer.sourceUploaded"
                : "drawer.sourcePicked"
            )}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-1.5">
              <SlotButton
                label={t("drawer.generate")}
                icon={<IconSparkles className="size-3.5" stroke={1.8} />}
                onClick={() => actions.onGenerate(shotId, kind)}
              />
              <SlotButton
                label={t("drawer.upload")}
                icon={<IconUpload className="size-3.5" stroke={1.8} />}
                onClick={() => fileRef.current?.click()}
              />
              <SlotButton
                label={t("drawer.pick")}
                icon={<IconArtboard className="size-3.5" stroke={1.8} />}
                pressed={picking}
                onClick={() => setPicking((open) => !open)}
              />
            </div>
            {picking ? (
              <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-xl bg-white/[0.03] p-1.5">
                {sources.length === 0 ? (
                  <p className="px-2 py-3 text-[11px] text-white/35">{t("frame.noSources")}</p>
                ) : (
                  sources.map((candidate) => (
                    <button
                      key={candidate.nodeId}
                      type="button"
                      onClick={() => {
                        actions.onAttach(shotId, candidate.nodeId);
                        setPicking(false);
                      }}
                      className="flex items-center gap-2 rounded-lg p-1 text-left transition-colors hover:bg-white/[0.07]"
                    >
                      <span className="aspect-video w-14 shrink-0 overflow-hidden rounded-md bg-white/[0.06]">
                        {candidate.kind === "video" ? (
                          <video
                            src={candidate.url}
                            muted
                            playsInline
                            preload="none"
                            className="size-full object-cover"
                          />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={candidate.url}
                            alt=""
                            loading="lazy"
                            className="size-full object-cover"
                          />
                        )}
                      </span>
                      <span className="truncate text-[11px] text-white/70">{candidate.label}</span>
                    </button>
                  ))
                )}
              </div>
            ) : null}
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT[kind]}
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                void onPick(file);
              }}
            />
          </div>
        )
      ) : null}

      {viewerOpen && picture?.url ? (
        <CanvasMediaViewer
          type={kind}
          src={picture.url}
          alt=""
          onClose={() => setViewerOpen(false)}
        />
      ) : null}
    </section>
  );
}

function SlotAction({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          className="flex size-6 items-center justify-center rounded-md bg-white/[0.06] text-white/55 transition-colors hover:bg-white/[0.12] hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function SlotButton({
  label,
  icon,
  pressed,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  pressed?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none",
        pressed
          ? "bg-white/[0.14] text-white"
          : "bg-white/[0.06] text-white/70 hover:bg-white/[0.12] hover:text-white"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
