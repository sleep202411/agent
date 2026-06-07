"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconAdjustmentsHorizontal,
  IconAlertTriangle,
  IconChevronDown,
  IconLoader2,
  IconPlus,
  IconSend,
  IconSparkles,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";
import { useAppDispatch } from "@/src/store";
import { touchCredits } from "@/src/store/slices/userSlice";
import { useAiCatalog, usableImageModels } from "../../_hooks/use-ai-catalog";
import {
  compactFizzAiInput,
  errorMessageFromJob,
  estimateModelSellPoints,
  filterFizzAiInput,
  generationIdempotencyKey,
  generationStatusFromRaw,
  getFizzAiJob,
  isTerminalGenerationStatus,
  normalizeFizzAiError,
  submitFizzAiJob,
  type FizzAiGenerationStatus,
  type FizzAiJobView,
  type FizzAiModel,
} from "../../_lib/generation-api";
import { FizzStudioShell, useFizzStudioWorkspace } from "./fizzstudio-shell";
import {
  DEFAULT_IMAGE_GENERATION_SETTINGS,
  getImageModelLabel,
  imageSizeMegapixels,
  ImageSettingsPanel,
  modelById,
  settingsForModel,
  type ImageGenerationSettings,
} from "./image-settings-panel";

type ImageStudioTab = "history" | "community";
type FeedTab = "inspirations" | "community" | "tutorial";

const IMAGE_STUDIO_TABS: ImageStudioTab[] = ["history", "community"];
const FEED_TABS: FeedTab[] = ["inspirations", "community", "tutorial"];

const POLL_INTERVAL_MS = 2200;

/** Local row tracking one submitted job through its lifecycle. */
interface ResultJob {
  localId: string;
  jobId: string;
  prompt: string;
  status: FizzAiGenerationStatus;
  stage: string;
  progress: number | null;
  images: Array<{ id: string; url: string }>;
  error?: string;
}

const IMAGE_FEED = [
  {
    key: "dogPortrait",
    imageUrl:
      "https://images.unsplash.com/photo-1548199973-03cce0bbc87b?q=85&w=900&auto=format&fit=crop",
    className: "aspect-[1.02]",
    objectPosition: "center",
  },
  {
    key: "catInterior",
    imageUrl:
      "https://images.unsplash.com/photo-1574158622682-e40e69881006?q=85&w=1000&auto=format&fit=crop",
    className: "aspect-[1.42]",
    objectPosition: "center 42%",
  },
  {
    key: "sunlitCat",
    imageUrl:
      "https://images.unsplash.com/photo-1518791841217-8f162f1e1131?q=85&w=900&auto=format&fit=crop",
    className: "aspect-[1.12]",
    objectPosition: "center",
  },
  {
    key: "botanical",
    imageUrl:
      "https://images.unsplash.com/photo-1463320726281-696a485928c7?q=85&w=900&auto=format&fit=crop",
    className: "aspect-[0.8]",
    objectPosition: "center",
  },
  {
    key: "glassOrb",
    imageUrl:
      "https://images.unsplash.com/photo-1519681393784-d120267933ba?q=85&w=1100&auto=format&fit=crop",
    className: "aspect-[1.35]",
    objectPosition: "center",
  },
  {
    key: "productLight",
    imageUrl:
      "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?q=85&w=1000&auto=format&fit=crop",
    className: "aspect-[1.15]",
    objectPosition: "center",
  },
  {
    key: "portraitFashion",
    imageUrl:
      "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?q=85&w=900&auto=format&fit=crop",
    className: "aspect-[0.72]",
    objectPosition: "center 36%",
  },
  {
    key: "warmRoom",
    imageUrl:
      "https://images.unsplash.com/photo-1513694203232-719a280e022f?q=85&w=1000&auto=format&fit=crop",
    className: "aspect-[1.48]",
    objectPosition: "center",
  },
  {
    key: "neonAbstract",
    imageUrl:
      "https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=85&w=1000&auto=format&fit=crop",
    className: "aspect-[1.08]",
    objectPosition: "center",
  },
  {
    key: "mountain",
    imageUrl:
      "https://images.unsplash.com/photo-1549880338-65ddcdfd017b?q=85&w=1100&auto=format&fit=crop",
    className: "aspect-[1.62]",
    objectPosition: "center",
  },
  {
    key: "studioFood",
    imageUrl:
      "https://images.unsplash.com/photo-1504674900247-0877df9cc836?q=85&w=1000&auto=format&fit=crop",
    className: "aspect-[1.2]",
    objectPosition: "center",
  },
  {
    key: "cinematicRoad",
    imageUrl:
      "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?q=85&w=1000&auto=format&fit=crop",
    className: "aspect-[1.35]",
    objectPosition: "center 42%",
  },
];

