"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { StudioComposer } from "@/app/[locale]/(studio)/_components/generation/studio-composer";
import { useVideoGeneration } from "@/app/[locale]/(studio)/_components/generation/use-video-generation";
import type { FeedJob } from "@/app/[locale]/(studio)/_components/generation/use-generation-feed";
import {
  FailedTile,
  FeedEmptyState,
  FeedHistoryError,
  FeedLoadingState,
  PendingTile,
  VideoGrid,
  VideoResultTile,
} from "@/app/[locale]/(studio)/_components/generation/feed-tiles";
import {
  ResultLightbox,
  type LightboxItem,
} from "@/app/[locale]/(studio)/_components/generation/result-lightbox";

/**
 * Video studio: mode-driven composer (text / image / first-last-frame / omni)
 * over a uniform 16:9 history grid with hover-playing results. Generation state
 * lives in `useVideoGeneration` (shared with the home composer).
 */
export function VideoStudio() {
  const t = useTranslations("studioModes");
  const gen = useVideoGeneration();
  const { catalog, feed, model } = gen;
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Pre-fill the prompt handed off from the home composer (`?prompt=`), once,
  // then strip the param so a later refresh doesn't clobber the user's edits.
  const searchParams = useSearchParams();
  const setPrompt = gen.setPrompt;
  useEffect(() => {
    const handed = searchParams.get("prompt");
    if (handed && handed.trim()) {
      setPrompt(handed);
      window.history.replaceState(null, "", window.location.pathname);
    }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lightboxItems = useMemo<LightboxItem[]>(
    () =>
      feed.jobs.flatMap((job) =>
        job.status === "done"
          ? job.outputs
              .filter((output) => output.type === "video")
              .map((output, index) => ({ key: `${job.localId}:${index}`, job, output }))
          : []
      ),
    [feed.jobs]
  );
  const openLightbox = (key: string) =>
    setLightboxIndex(
      Math.max(
        0,
        lightboxItems.findIndex((item) => item.key === key)
      )
    );

  const modelName = (modelId: string) =>
    catalog?.models.find((m) => m.id === modelId)?.name ?? modelId;

  const isFailed = (job: FeedJob) =>
    job.status === "failed" ||
    job.status === "cancelled" ||
    (job.status === "done" && job.outputs.length === 0);

  return (
    <>
      <section className="mt-6 pb-56">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-white/80">{t("feed.heading")}</h2>
          <p className="text-xs text-muted-foreground">
            {feed.hasActiveJobs ? t("feed.live") : t("video.feedSubheading")}
          </p>
        </div>

        <div className="mt-4">
          {feed.historyError ? (
            <FeedHistoryError
              error={feed.historyError}
              onRetry={() => void feed.refreshHistory()}
            />
          ) : null}
          {feed.historyLoading && feed.jobs.length === 0 ? (
            <FeedLoadingState />
          ) : !feed.historyError && feed.jobs.length === 0 ? (
            <FeedEmptyState
              message={t("feed.startCreatingWith")}
              hint={t("video.emptyHint")}
              modelName={model?.name}
            />
          ) : (
            <VideoGrid>
              {feed.jobs.map((job) => {
                if (job.status === "done" && job.outputs.length > 0) {
                  return job.outputs
                    .filter((output) => output.type === "video")
                    .map((output, index) => (
                      <VideoResultTile
                        key={`${job.localId}:${index}`}
                        job={job}
                        output={output}
                        onOpen={() => openLightbox(`${job.localId}:${index}`)}
                      />
                    ));
                }
                if (isFailed(job)) {
                  return (
                    <FailedTile
                      key={job.localId}
                      job={job}
                      ratio="16 / 9"
                      onRetry={() =>
                        void feed.retry(
                          job,
                          model ? { schemaVersion: model.schemaVersion } : undefined
                        )
                      }
                    />
                  );
                }
                return <PendingTile key={job.localId} job={job} ratio="16 / 9" />;
              })}
            </VideoGrid>
          )}
        </div>
      </section>

      <StudioComposer
        modality="video"
        catalog={catalog}
        prompt={gen.prompt}
        onPromptChange={gen.setPrompt}
        model={model}
        onSelectModel={gen.onSelectModel}
        settings={gen.settings}
        onSettingsChange={gen.setSettings}
        mode={gen.mode}
        modes={gen.modes}
        onSelectMode={gen.setMode}
        referenceFields={gen.referenceFields}
        referenceItems={gen.activeUploads}
        onAddReferences={(field, files) => gen.uploads.addFiles(field.field, field.kind, files)}
        onRemoveReference={gen.uploads.remove}
        cost={gen.cost}
        canSubmit={gen.canSubmit}
        submitting={gen.submitting}
        error={gen.error}
        validationIssues={gen.validationIssues}
        onDismissValidation={gen.clearValidation}
        onSubmit={() => void gen.submit()}
      />

      {lightboxIndex != null && lightboxItems[lightboxIndex] && (
        <ResultLightbox
          items={lightboxItems}
          index={lightboxIndex}
          modelName={modelName}
          onNavigate={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  );
}
