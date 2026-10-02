"use client";

import { useTranslations } from "next-intl";
import { StudioComposer } from "../../_components/generation/studio-composer";
import { useAudioGeneration } from "../../_components/generation/use-image-generation";
import {
  FailedTile,
  FeedEmptyState,
  FeedLoadingState,
  PendingTile,
} from "../../_components/generation/feed-tiles";

export function AudioStudio() {
  const t = useTranslations("studioModes");
  const tc = useTranslations("common");
  const tg = useTranslations("generation");
  const gen = useAudioGeneration();
  const { feed, model } = gen;
  return (
    <>
      <section className="mt-6 space-y-4">
        <p className="text-xs text-muted-foreground">{t("audio.feedSubheading")}</p>
        {feed.historyError ? (
          <div role="alert" className="text-sm text-destructive">
            <p>{feed.historyError}</p>
            <button
              type="button"
              onClick={() => void feed.refreshHistory()}
              className="mt-2 underline"
            >
              {tc("retry")}
            </button>
          </div>
        ) : null}
        {feed.historyLoading && !feed.jobs.length ? (
          <FeedLoadingState />
        ) : !feed.historyError && !feed.jobs.length ? (
          <FeedEmptyState
            message={t("audio.emptyTitle")}
            hint={t("audio.emptyHint")}
            modelName={model?.name}
          />
        ) : null}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {feed.jobs.map((job) => {
            const outputs = job.outputs.filter(
              (output) => output.type === "audio" && (output.url || output.accessUrl)
            );
            if (job.status === "done" && outputs.length)
              return (
                <article key={job.localId} className="min-w-0 rounded-xl bg-card p-4">
                  <h2 className="mb-3 line-clamp-3 text-sm font-medium">{job.prompt}</h2>
                  {outputs.map((output, index) => (
                    <div key={output.id} className="space-y-2 py-2">
                      <audio
                        controls
                        preload="none"
                        src={output.url || output.accessUrl}
                        aria-label={`${job.prompt} · ${index + 1}`}
                        className="w-full"
                      />
                      <a
                        href={output.url || output.accessUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        download
                        className="text-xs text-muted-foreground underline"
                      >
                        {tg("download")}
                      </a>
                    </div>
                  ))}
                </article>
              );
            if (["failed", "cancelled"].includes(job.status))
              return (
                <FailedTile
                  key={job.localId}
                  job={job}
                  ratio="2 / 1"
                  onRetry={() => void feed.retry(job)}
                />
              );
            if (job.status === "done")
              return (
                <div key={job.localId} role="alert" className="rounded-xl bg-card p-4 text-sm">
                  <p>{job.prompt}</p>
                  <p className="mt-2 text-destructive">{t("audio.noOutput")}</p>
                </div>
              );
            return <PendingTile key={job.localId} job={job} ratio="2 / 1" />;
          })}
        </div>
      </section>
      <StudioComposer
        modality="audio"
        catalog={gen.catalog}
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
        error={gen.submitError}
        validationIssues={gen.validationIssues}
        onDismissValidation={gen.clearValidation}
        onSubmit={() => void gen.submit()}
      />
    </>
  );
}