export function ImageStudioPage() {
  const workspaceState = useFizzStudioWorkspace();

  return (
    <FizzStudioShell
      className="overflow-x-hidden bg-[#09090a]"
      headerVariant="enterprise"
      mainClassName="max-w-none px-0 pt-0"
      sidebarVariant="enterprise"
      workspaceState={workspaceState}
    >
      <ImageStudioSurface workspaceId={workspaceState.workspaceId} />
    </FizzStudioShell>
  );
}

function ImageStudioSurface({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations("fizzStudio.imageStudio");
  const dispatch = useAppDispatch();
  const catalogQuery = useAiCatalog();

  const [activeTab, setActiveTab] = useState<ImageStudioTab>("history");
  const [feedTab, setFeedTab] = useState<FeedTab>("inspirations");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<ImageGenerationSettings>(
    DEFAULT_IMAGE_GENERATION_SETTINGS
  );
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<ResultJob[]>([]);

  const imageModels = useMemo(
    () => (catalogQuery.data?.models ?? []).filter((model) => model.type === "image"),
    [catalogQuery.data]
  );

  // Seed the default model + its schema defaults once the catalog resolves.
  useEffect(() => {
    if (settings.model || !catalogQuery.data) return;
    const usable = usableImageModels(catalogQuery.data);
    const first = usable[0];
    if (first) setSettings((prev) => settingsForModel(first, prev));
  }, [catalogQuery.data, settings.model]);

  const selectedModel = useMemo<FizzAiModel | undefined>(
    () => modelById(imageModels, settings.model),
    [imageModels, settings.model]
  );

  // Live 积分 price for the selected model + output count. Recomputes on model
  // switch and count change; null when the model carries no real pricing.
  const priceEstimate = useMemo(
    () =>
      estimateModelSellPoints(
        selectedModel,
        settings.variations,
        imageSizeMegapixels(settings.aspectRatio)
      ),
    [selectedModel, settings.variations, settings.aspectRatio]
  );

  const feedItems = useMemo(() => {
    if (feedTab === "community") return IMAGE_FEED.slice(2).concat(IMAGE_FEED.slice(0, 2));
    if (feedTab === "tutorial") return IMAGE_FEED.slice(5).concat(IMAGE_FEED.slice(0, 5));
    return IMAGE_FEED;
  }, [feedTab]);

  const activeJobIds = useMemo(
    () => jobs.filter((job) => !isTerminalGenerationStatus(job.status)).map((job) => job.jobId),
    [jobs]
  );
  const activeJobKey = useMemo(() => [...activeJobIds].sort().join("|"), [activeJobIds]);

  // Poll all in-flight jobs on a fixed cadence until each reaches a terminal state.
  const pollInFlightRef = useRef(false);
  useEffect(() => {
    if (activeJobIds.length === 0) return;
    let cancelled = false;

    const poll = async () => {
      if (pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      try {
        const results = await Promise.allSettled(activeJobIds.map((jobId) => getFizzAiJob(jobId)));
        if (cancelled) return;

        const byId = new Map<string, FizzAiJobView>();
        for (const result of results) {
          if (result.status === "fulfilled") byId.set(result.value.id, result.value);
        }

        let anyTerminal = false;
        setJobs((prev) =>
          prev.map((row) => {
            const job = byId.get(row.jobId);
            if (!job) return row;
            const status = generationStatusFromRaw(job.status);
            if (isTerminalGenerationStatus(status)) anyTerminal = true;
            return {
              ...row,
              status,
              stage: job.stage,
              progress: job.progress ?? null,
              images: job.outputs
                .filter((output) => Boolean(output.url))
                .map((output) => ({ id: output.id, url: output.url })),
              error:
                status === "failed" || status === "cancelled"
                  ? errorMessageFromJob(job, t("results.failed"))
                  : undefined,
            };
          })
        );
        if (anyTerminal) dispatch(touchCredits());
      } finally {
        pollInFlightRef.current = false;
      }
    };

    void poll();
    const interval = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
    // activeJobKey collapses the id list into a stable dep so the interval only
    // resets when the set of in-flight jobs actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJobKey, dispatch, t]);

  const submit = useCallback(async () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt || !selectedModel || submitting) return;

    setSubmitting(true);
    setSubmitError(null);
    const localId = generationIdempotencyKey("local");

    setJobs((prev) => [
      {
        localId,
        jobId: "",
        prompt: trimmedPrompt,
        status: "queued",
        stage: "submitting",
        progress: null,
        images: [],
      },
      ...prev,
    ]);

    try {
      const rawInput = compactFizzAiInput({
        prompt: trimmedPrompt,
        imageSize: settings.aspectRatio,
        size: settings.aspectRatio,
        aspectRatio: settings.aspectRatio,
        aspect_ratio: settings.aspectRatio,
        resolution: settings.resolution,
        n: settings.variations,
        numOutputs: settings.variations,
      });
      const input = filterFizzAiInput(selectedModel, rawInput);
      const response = await submitFizzAiJob({
        context: {
          workspaceId,
          projectId: "",
          documentId: "",
          documentBlockId: "",
          sourceSurface: "fizzstudio-image-studio",
        },
        idempotencyKey: generationIdempotencyKey(`fizzstudio:image-studio:${workspaceId}`),
        input,
        modelId: selectedModel.id,
        schemaVersion: selectedModel.schemaVersion,
      });
      dispatch(touchCredits());
      const status = generationStatusFromRaw(response.status);
      setJobs((prev) =>
        prev.map((row) =>
          row.localId === localId
            ? {
                ...row,
                jobId: response.request_id,
                status: status === "done" ? "generating" : status,
                stage: response.stage,
                progress: response.progress,
              }
            : row
        )
      );
    } catch (error) {
      const message = normalizeFizzAiError(error, t("results.failed"));
      setSubmitError(message);
      setJobs((prev) =>
        prev.map((row) =>
          row.localId === localId
            ? { ...row, status: "failed", stage: "failed", error: message }
            : row
        )
      );
    } finally {
      setSubmitting(false);
    }
  }, [dispatch, prompt, selectedModel, settings, submitting, t, workspaceId]);

  const retryJob = useCallback(
    (localId: string) => {
      setJobs((prev) => prev.filter((row) => row.localId !== localId));
      void submit();
    },
    [submit]
  );

  const hasResults = jobs.length > 0;

  return (
    <div className="relative min-h-[calc(100svh-64px)] pb-56 text-white">
      <ImageStudioTopBar activeTab={activeTab} onTabChange={setActiveTab} />

      <section className="px-4 pb-10 pt-5 sm:px-6 xl:px-8">
        <div className="mx-auto max-w-none">
          {hasResults ? <ResultsStrip jobs={jobs} onRetry={retryJob} /> : null}

          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.08em] text-white/55">
                <IconSparkles className="size-4" stroke={1.8} />
                {t("eyebrow")}
              </div>
              <h1 className="mt-2 text-[30px] font-semibold leading-tight tracking-[-0.015em] text-white">
                {t("feedTitle")}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/48">{t("feedSubtitle")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {FEED_TABS.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  aria-pressed={feedTab === tab}
                  onClick={() => setFeedTab(tab)}
                  className={cn(
                    "h-8 rounded-full border px-3.5 text-sm font-semibold transition-colors",
                    feedTab === tab
                      ? "border-white/18 bg-white/12 text-white"
                      : "border-white/10 bg-white/[0.03] text-white/58 hover:border-white/18 hover:text-white"
                  )}
                >
                  {t(`feedTabs.${tab}`)}
                </button>
              ))}
            </div>
          </div>

          <ImageMasonry items={feedItems} />
        </div>
      </section>

      <ImagePromptComposer
        models={imageModels}
        catalogLoading={catalogQuery.isLoading}
        catalogError={catalogQuery.isError}
        prompt={prompt}
        settings={settings}
        settingsOpen={settingsOpen}
        submitting={submitting}
        submitError={submitError}
        priceEstimate={priceEstimate}
        canSubmit={Boolean(prompt.trim() && selectedModel && !submitting)}
        onPromptChange={setPrompt}
        onSubmit={submit}
        onOpenSettingsChange={setSettingsOpen}
        onRetryCatalog={() => void catalogQuery.refetch()}
        onSettingsChange={setSettings}
      />
    </div>
  );
}

