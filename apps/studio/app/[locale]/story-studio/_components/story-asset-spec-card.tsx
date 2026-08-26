"use client";

import { useState } from "react";
import { IconCheck } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { type StoryAssetSpec } from "@/lib/story-production-api";
import { cn } from "@/lib/utils";
import { StoryAssetSpecDetailDialog } from "./story-asset-spec-detail-dialog";
import { StoryProductionConflictPanel } from "./story-production-conflict-panel";
import { StoryProductionGenerationControl } from "./story-production-generation-control";

const MEDIA_ASPECT = {
  character: "portrait",
  location: "landscape",
  prop: "square",
} as const;

/**
 * Minimal media-first Asset Spec card: one media slot (character portraits
 * 3:4, location stills 16:9, props square) with the generate action and the
 * detail entry stacked on it, then just the name and a one-line description.
 * The detail dialog carries everything else — full description, editable
 * prompt, model choice.
 */
export function StoryAssetSpecCard({
  asset,
  projectId,
  chapterId,
  allowGeneration = true,
  selected = false,
  onSelectedChange,
}: {
  asset: StoryAssetSpec;
  projectId: string;
  chapterId: string;
  allowGeneration?: boolean;
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
}) {
  const t = useTranslations("storyStudio.assetsPage");
  const [detailOpen, setDetailOpen] = useState(false);

  return (
    <article
      className={cn(
        "relative rounded-2xl bg-white/[0.045] p-3 text-white shadow-sm",
        selected && "ring-1 ring-white/65"
      )}
    >
      {onSelectedChange ? (
        <button
          type="button"
          aria-label={t(selected ? "batch.deselectAsset" : "batch.selectAsset", {
            name: asset.name,
          })}
          aria-pressed={selected}
          onClick={() => onSelectedChange(!selected)}
          className={cn(
            "absolute top-5 left-5 z-20 inline-flex size-6 items-center justify-center rounded-lg border text-white transition focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none",
            selected
              ? "border-white/70 bg-white text-black"
              : "border-white/25 bg-black/50 hover:border-white/55 hover:bg-black/70"
          )}
        >
          {selected ? <IconCheck className="size-3.5" stroke={2.5} /> : null}
        </button>
      ) : null}
      <StoryProductionGenerationControl
        scope={{ projectId, chapterId }}
        target={{
          kind: "asset_spec",
          id: asset.id,
          sequenceId: null,
          version: asset.version,
          status: asset.status,
          latestGeneration: asset.latestGeneration,
        }}
        label={asset.name}
        selectedMedia={asset.selectedMediaVersion}
        aspect={MEDIA_ASPECT[asset.kind]}
        allowGeneration={allowGeneration}
        secondaryAction={
          <button
            type="button"
            onClick={() => setDetailOpen(true)}
            className="rounded-md bg-black/45 px-2 py-1 text-[11px] font-medium text-white/72 backdrop-blur-sm transition hover:bg-black/60 hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
          >
            {t("details")}
          </button>
        }
      />
      <div className="mt-3 min-w-0">
        <h2 className="truncate text-sm font-semibold text-white/94">{asset.name}</h2>
        {asset.description ? (
          <p className="mt-1 truncate text-xs leading-5 text-white/70">{asset.description}</p>
        ) : null}
      </div>
      <StoryProductionConflictPanel
        scope={{ projectId, chapterId }}
        target={{ kind: "asset_spec", item: asset }}
      />
      <StoryAssetSpecDetailDialog
        asset={asset}
        projectId={projectId}
        chapterId={chapterId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        editable={allowGeneration}
      />
    </article>
  );
}
