"use client";

import { useState } from "react";
import Image from "next/image";
import {
  IconBox,
  IconGitBranch,
  IconLoader2,
  IconMapPin,
  IconMovie,
  IconPhoto,
  IconSparkles,
  IconUser,
  IconVideo,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import {
  isStoryAssetProposal,
  isStoryScreenplayProposal,
  isStoryStoryboardProposal,
  storyScreenplayDocument,
  type StoryAssetProposal,
  type StoryStoryboardProposal,
} from "@repo/shared/story-agent";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { StoryAssetSpec as CurrentStoryAssetSpec } from "@/lib/story-production-api";
import {
  storyAuthoringProposalReview,
  storyAuthoringProposalStage,
  storyLocalizedText,
  type StoryAuthoringProposalReview,
  type StoryReviewableProposal,
} from "./story-authoring-proposal";
import { StoryScreenplayDocumentView } from "./story-screenplay-document-view";
import { StorySourceReviewNotes } from "./story-source-review-notes";

export function StoryAuthoringProposalDialog({
  open,
  proposal,
  applying,
  discarding,
  resolutionError,
  onOpenChange,
  onApply,
  onDiscard,
}: {
  open: boolean;
  proposal: StoryReviewableProposal;
  applying: boolean;
  discarding: boolean;
  resolutionError?: string | null;
  onOpenChange: (open: boolean) => void;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const t = useTranslations("storyStudio.authoringRun");
  const stage = storyAuthoringProposalStage(proposal);
  const busy = applying || discarding;
  const screenplayDocument = isStoryScreenplayProposal(proposal)
    ? storyScreenplayDocument(proposal)
    : null;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !busy && onOpenChange(nextOpen)}>
      <DialogContent
        showCloseButton={!busy}
        className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-[22px] bg-[oklch(0.18_0_0/0.99)] p-0 text-white shadow-[0_32px_110px_rgba(0,0,0,0.78)] sm:max-h-[calc(100dvh-3rem)] sm:w-[min(760px,calc(100vw-3rem))] sm:max-w-[760px]"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader className="border-b border-white/[0.07] px-5 pt-5 pr-14 pb-4 sm:px-7 sm:pt-7 sm:pr-16">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-[0.1em] text-white/62 uppercase">
            <IconSparkles className="size-3.5" stroke={1.8} />
            {t(`proposalStage.${stage}.eyebrow`)}
          </div>
          <DialogTitle
            className={
              screenplayDocument
                ? "sr-only"
                : "text-xl leading-tight font-semibold tracking-[-0.02em] text-white"
            }
          >
            {proposal.title}
          </DialogTitle>
          <DialogDescription className="max-w-[66ch] text-xs leading-5 text-white/68">
            {applying
              ? t(`proposalStage.${stage}.savingHint`)
              : t(`proposalStage.${stage}.description`)}
          </DialogDescription>
          {resolutionError ? (
            <p role="alert" className="mt-2 text-xs leading-5 text-red-200/88">
              {resolutionError}
            </p>
          ) : null}
        </DialogHeader>

        <ScrollArea
          className="min-h-0"
          viewportProps={{ tabIndex: 0, "aria-label": t("proposal.reviewRegion") }}
        >
          <StoryAuthoringProposalContent proposal={proposal} />
        </ScrollArea>

        <DialogFooter className="shrink-0 border-t border-white/[0.07] bg-black/15 px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-between sm:px-7">
          <Button
            type="button"
            variant="quiet"
            size="lg"
            disabled={busy}
            className="text-white/68 hover:text-white/90"
            onClick={onDiscard}
          >
            {discarding ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {t("discard")}
          </Button>
          <Button type="button" size="lg" disabled={busy} className="sm:min-w-44" onClick={onApply}>
            {applying ? <IconLoader2 className="size-4 animate-spin" /> : null}
            {applying ? t(`proposalStage.${stage}.saving`) : t(`proposalStage.${stage}.approve`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Exact proposal payload rendered either in the review dialog or inline in
 * the Assistant transcript. Keeping one renderer prevents the compact chat
 * view from drifting away from what will actually be persisted. */
export function StoryAuthoringProposalContent({
  proposal,
  embedded = false,
  currentAssets = [],
  mobileAutoGenerate = false,
}: {
  proposal: StoryReviewableProposal;
  embedded?: boolean;
  currentAssets?: readonly CurrentStoryAssetSpec[];
  mobileAutoGenerate?: boolean;
}) {
  const screenplayDocument = isStoryScreenplayProposal(proposal)
    ? storyScreenplayDocument(proposal)
    : null;

  if (screenplayDocument) {
    return (
      <>
        <div className="px-5">
          <StorySourceReviewNotes
            notes={isStoryScreenplayProposal(proposal) ? proposal.screenplay.reviewNotes : []}
          />
        </div>
        <StoryScreenplayDocumentView document={screenplayDocument} embedded={embedded} />
      </>
    );
  }
  if (isStoryAssetProposal(proposal)) {
    return (
      <AssetProposalReview
        proposal={proposal}
        embedded={embedded}
        currentAssets={currentAssets}
        mobileAutoGenerate={mobileAutoGenerate}
      />
    );
  }
  if (isStoryStoryboardProposal(proposal)) {
    return <StoryboardProposalReview proposal={proposal} embedded={embedded} />;
  }
  return <StructureProposalReview proposal={proposal} embedded={embedded} />;
}

function StructureProposalReview({
  proposal,
  embedded = false,
}: {
  proposal: StoryReviewableProposal;
  embedded?: boolean;
}) {
  const t = useTranslations("storyStudio.authoringRun");
  const review = storyAuthoringProposalReview(proposal);
  const sceneNames = new Map(
    review.scenes.map((scene) => [scene.nodeId, scene.name?.trim() || scene.nodeId])
  );

  return (
    <div className={embedded ? "space-y-5 py-1" : "space-y-7 px-5 py-5 sm:px-7 sm:py-6"}>
      <StoryMetrics review={review} />

      <ReviewSection title={t("proposal.sections.summary")}>
        <p className="whitespace-pre-wrap text-sm leading-6 text-white/88">{proposal.summary}</p>
        {review.logline && review.logline !== proposal.summary ? (
          <p className="mt-3 border-l-2 border-white/18 pl-3 text-xs leading-5 text-white/62">
            {review.logline}
          </p>
        ) : null}
        {review.synopsis ? (
          <p className="mt-3 whitespace-pre-wrap text-xs leading-6 text-white/68">
            {review.synopsis}
          </p>
        ) : null}
      </ReviewSection>

      {review.characters.length > 0 ? (
        <ReviewSection title={t("proposal.sections.characters")}>
          <div className="grid gap-2 sm:grid-cols-2">
            {review.characters.map((character) => (
              <div key={character.id} className="rounded-xl bg-white/[0.045] px-3.5 py-3">
                <p className="text-xs font-semibold text-white/90">
                  {storyLocalizedText(character.name)}
                </p>
                {character.summary ? (
                  <p className="mt-1 text-xs leading-5 text-white/68">{character.summary}</p>
                ) : null}
              </div>
            ))}
          </div>
        </ReviewSection>
      ) : null}

      <ReviewSection title={t("proposal.sections.structure")}>
        {review.scenes.length > 0 ? (
          <div className="space-y-2">
            {review.scenes.map((scene, index) => (
              <article key={scene.nodeId} className="rounded-2xl bg-white/[0.04] p-4">
                <div className="flex items-start gap-3">
                  <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white/[0.07] text-[11px] font-semibold text-white/68">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <h4 className="text-xs font-semibold text-white/92">
                        {scene.name?.trim() || t("proposal.untitledScene")}
                      </h4>
                      <span className="truncate font-mono text-[11px] text-white/58">
                        {scene.nodeId}
                      </span>
                    </div>
                    {scene.description ? (
                      <p className="mt-1.5 whitespace-pre-wrap text-xs leading-5 text-white/72">
                        {scene.description}
                      </p>
                    ) : null}

                    {scene.exit.kind === "choice" ? (
                      <div className="mt-3 rounded-xl bg-black/20 p-3">
                        <p className="flex items-center gap-1.5 text-[11px] font-medium text-white/72">
                          <IconGitBranch className="size-3.5" stroke={1.8} />
                          {storyLocalizedText(scene.exit.prompt)}
                        </p>
                        <ul className="mt-2 space-y-1.5">
                          {scene.exit.choices.map((choice) => (
                            <li
                              key={choice.choiceId}
                              className="flex items-start gap-2 text-xs leading-5 text-white/68"
                            >
                              <span className="mt-1.5 size-1 shrink-0 rounded-full bg-white/35" />
                              <span className="min-w-0">
                                <span className="text-white/72">
                                  {storyLocalizedText(choice.label)}
                                </span>
                                <span className="px-1.5 text-white/50">→</span>
                                {choice.nextNodeId
                                  ? (sceneNames.get(choice.nextNodeId) ?? choice.nextNodeId)
                                  : t("proposal.unresolved")}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p className="mt-3 flex items-center gap-1.5 text-xs text-white/62">
                        <IconMovie className="size-3.5" stroke={1.8} />
                        {scene.exit.nextNodeId
                          ? t("proposal.continuesTo", {
                              scene: sceneNames.get(scene.exit.nextNodeId) ?? scene.exit.nextNodeId,
                            })
                          : t("proposal.ending")}
                      </p>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="text-xs text-white/62">{t("proposal.noScenes")}</p>
        )}
      </ReviewSection>

      {review.productionNotes.length > 0 ? (
        <ReviewSection title={t("proposal.sections.productionNotes")}>
          <ul className="space-y-2">
            {review.productionNotes.map((note, index) => (
              <li key={`${index}:${note}`} className="flex gap-2 text-xs leading-5 text-white/62">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-white/35" />
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </ReviewSection>
      ) : null}
    </div>
  );
}

function AssetProposalReview({
  proposal,
  embedded = false,
  currentAssets = [],
  mobileAutoGenerate = false,
}: {
  proposal: StoryAssetProposal;
  embedded?: boolean;
  currentAssets?: readonly CurrentStoryAssetSpec[];
  mobileAutoGenerate?: boolean;
}) {
  const t = useTranslations("storyStudio.authoringRun");
  const assets = proposal.assetPlan.assetSpecs;
  if (embedded) {
    return (
      <EmbeddedAssetProposalReview
        proposal={proposal}
        currentAssets={currentAssets}
        mobileAutoGenerate={mobileAutoGenerate}
      />
    );
  }

  return (
    <div data-testid="asset-proposal-review" className="space-y-7 px-5 py-5 sm:px-7 sm:py-6">
      <AssetProposalMetrics assets={assets} />
      <ReviewSection title={t("proposal.sections.summary")}>
        <p className="whitespace-pre-wrap text-sm leading-6 text-white/88">{proposal.summary}</p>
      </ReviewSection>
      <ReviewSection title={t("proposal.sections.assetSpecs")}>
        {assets.length > 0 ? (
          <div className="space-y-2">
            {assets.map((asset) => {
              const AssetIcon =
                asset.kind === "character"
                  ? IconUser
                  : asset.kind === "location"
                    ? IconMapPin
                    : IconBox;
              return (
                <article key={asset.stableKey} className="rounded-2xl bg-white/[0.04] p-4">
                  <div className="flex items-start gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/[0.07] text-white/62">
                      <AssetIcon aria-hidden="true" className="size-4" stroke={1.7} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-xs font-semibold text-white/92">{asset.name}</h4>
                        <span className="text-xs text-white/62">
                          {t(`proposal.assetKinds.${asset.kind}`)}
                        </span>
                        <code className="text-[11px] text-white/60">@{asset.stableKey}</code>
                      </div>
                      <p className="mt-1.5 text-xs leading-5 text-white/76">{asset.description}</p>
                      <AssetProposalDetails asset={asset} />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-white/62">{t("proposal.noAssetSpecs")}</p>
        )}
      </ReviewSection>
    </div>
  );
}

type StoryAssetSpec = StoryAssetProposal["assetPlan"]["assetSpecs"][number];
type StoryAssetKind = StoryAssetSpec["kind"];

const STORY_ASSET_KINDS: readonly StoryAssetKind[] = ["character", "location", "prop"];

function EmbeddedAssetProposalReview({
  proposal,
  currentAssets,
  mobileAutoGenerate,
}: {
  proposal: StoryAssetProposal;
  currentAssets: readonly CurrentStoryAssetSpec[];
  mobileAutoGenerate: boolean;
}) {
  const t = useTranslations("storyStudio.authoringRun");
  const assets = proposal.assetPlan.assetSpecs;
  const currentAssetsByStableKey = new Map(
    currentAssets.map((asset) => [asset.stableKey, asset] as const)
  );
  const [dialogKind, setDialogKind] = useState<StoryAssetKind | null>(null);
  const dialogAssets = dialogKind ? assets.filter((asset) => asset.kind === dialogKind) : [];

  if (mobileAutoGenerate) {
    return (
      <div
        data-testid="asset-proposal-review"
        data-mobile-asset-summary="true"
        className="space-y-3 py-1"
      >
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <AssetMetricChip value={assets.length} label={t("proposal.metrics.assetSpecs")} />
          <AssetMetricChip
            value={assets.filter((asset) => asset.kind === "character").length}
            label={t("proposal.metrics.characters")}
          />
          <AssetMetricChip
            value={assets.filter((asset) => asset.kind === "location").length}
            label={t("proposal.metrics.locations")}
          />
          <AssetMetricChip
            value={assets.filter((asset) => asset.kind === "prop").length}
            label={t("proposal.metrics.props")}
          />
        </div>
        <p className="text-xs leading-5 text-white/72">
          {t("proposalStage.assets.mobileDescription", { count: assets.length })}
        </p>
      </div>
    );
  }

  return (
    <>
      <div data-testid="asset-proposal-review" className="space-y-4 py-1">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <AssetMetricChip value={assets.length} label={t("proposal.metrics.assetSpecs")} />
          <AssetMetricChip
            value={assets.filter((asset) => asset.kind === "character").length}
            label={t("proposal.metrics.characters")}
          />
          <AssetMetricChip
            value={assets.filter((asset) => asset.kind === "location").length}
            label={t("proposal.metrics.locations")}
          />
          <AssetMetricChip
            value={assets.filter((asset) => asset.kind === "prop").length}
            label={t("proposal.metrics.props")}
          />
        </div>

        <p className="line-clamp-3 text-xs leading-5 text-white/72">{proposal.summary}</p>

        <div className="space-y-4">
          {STORY_ASSET_KINDS.map((kind) => {
            const kindAssets = assets.filter((asset) => asset.kind === kind);
            return kindAssets.length > 0 ? (
              <EmbeddedAssetGroup
                key={kind}
                kind={kind}
                assets={kindAssets}
                currentAssetsByStableKey={currentAssetsByStableKey}
                onShowMore={() => setDialogKind(kind)}
              />
            ) : null;
          })}
        </div>
      </div>

      <AssetKindDialog
        kind={dialogKind}
        assets={dialogAssets}
        currentAssetsByStableKey={currentAssetsByStableKey}
        open={dialogKind !== null}
        onOpenChange={(open) => !open && setDialogKind(null)}
      />
    </>
  );
}

function EmbeddedAssetGroup({
  kind,
  assets,
  currentAssetsByStableKey,
  onShowMore,
}: {
  kind: StoryAssetKind;
  assets: StoryAssetSpec[];
  currentAssetsByStableKey: ReadonlyMap<string, CurrentStoryAssetSpec>;
  onShowMore: () => void;
}) {
  const t = useTranslations("storyStudio.authoringRun");
  const hasOverflow = assets.length > 3;
  const visibleAssets = hasOverflow ? assets.slice(0, 2) : assets;
  const hiddenCount = assets.length - visibleAssets.length;

  return (
    <section>
      <div className="mb-2 flex min-h-6 items-center gap-3">
        <h3 className="text-xs font-semibold text-white/76">
          {t(`proposal.assetKinds.${kind}`)}
          <span className="ml-1.5 font-normal text-white/45">{assets.length}</span>
        </h3>
      </div>

      <div data-asset-row={kind} className="grid grid-cols-3 gap-2">
        {visibleAssets.map((asset) => (
          <EmbeddedAssetCard
            key={asset.stableKey}
            asset={asset}
            currentAsset={currentAssetsByStableKey.get(asset.stableKey)}
          />
        ))}
        {hiddenCount > 0 ? (
          <button
            type="button"
            aria-label={t("proposal.showMoreAssets", { count: hiddenCount })}
            title={t("proposal.viewMoreAssets")}
            className="group relative aspect-[3/4] min-w-0 overflow-hidden rounded-xl bg-white/[0.045] text-white/76 ring-1 ring-inset ring-white/[0.08] transition-colors hover:bg-white/[0.075] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60"
            onClick={onShowMore}
          >
            <span className="text-lg font-semibold transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0">
              +{hiddenCount}
            </span>
            <span className="absolute inset-0 grid place-items-center px-2 text-center text-[11px] leading-4 font-medium opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              {t("proposal.viewMoreAssets")}
            </span>
          </button>
        ) : null}
      </div>
    </section>
  );
}

function EmbeddedAssetCard({
  asset,
  currentAsset,
}: {
  asset: StoryAssetSpec;
  currentAsset?: CurrentStoryAssetSpec;
}) {
  const t = useTranslations("storyStudio.authoringRun");
  const AssetIcon =
    asset.kind === "character" ? IconUser : asset.kind === "location" ? IconMapPin : IconBox;
  const mediaUrl =
    currentAsset?.selectedMediaVersion?.thumbnailUrl ??
    currentAsset?.selectedMediaVersion?.previewUrl ??
    null;
  return (
    <article
      title={asset.description}
      className="relative flex aspect-[3/4] min-w-0 flex-col overflow-hidden rounded-xl bg-white/[0.045] p-2.5 ring-1 ring-inset ring-white/[0.07]"
    >
      {mediaUrl ? (
        <>
          <Image
            src={mediaUrl}
            alt={asset.name}
            fill
            unoptimized
            sizes="(max-width: 640px) 33vw, 180px"
            className="object-cover"
          />
          <span
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/15 to-transparent"
          />
        </>
      ) : null}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        {!mediaUrl ? (
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white/[0.07] text-white/58">
            <AssetIcon aria-hidden="true" className="size-3.5" stroke={1.7} />
          </span>
        ) : null}
        <h4
          className={`${mediaUrl ? "mt-auto" : "mt-2"} line-clamp-2 text-xs leading-4 font-semibold text-white/90`}
        >
          {asset.name}
        </h4>
        <code
          className={`mt-1 truncate text-[9px] ${mediaUrl ? "text-white/68" : "text-white/42"}`}
        >
          @{asset.stableKey}
        </code>
        <p
          className={`${mediaUrl ? "mt-1 line-clamp-1 text-white/72" : "mt-auto line-clamp-2 text-white/58"} text-[10px] leading-4`}
        >
          {t(`proposal.assetKinds.${asset.kind}`)} · {asset.description}
        </p>
      </div>
    </article>
  );
}

function AssetKindDialog({
  kind,
  assets,
  currentAssetsByStableKey,
  open,
  onOpenChange,
}: {
  kind: StoryAssetKind | null;
  assets: StoryAssetSpec[];
  currentAssetsByStableKey: ReadonlyMap<string, CurrentStoryAssetSpec>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("storyStudio.authoringRun");
  if (!kind) return null;

  const kindLabel = t(`proposal.assetKinds.${kind}`);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="asset-kind-dialog"
        className="grid max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-xl grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-[22px] bg-[oklch(0.18_0_0/0.99)] p-0 text-white shadow-[0_32px_110px_rgba(0,0,0,0.78)]"
      >
        <DialogHeader className="border-b border-white/[0.07] px-5 py-5 pr-14 sm:px-6 sm:pr-16">
          <DialogTitle className="text-base font-semibold text-white">
            {t("proposal.assetKindDialogTitle", { kind: kindLabel, count: assets.length })}
          </DialogTitle>
          <DialogDescription className="text-xs leading-5 text-white/62">
            {t("proposal.assetKindDialogDescription", { kind: kindLabel })}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="min-h-0">
          <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-3 sm:p-6">
            {assets.map((asset) => (
              <EmbeddedAssetCard
                key={asset.stableKey}
                asset={asset}
                currentAsset={currentAssetsByStableKey.get(asset.stableKey)}
              />
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function AssetMetricChip({ value, label }: { value: number; label: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/[0.055] px-2 py-1 text-[10px] text-white/58">
      <strong className="font-semibold text-white/82">{value}</strong>
      {label}
    </span>
  );
}

function AssetProposalMetrics({ assets }: { assets: StoryAssetSpec[] }) {
  const t = useTranslations("storyStudio.authoringRun");
  const count = (kind: StoryAssetKind) => assets.filter((asset) => asset.kind === kind).length;
  return (
    <div className="grid grid-cols-2 border-y border-white/[0.07] sm:grid-cols-4">
      <AssetMetric
        value={assets.length}
        label={t("proposal.metrics.assetSpecs")}
        className="border-b border-white/[0.07] sm:border-b-0"
      />
      <AssetMetric
        value={count("character")}
        label={t("proposal.metrics.characters")}
        className="border-b border-l border-white/[0.07] sm:border-b-0"
      />
      <AssetMetric
        value={count("location")}
        label={t("proposal.metrics.locations")}
        className="sm:border-l sm:border-white/[0.07]"
      />
      <AssetMetric
        value={count("prop")}
        label={t("proposal.metrics.props")}
        className="border-l border-white/[0.07]"
      />
    </div>
  );
}

function AssetProposalDetails({
  asset,
}: {
  asset: StoryAssetProposal["assetPlan"]["assetSpecs"][number];
}) {
  const t = useTranslations("storyStudio.authoringRun");
  return (
    <div>
      <ProposalTextField label={t("proposal.imagePrompt")} value={asset.imagePrompt} />
      {asset.videoPrompt ? (
        <ProposalTextField label={t("proposal.videoPrompt")} value={asset.videoPrompt} />
      ) : null}
      {asset.negativePrompt ? (
        <ProposalTextField label={t("proposal.negativePrompt")} value={asset.negativePrompt} />
      ) : null}
      {asset.sourceCharacterId ? (
        <div className="mt-3">
          <p className="text-xs font-medium text-white/62">{t("proposal.sourceCharacter")}</p>
          <code className="mt-1 block break-all text-[11px] leading-5 text-white/72">
            @{asset.sourceCharacterId}
          </code>
        </div>
      ) : null}
      <div className="mt-3">
        <p className="text-xs font-medium text-white/62">
          {t("proposal.sourceNodes", { count: asset.sourceNodeIds.length })}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {asset.sourceNodeIds.map((nodeId) => (
            <code
              key={nodeId}
              className="rounded-md bg-white/[0.06] px-2 py-1 text-[11px] text-white/72"
            >
              @{nodeId}
            </code>
          ))}
        </div>
      </div>
    </div>
  );
}

function StoryboardProposalReview({
  proposal,
  embedded = false,
}: {
  proposal: StoryStoryboardProposal;
  embedded?: boolean;
}) {
  if (embedded) {
    return <EmbeddedStoryboardProposalReview proposal={proposal} />;
  }

  return <StoryboardProposalDetails proposal={proposal} />;
}

const EMBEDDED_STORYBOARD_SEQUENCE_LIMIT = 4;

function EmbeddedStoryboardProposalReview({ proposal }: { proposal: StoryStoryboardProposal }) {
  const t = useTranslations("storyStudio.authoringRun");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const sequences = proposal.storyboardPlan.storyboardSequences;
  const clips = sequences.flatMap((sequence) => sequence.clips);
  const seconds = Math.round(
    sequences.reduce((total, sequence) => total + sequence.durationMs, 0) / 1000
  );
  const visibleSequences = sequences.slice(0, EMBEDDED_STORYBOARD_SEQUENCE_LIMIT);
  const hiddenSequenceCount = Math.max(0, sequences.length - visibleSequences.length);

  return (
    <>
      <div data-testid="storyboard-proposal-summary" className="space-y-4 py-1">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <AssetMetricChip value={sequences.length} label={t("proposal.metrics.sequences")} />
          <AssetMetricChip value={clips.length} label={t("proposal.metrics.clips")} />
          <AssetMetricChip value={seconds} label={t("proposal.metrics.seconds")} />
          <AssetMetricChip
            value={proposal.assetPlan.assetSpecs.length}
            label={t("proposal.metrics.assetSpecs")}
          />
        </div>

        <p className="line-clamp-3 text-xs leading-5 text-white/72">{proposal.summary}</p>

        <section>
          <h3 className="mb-2 text-xs font-semibold text-white/76">
            {t("proposal.sections.storyboard")}
          </h3>
          <div className="overflow-hidden rounded-xl bg-white/[0.04]">
            <table
              data-testid="storyboard-sequence-summary-table"
              className="w-full table-fixed text-left text-[11px]"
            >
              <colgroup>
                <col className="w-7" />
                <col />
                <col className="w-12" />
                <col className="w-14" />
              </colgroup>
              <thead className="bg-white/[0.035] text-white/48">
                <tr>
                  <th scope="col" className="px-2 py-2 font-medium">
                    #
                  </th>
                  <th scope="col" className="px-1 py-2 font-medium">
                    {t("proposal.storyboardTable.sequence")}
                  </th>
                  <th scope="col" className="px-1 py-2 text-right font-medium">
                    {t("proposal.storyboardTable.shots")}
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    {t("proposal.storyboardTable.duration")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {visibleSequences.map((sequence, index) => (
                  <tr key={sequence.plotNodeId}>
                    <td className="px-2 py-2.5 tabular-nums text-white/42">{index + 1}</td>
                    <td className="min-w-0 px-1 py-2.5">
                      <p className="truncate font-medium text-white/84" title={sequence.title}>
                        {sequence.title}
                      </p>
                    </td>
                    <td className="px-1 py-2.5 text-right tabular-nums text-white/62">
                      {sequence.clips.length}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-white/62">
                      {t("proposal.storyboardTable.seconds", {
                        value: Number((sequence.durationMs / 1000).toFixed(1)),
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button
            type="button"
            variant="quiet"
            size="sm"
            className="mt-2 h-9 w-full justify-center text-xs text-white/68 hover:text-white"
            onClick={() => setDetailsOpen(true)}
          >
            {t("proposal.storyboardTable.viewAll")}
            {hiddenSequenceCount > 0 ? (
              <span className="text-white/42">
                {t("proposal.storyboardTable.more", { count: hiddenSequenceCount })}
              </span>
            ) : null}
          </Button>
        </section>
      </div>

      <StoryboardDetailsDialog
        proposal={proposal}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      />
    </>
  );
}

function StoryboardDetailsDialog({
  proposal,
  open,
  onOpenChange,
}: {
  proposal: StoryStoryboardProposal;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("storyStudio.authoringRun");
  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="storyboard-details-dialog"
        className="grid max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-5xl grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-[22px] bg-[oklch(0.18_0_0/0.99)] p-0 text-white shadow-[0_32px_110px_rgba(0,0,0,0.78)] sm:w-[calc(100vw-3rem)] sm:max-w-5xl"
      >
        <DialogHeader className="border-b border-white/[0.07] px-5 py-5 pr-14 sm:px-7 sm:pr-16">
          <DialogTitle className="text-base font-semibold text-white">
            {t("proposal.storyboardTable.dialogTitle", {
              count: proposal.storyboardPlan.storyboardSequences.length,
            })}
          </DialogTitle>
          <DialogDescription className="text-xs leading-5 text-white/62">
            {t("proposal.storyboardTable.dialogDescription")}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea
          className="min-h-0"
          viewportProps={{ tabIndex: 0, "aria-label": t("proposal.reviewRegion") }}
        >
          <StoryboardProposalDetails proposal={proposal} />
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function StoryboardProposalDetails({ proposal }: { proposal: StoryStoryboardProposal }) {
  const t = useTranslations("storyStudio.authoringRun");
  const sequences = proposal.storyboardPlan.storyboardSequences;
  const clips = sequences.flatMap((sequence) => sequence.clips);
  const seconds = Math.round(
    sequences.reduce((total, sequence) => total + sequence.durationMs, 0) / 1000
  );

  return (
    <div className="space-y-7 px-5 py-5 sm:px-7 sm:py-6">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric value={sequences.length} label={t("proposal.metrics.sequences")} />
        <Metric value={clips.length} label={t("proposal.metrics.clips")} />
        <Metric value={seconds} label={t("proposal.metrics.seconds")} />
        <Metric
          value={proposal.assetPlan.assetSpecs.length}
          label={t("proposal.metrics.assetSpecs")}
        />
      </div>
      <ReviewSection title={t("proposal.sections.summary")}>
        <p className="whitespace-pre-wrap text-sm leading-6 text-white/88">{proposal.summary}</p>
      </ReviewSection>
      <ReviewSection title={t("proposal.sections.storyboard")}>
        <div className="space-y-5">
          {sequences.map((sequence, index) => (
            <section
              key={sequence.plotNodeId}
              className="overflow-hidden rounded-2xl bg-white/[0.04]"
            >
              <div className="px-4 py-3.5">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-[11px] font-semibold tabular-nums text-white/48">
                    {index + 1}
                  </span>
                  <h4 className="text-xs font-semibold text-white/92">{sequence.title}</h4>
                  <code className="text-[11px] text-white/52">@{sequence.plotNodeId}</code>
                  <span className="ml-auto text-xs tabular-nums text-white/58">
                    {t("proposal.sequenceMeta", {
                      count: sequence.clips.length,
                      seconds: Number((sequence.durationMs / 1000).toFixed(1)),
                    })}
                  </span>
                </div>
                <p className="mt-1.5 text-xs leading-5 text-white/68">{sequence.description}</p>
              </div>

              <div className="overflow-x-auto border-t border-white/[0.07]">
                <table className="w-full min-w-[760px] table-fixed text-left text-xs">
                  <colgroup>
                    <col className="w-10" />
                    <col className="w-[26%]" />
                    <col className="w-20" />
                    <col className="w-40" />
                    <col />
                  </colgroup>
                  <thead className="bg-black/15 text-[11px] text-white/46">
                    <tr>
                      <th scope="col" className="px-3 py-2.5 font-medium">
                        #
                      </th>
                      <th scope="col" className="px-2 py-2.5 font-medium">
                        {t("proposal.storyboardTable.shot")}
                      </th>
                      <th scope="col" className="px-2 py-2.5 font-medium">
                        {t("proposal.storyboardTable.type")}
                      </th>
                      <th scope="col" className="px-2 py-2.5 font-medium">
                        {t("proposal.storyboardTable.timing")}
                      </th>
                      <th scope="col" className="px-2 py-2.5 pr-4 font-medium">
                        {t("proposal.storyboardTable.prompt")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {sequence.clips.map((clip, clipIndex) => {
                      const ClipIcon = clip.kind === "image" ? IconPhoto : IconVideo;
                      const prompt = clip.kind === "image" ? clip.imagePrompt : clip.videoPrompt;
                      return (
                        <tr key={clip.stableKey} className="align-top">
                          <td className="px-3 py-3 tabular-nums text-white/42">{clipIndex + 1}</td>
                          <td className="px-2 py-3">
                            <p className="font-medium text-white/86">{clip.title}</p>
                            <code className="mt-0.5 block break-all text-[10px] leading-4 text-white/42">
                              @{clip.stableKey}
                            </code>
                            <p className="mt-1.5 text-[11px] leading-4 text-white/62">
                              {clip.description}
                            </p>
                          </td>
                          <td className="px-2 py-3 text-white/62">
                            <span className="inline-flex items-center gap-1.5">
                              <ClipIcon className="size-3.5 shrink-0" stroke={1.7} />
                              {t(`proposal.clipKinds.${clip.kind}`)}
                            </span>
                          </td>
                          <td className="px-2 py-3 tabular-nums text-white/62">
                            <span className="block">
                              {t("proposal.storyboardTable.fromTo", {
                                start: clip.startMs,
                                end: clip.startMs + clip.durationMs,
                              })}
                            </span>
                            <span className="mt-1 block text-[10px] text-white/42">
                              {t("proposal.storyboardTable.durationValue", {
                                value: clip.durationMs,
                              })}
                            </span>
                          </td>
                          <td className="px-2 py-3 pr-4">
                            <p className="whitespace-pre-wrap break-words text-[11px] leading-4 text-white/68">
                              {prompt}
                            </p>
                            {clip.negativePrompt ? (
                              <p className="mt-2 whitespace-pre-wrap break-words text-[10px] leading-4 text-white/44">
                                <span className="font-medium text-white/54">
                                  {t("proposal.negativePrompt")}:
                                </span>
                                {clip.negativePrompt}
                              </p>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="border-t border-white/[0.07] px-4 py-3">
                <p className="text-xs font-medium text-white/68">{t("proposal.decisionCues")}</p>
                {sequence.cues.length > 0 ? (
                  <ul className="mt-2 space-y-2">
                    {sequence.cues.map((cue) => (
                      <li
                        key={cue.stableKey}
                        className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/72"
                      >
                        <code className="text-[11px] text-white/60">@{cue.stableKey}</code>
                        <span>{t("proposal.cueAt", { value: cue.atMs })}</span>
                        <span aria-hidden="true" className="text-white/35">
                          ·
                        </span>
                        <span>{t("proposal.decision")}</span>
                        <code className="text-[11px] text-white/72">@{cue.decisionId}</code>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1.5 text-xs text-white/58">{t("proposal.noDecisionCues")}</p>
                )}
              </div>
            </section>
          ))}
        </div>
      </ReviewSection>
    </div>
  );
}

function StoryMetrics({ review }: { review: StoryAuthoringProposalReview }) {
  const t = useTranslations("storyStudio.authoringRun");
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Metric value={review.metrics.scenes} label={t("proposal.metrics.scenes")} />
      <Metric value={review.metrics.branches} label={t("proposal.metrics.branches")} />
      <Metric value={review.metrics.endings} label={t("proposal.metrics.endings")} />
      <Metric value={review.metrics.interactions} label={t("proposal.metrics.interactions")} />
    </div>
  );
}

function Metric({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="rounded-xl bg-white/[0.045] px-3 py-3">
      <p className="text-lg font-semibold tracking-[-0.02em] text-white">{value}</p>
      <p className="mt-0.5 text-xs text-white/62">{label}</p>
    </div>
  );
}

function AssetMetric({
  value,
  label,
  className,
}: {
  value: React.ReactNode;
  label: string;
  className: string;
}) {
  return (
    <div className={`px-3 py-3 ${className}`}>
      <p className="text-lg font-semibold tracking-[-0.02em] text-white">{value}</p>
      <p className="mt-0.5 text-xs text-white/62">{label}</p>
    </div>
  );
}

function ReviewSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2.5 text-xs font-semibold tracking-[0.08em] text-white/62 uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function ProposalTextField({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-3">
      <p className="text-xs font-medium text-white/62">{label}</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-white/74">
        {value}
      </p>
    </div>
  );
}