function ResultsStrip({
  jobs,
  onRetry,
}: {
  jobs: ResultJob[];
  onRetry: (localId: string) => void;
}) {
  const t = useTranslations("fizzStudio.imageStudio");

  return (
    <div className="mb-8 rounded-[16px] border border-white/[0.08] bg-white/[0.02] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl">
      <h2 className="mb-4 text-sm font-semibold tracking-[0.01em] text-white/85">
        {t("results.title")}
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {jobs.flatMap((job) => {
          if (job.status === "failed" || job.status === "cancelled") {
            return [
              <FailedTile
                key={job.localId}
                message={job.error ?? t("results.failed")}
                onRetry={() => onRetry(job.localId)}
              />,
            ];
          }
          if (job.images.length > 0) {
            return job.images.map((image) => (
              <ResultTile key={image.id} url={image.url} alt={t("results.alt")} />
            ));
          }
          return [<PendingTile key={job.localId} job={job} />];
        })}
      </div>
    </div>
  );
}

function ResultTile({ url, alt }: { url: string; alt: string }) {
  return (
    <div className="relative aspect-square overflow-hidden rounded-[16px] bg-[#171719] ring-1 ring-white/[0.08]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={alt} className="size-full object-cover" />
    </div>
  );
}

function PendingTile({ job }: { job: ResultJob }) {
  const t = useTranslations("fizzStudio.imageStudio");
  const label = job.status === "generating" ? t("generating") : t("queued");
  const pct =
    typeof job.progress === "number"
      ? Math.round(Math.min(1, Math.max(0, job.progress)) * 100)
      : null;

  return (
    <div className="relative flex aspect-square flex-col items-center justify-center gap-2 overflow-hidden rounded-[16px] border border-white/[0.07] bg-white/[0.03] ring-1 ring-white/[0.08]">
      <IconLoader2 className="size-6 animate-spin text-white/70" stroke={1.9} />
      <span className="text-xs font-semibold text-white/70">
        {label}
        {pct !== null ? ` ${pct}%` : ""}
      </span>
    </div>
  );
}

