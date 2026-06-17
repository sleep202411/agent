"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  buildPromptDocument,
  compactFizzAiInput,
  defaultSettingsForModel,
  estimateModelSellPoints,
  filterFizzAiInput,
  referenceFieldsForMode,
  type FizzAiModel,
  type FizzAiReferenceBinding,
  type ModelSettings,
} from "@/app/[locale]/canvas/_lib/generation-api";
import { useAiCatalog, usableModelsByModality } from "@/app/[locale]/canvas/_lib/use-ai-catalog";
import { StudioComposer } from "@/app/[locale]/(studio)/_components/generation/studio-composer";
import {
  useGenerationFeed,
  type FeedJob,
} from "@/app/[locale]/(studio)/_components/generation/use-generation-feed";
import { useReferenceUploads } from "@/app/[locale]/(studio)/_components/generation/use-reference-uploads";
import {
  aspectRatioFromInput,
  FailedTile,
  FeedEmptyState,
  FeedLoadingState,
  ImageResultTile,
  Masonry,
  PendingTile,
} from "@/app/[locale]/(studio)/_components/generation/feed-tiles";
import {
  ResultLightbox,
  type LightboxItem,
} from "@/app/[locale]/(studio)/_components/generation/result-lightbox";
import { useComputeWalletBalance } from "@/app/_components/credits-badge";

/**
 * Image studio: create-and-browse on one surface — bottom-docked composer
 * over a masonry history feed with in-feed progress placeholders.
 */
export function ImageStudio({
  heading,
  subheading,
  showFeed = true,
}: {
  heading?: string;
  subheading?: string;
  /** Hide the generation feed to render only the create composer (e.g. home). */
  showFeed?: boolean;
} = {}) {
  const t = useTranslations("studioModes");
  const resolvedHeading = heading ?? t("feed.heading");
  const resolvedSubheading = subheading ?? t("image.feedSubheading");
  const { data: catalog } = useAiCatalog();
  const feed = useGenerationFeed("image", "fizzstudio-image-studio");
  const { data: wallet } = useComputeWalletBalance();
  const uploads = useReferenceUploads();

  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState<FizzAiModel | undefined>(undefined);
  const [settings, setSettings] = useState<ModelSettings>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Auto-select the first usable model with its schema defaults.
  useEffect(() => {
    if (model || !catalog) return;
    const first = usableModelsByModality(catalog, "image")[0];
    if (!first) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setModel(first);
      setSettings(defaultSettingsForModel(first));
    });
    return () => {
      cancelled = true;
    };
  }, [catalog, model]);

  const onSelectModel = (selected: FizzAiModel) => {
    setModel(selected);
    setSettings(defaultSettingsForModel(selected));
  };

  // Reference uploads are offered when the model can edit from images.
  const referenceFields = useMemo(
    () =>
      model?.generationModes?.includes("image_to_image")
        ? referenceFieldsForMode(model, "image_to_image")
        : [],
    [model]
  );
  const activeFieldNames = useMemo(
    () => new Set(referenceFields.map((field) => field.field)),
    [referenceFields]
  );
  const activeUploads = useMemo(
    () => uploads.items.filter((item) => activeFieldNames.has(item.field)),
    [uploads.items, activeFieldNames]
  );

  const cost = useMemo(() => {
    if (!model) return null;
    const estimate = estimateModelSellPoints(model, {
      quality: typeof settings.quality === "string" ? settings.quality : undefined,
      resolution: typeof settings.resolution === "string" ? settings.resolution : undefined,
      numOutputs: typeof settings.numOutputs === "number" ? settings.numOutputs : 1,
      referenceImageCount: activeUploads.length,
    });
    return estimate?.sellPoints ?? null;
  }, [model, settings, activeUploads.length]);

  const uploadsPending = activeUploads.some((item) => item.uploading);
  const canSubmit = Boolean(model && prompt.trim()) && !submitting && !uploadsPending;

  const submit = async () => {
    if (!model || !canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    if (cost != null && wallet && wallet.available < BigInt(Math.ceil(cost))) {
      setSubmitError(t("error.insufficientCredits"));
      setSubmitting(false);
      return;
    }
    const ready = activeUploads.filter((item) => item.url);
    const bindings: FizzAiReferenceBinding[] = ready.map((item, order) => ({
      refId: item.id,
      kind: item.kind,
      label: item.label,
      order,
      url: item.url,
      assetId: item.mediaAssetId,
    }));
    const referenceInput =
      ready.length > 0
        ? {
            referenceImages: ready.map((item) => ({
              url: item.url!,
              refId: item.id,
              label: item.label,
              assetId: item.mediaAssetId,
            })),
          }
        : {};
    const input = compactFizzAiInput(
      filterFizzAiInput(model, { ...settings, ...referenceInput, prompt })
    );
    const result = await feed.submit({
      prompt,
      modelId: model.id,
      schemaVersion: model.schemaVersion,
      input,
      promptDocument: buildPromptDocument(prompt, bindings),
      referenceBindings: bindings.length ? bindings : undefined,
    });
    setSubmitting(false);
    if (!result.ok) setSubmitError(result.error ?? t("error.generationFailed"));
  };

  // Flattened lightbox items: every completed output, history order.
  const lightboxItems = useMemo<LightboxItem[]>(
    () =>
      feed.jobs.flatMap((job) =>
        job.status === "done"
          ? job.outputs
              .filter((output) => output.type === "image")
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
      {showFeed && (
        <section className="mt-6 pb-56">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-white/80">{resolvedHeading}</h2>
            <p className="text-xs text-muted-foreground">
              {feed.hasActiveJobs ? t("feed.live") : resolvedSubheading}
            </p>
          </div>

          <div className="mt-4">
            {feed.historyLoading && feed.jobs.length === 0 ? (
              <FeedLoadingState />
            ) : feed.jobs.length === 0 ? (
              <FeedEmptyState message={t("image.emptyTitle")} hint={t("image.emptyHint")} />
            ) : (
              <Masonry>
                {feed.jobs.map((job) => {
                  if (job.status === "done" && job.outputs.length > 0) {
                    return job.outputs
                      .filter((output) => output.type === "image")
                      .map((output, index) => (
                        <ImageResultTile
                          key={`${job.localId}:${index}`}
                          job={job}
                          output={output}
                          index={index}
                          total={job.outputs.length}
                          onOpen={() => openLightbox(`${job.localId}:${index}`)}
                        />
                      ));
                  }
                  const ratio = aspectRatioFromInput(job.input, "1 / 1");
                  if (isFailed(job)) {
                    return (
                      <FailedTile
                        key={job.localId}
                        job={job}
                        ratio={ratio}
                        onRetry={() =>
                          void feed.retry(
                            job,
                            model ? { schemaVersion: model.schemaVersion } : undefined
                          )
                        }
                      />
                    );
                  }
                  return <PendingTile key={job.localId} job={job} ratio={ratio} />;
                })}
              </Masonry>
            )}
          </div>
        </section>
      )}

      <StudioComposer
        modality="image"
        catalog={catalog}
        prompt={prompt}
        onPromptChange={setPrompt}
        model={model}
        onSelectModel={onSelectModel}
        settings={settings}
        onSettingsChange={setSettings}
        referenceFields={referenceFields}
        referenceItems={activeUploads}
        onAddReferences={(field, files) => uploads.addFiles(field.field, field.kind, files)}
        onRemoveReference={uploads.remove}
        cost={cost}
        canSubmit={canSubmit}
        submitting={submitting}
        error={submitError}
        onSubmit={() => void submit()}
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