function FailedTile({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useTranslations("fizzStudio.imageStudio");
  return (
    <div className="relative flex aspect-square flex-col items-center justify-center gap-2 overflow-hidden rounded-[16px] border border-[#E52227]/40 bg-[#E52227]/[0.08] p-3 text-center ring-1 ring-[#E52227]/20">
      <IconAlertTriangle className="size-6 text-[#ff8a8d]" stroke={1.9} />
      <span className="line-clamp-3 text-xs font-medium text-white/72">{message}</span>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 h-8 rounded-full border border-white/[0.14] bg-white/[0.06] px-3 text-xs font-semibold text-white transition-colors hover:bg-white/[0.1]"
      >
        {t("results.retry")}
      </button>
    </div>
  );
}

function ImageStudioTopBar({
  activeTab,
  onTabChange,
}: {
  activeTab: ImageStudioTab;
  onTabChange: (tab: ImageStudioTab) => void;
}) {
  const t = useTranslations("fizzStudio.imageStudio");

  return (
    <div className="sticky top-16 z-30 border-b border-white/[0.06] bg-[#09090a]/88 backdrop-blur-xl">
      <div className="flex h-14 items-center gap-4 px-4 sm:px-6 xl:px-8">
        <div className="shrink-0 text-base font-semibold text-white">{t("title")}</div>
        <div
          role="tablist"
          aria-label={t("modeTabsLabel")}
          className="flex h-8 rounded-[14px] bg-white/[0.04] p-1"
        >
          {IMAGE_STUDIO_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => onTabChange(tab)}
              className={cn(
                "h-6 min-w-[78px] rounded-[10px] px-3 text-sm font-semibold transition-colors",
                activeTab === tab ? "bg-white/12 text-white" : "text-white/42 hover:text-white"
              )}
            >
              {t(`modeTabs.${tab}`)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ImageMasonry({ items }: { items: typeof IMAGE_FEED }) {
  const t = useTranslations("fizzStudio.imageStudio");

  return (
    <div className="columns-1 gap-3 sm:columns-2 xl:columns-3 2xl:columns-4">
      {items.map((item, index) => (
        <article
          key={`${item.key}-${index}`}
          className={cn(
            "group relative mb-3 break-inside-avoid overflow-hidden rounded-[16px] bg-[#171719] shadow-[0_18px_55px_rgba(0,0,0,.32)] ring-1 ring-white/[0.08]",
            item.className
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.imageUrl}
            alt={t(`galleryAlt.${item.key}`)}
            className="size-full object-cover transition duration-500 group-hover:scale-[1.035]"
            style={{ objectPosition: item.objectPosition }}
          />
          <div className="pointer-events-none absolute inset-0 bg-linear-to-b from-black/0 via-black/0 to-black/32 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
          <div className="absolute inset-x-3 bottom-3 flex translate-y-2 items-center justify-between gap-2 opacity-0 transition duration-300 group-hover:translate-y-0 group-hover:opacity-100">
            <span className="rounded-full bg-black/48 px-3 py-1 text-xs font-semibold text-white backdrop-blur-md">
              {t("recreate")}
            </span>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#111]">
              {t("edit")}
            </span>
          </div>
        </article>
      ))}
    </div>
  );
}

function ImagePromptComposer({
  models,
  catalogLoading,
  catalogError,
  prompt,
  settings,
  settingsOpen,
  submitting,
  submitError,
  priceEstimate,
  canSubmit,
  onPromptChange,
  onSubmit,
  onOpenSettingsChange,
  onRetryCatalog,
  onSettingsChange,
}: {
  models: FizzAiModel[];
  catalogLoading: boolean;
  catalogError: boolean;
  prompt: string;
  settings: ImageGenerationSettings;
  settingsOpen: boolean;
  submitting: boolean;
  submitError: string | null;
  priceEstimate: { sellPoints: number } | null;
  canSubmit: boolean;
  onPromptChange: (value: string) => void;
  onSubmit: () => void;
  onOpenSettingsChange: (open: boolean) => void;
  onRetryCatalog: () => void;
  onSettingsChange: (settings: ImageGenerationSettings) => void;
}) {
  const t = useTranslations("fizzStudio.imageStudio");
  const modelLabel = settings.model
    ? getImageModelLabel(models, settings.model)
    : t("noModelSelected");

  return (
    <>
      {settingsOpen ? (
        <button
          type="button"
          aria-label="Close settings"
          onClick={() => onOpenSettingsChange(false)}
          className="fixed inset-0 z-[39] cursor-default bg-black/55 duration-150 animate-in fade-in-0"
        />
      ) : null}
      <div className="fixed inset-x-4 bottom-4 z-40 mx-auto max-w-[960px] lg:left-[312px] lg:right-6">
        <ImageSettingsPanel
          open={settingsOpen}
          models={models}
          isLoading={catalogLoading}
          error={catalogError}
          settings={settings}
          onOpenChange={onOpenSettingsChange}
          onRetry={onRetryCatalog}
          onSettingsChange={onSettingsChange}
        />
        <div className="relative z-10 w-full overflow-hidden rounded-[16px] border border-white/[0.08] bg-[#141416] text-white shadow-[0_24px_70px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.08)]">
          <div className="grid gap-0 md:grid-cols-[168px_1fr]">
            <div className="hidden border-r border-white/[0.07] p-4 md:block">
              <button
                type="button"
                className="flex h-[86px] w-full items-center justify-center rounded-[16px] border border-white/[0.07] bg-white/[0.03] text-white/70 transition-colors hover:border-white/[0.12] hover:bg-white/[0.06] hover:text-white"
                aria-label={t("addImage")}
              >
                <IconPlus className="size-5" stroke={1.9} />
              </button>
              <button
                type="button"
                className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.05] px-3 text-sm font-semibold text-white/86 transition-colors hover:bg-white/[0.08] hover:text-white"
              >
                <IconPlus className="size-4" stroke={1.9} />
                {t("addImage")}
              </button>
            </div>

            <div className="min-w-0 p-4">
              <label className="sr-only" htmlFor="image-prompt">
                {t("promptLabel")}
              </label>
              <textarea
                id="image-prompt"
                maxLength={800}
                value={prompt}
                onChange={(event) => onPromptChange(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canSubmit) {
                    event.preventDefault();
                    onSubmit();
                  }
                }}
                placeholder={t("promptPlaceholder")}
                className="h-20 w-full resize-none bg-transparent text-sm leading-7 text-white outline-none placeholder:text-white/40 md:h-[76px]"
              />
              {submitError ? (
                <p className="mt-1 text-xs font-medium text-[#ff8a8d]">{submitError}</p>
              ) : null}
              <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    aria-expanded={settingsOpen}
                    onClick={() => onOpenSettingsChange(!settingsOpen)}
                    className="inline-flex h-10 items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.05] px-4 text-sm font-semibold text-white transition-colors hover:bg-white/[0.08]"
                  >
                    <IconAdjustmentsHorizontal className="size-4" stroke={1.8} />
                    {modelLabel}
                    {settings.aspectRatio ? ` / ${settings.aspectRatio}` : ""}
                    <IconChevronDown className="size-4 text-white/48" stroke={1.9} />
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  {priceEstimate ? (
                    <span className="text-sm font-semibold tabular-nums text-white/70">
                      {t("priceEstimate", { points: priceEstimate.sellPoints })}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    disabled={!canSubmit}
                    onClick={onSubmit}
                    className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-[16px] bg-[#E52227] px-9 text-sm font-semibold text-white shadow-[0_18px_38px_rgba(229,34,39,0.28)] transition hover:bg-[#c91d22] hover:scale-[1.01] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
                  >
                    {submitting ? t("creating") : t("create")}
                    {submitting ? (
                      <IconLoader2 className="size-5 animate-spin" stroke={1.9} />
                    ) : (
                      <IconSend className="size-5" stroke={1.9} />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
