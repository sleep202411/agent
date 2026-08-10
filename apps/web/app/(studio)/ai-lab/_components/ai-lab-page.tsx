/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IconAlertTriangle,
  IconBolt,
  IconBoxMultiple,
  IconChevronDown,
  IconCircleCheck,
  IconClockHour4,
  IconCrown,
  IconHistory,
  IconLock,
  IconPlayerPause,
  IconPlayerPlay,
  IconRefresh,
  IconRoute,
  IconSettings,
  IconSparkles,
  IconVideo,
  IconWand,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { QuotaProvider } from "@/src/lib/quota/quota-provider";
import { UpgradeDialogHost } from "@/components/quota/upgrade-dialog";
import { UpgradeDialog as MembershipUpgradeDialog } from "@/components/payment/upgrade-dialog";
import { useTranslations } from "@/src/i18n/i18n";
import { useCredits, useCurrentUser } from "@/src/hooks/use-user";
import { getMyEntitlement } from "@/src/lib/billing/api";
import { cn } from "@/lib/utils";
import {
  cancelAiJob,
  friendlyError,
  listAiCatalog,
  listAiJobs,
  retryAiJob,
  submitAiJob,
} from "../_lib/client";
import {
  deriveInitialValues,
  fieldDescription,
  fieldDescriptors,
  fieldLabel,
  groupFields,
  normalizeFieldValue,
  optionLocked,
  primaryFields,
  pruneInput,
  readOptions,
  secondaryFields,
  serializeFieldValue,
  validateInput,
  type AiFieldDescriptor,
  type AiFieldGroup,
  type AiValidationIssue,
  type AiValidationMessages,
} from "../_lib/schema";
import type {
  AiJobOutput,
  AiJobView,
  AiLabCatalog,
  AiLabField,
  AiLabMode,
  AiLabModel,
  AiLabPreset,
  AiSubmitResponse,
} from "../_lib/types";

type CatalogSource = "loading" | "live" | "preview" | "error";

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "expired"]);
const HISTORY_LIMIT = 80;
const PREVIEW_IMAGE =
  "https://images.unsplash.com/photo-1604079628040-94301bb21b91?auto=format&fit=crop&w=1400&q=86";
const PREVIEW_VIDEO = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

export function AiLabPage() {
  const rawT = useTranslations("aiLab");
  const t = useCallback(
    (key: string, params?: Record<string, string | number | Date>) => rawT(key, params),
    [rawT]
  );
  const { user } = useCurrentUser();
  const { data: credits } = useCredits();
  const entitlement = useQuery({
    queryKey: ["billing", "my-entitlement"],
    queryFn: getMyEntitlement,
    enabled: Boolean(user),
    staleTime: 30_000,
  });
  const [mode, setMode] = useState<AiLabMode>("image");
  const [catalog, setCatalog] = useState<AiLabCatalog | null>(null);
  const [catalogSource, setCatalogSource] = useState<CatalogSource>("loading");
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<AiJobView[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [selectedPresetByMode, setSelectedPresetByMode] = useState<
    Partial<Record<AiLabMode, string>>
  >({});
  const [formByModel, setFormByModel] = useState<Record<string, Record<string, unknown>>>({});
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [issues, setIssues] = useState<AiValidationIssue[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const currentPlan = entitlement.data?.entitlement.planKey ?? "free";
  const currentPlanRank = entitlement.data?.entitlement.rank ?? 0;
  const validationMessages = useMemo<AiValidationMessages>(
    () => ({
      required: (label) => t("error.fieldRequired", { label }),
      minLength: (label, min) => t("error.fieldMinLength", { label, min }),
      maxLength: (label, max) => t("error.fieldMaxLength", { label, max }),
      minItems: (label, min) => t("error.fieldMinItems", { label, min }),
      maxItems: (label, max) => t("error.fieldMaxItems", { label, max }),
      minimum: (label, min) => t("error.fieldMinimum", { label, min }),
      maximum: (label, max) => t("error.fieldMaximum", { label, max }),
      unsupportedOption: (label) => t("error.fieldUnsupportedOption", { label }),
      invalidUrl: (label) => t("error.fieldInvalidUrl", { label }),
    }),
    [t]
  );

  const loadCatalog = useCallback(async () => {
    setCatalogSource("loading");
    setCatalogError(null);
    try {
      const result = await listAiCatalog();
      setCatalog(result.catalog);
      setCatalogSource(result.source);
    } catch (error) {
      setCatalogSource("error");
      setCatalogError(friendlyError(error, t("error.loadCatalog")));
    }
  }, [t]);

  const loadJobs = useCallback(
    async (nextMode = mode) => {
      setJobsLoading(true);
      setJobsError(null);
      try {
        const next = await listAiJobs({ type: nextMode, limit: HISTORY_LIMIT });
        setJobs(next);
      } catch (error) {
        setJobsError(friendlyError(error, t("error.loadJobs")));
      } finally {
        setJobsLoading(false);
      }
    },
    [mode, t]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void loadCatalog(), 0);
    return () => window.clearTimeout(timer);
  }, [loadCatalog]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadJobs(mode), 0);
    return () => window.clearTimeout(timer);
  }, [loadJobs, mode]);

  const modePresets = useMemo(() => {
    return (catalog?.presets ?? [])
      .filter((preset) => preset.type === mode)
      .sort((a, b) => (a.sortOrder ?? 10_000) - (b.sortOrder ?? 10_000));
  }, [catalog, mode]);

  const modeModels = useMemo(() => {
    return (catalog?.models ?? []).filter((model) => model.type === mode);
  }, [catalog, mode]);

  const selectedPreset = useMemo(() => {
    const selectedId = selectedPresetByMode[mode];
    return modePresets.find((preset) => preset.id === selectedId) ?? modePresets[0] ?? null;
  }, [mode, modePresets, selectedPresetByMode]);

  const selectedModel = useMemo(() => {
    if (!selectedPreset) return modeModels[0] ?? null;
    return (
      selectedPreset.modelIds
        .map((id) => modeModels.find((model) => model.id === id))
        .find((model): model is AiLabModel => Boolean(model?.enabled)) ??
      selectedPreset.modelIds
        .map((id) => modeModels.find((model) => model.id === id))
        .find((model): model is AiLabModel => Boolean(model)) ??
      null
    );
  }, [modeModels, selectedPreset]);

  const formData = useMemo(() => {
    if (!selectedModel) return {};
    return formByModel[selectedModel.id] ?? deriveInitialValues(selectedModel.input_schema);
  }, [formByModel, selectedModel]);
  const fields = useMemo(
    () => (selectedModel ? fieldDescriptors(selectedModel.input_schema, formData) : []),
    [formData, selectedModel]
  );
  const groups = useMemo(
    () => (selectedModel ? groupFields(selectedModel.input_schema, secondaryFields(fields)) : []),
    [fields, selectedModel]
  );
  const topFields = useMemo(() => primaryFields(fields), [fields]);
  const promptField = useMemo(() => fields.find((field) => field.name === "prompt"), [fields]);
  const prompt = typeof formData.prompt === "string" ? formData.prompt : "";
  const selectedJob = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) ?? jobs[0] ?? null,
    [jobs, selectedJobId]
  );
  const activeJobs = useMemo(
    () => jobs.filter((job) => !TERMINAL_STATUSES.has(job.status)),
    [jobs]
  );
  const resultOutputs = useMemo(() => jobs.flatMap(jobOutputs), [jobs]);
  const currentCampaign = useMemo(() => {
    const id = selectedPreset?.campaignId;
    return id ? catalog?.campaigns?.find((campaign) => campaign.campaignId === id) : undefined;
  }, [catalog?.campaigns, selectedPreset?.campaignId]);
  const selectedRequiredPlan = requiredPlanFor(selectedPreset, selectedModel);
  const isPlanBlocked =
    selectedRequiredPlan != null && planRank(selectedRequiredPlan) > currentPlanRank;
  const selectedBlockedReason = blockedReason({
    preset: selectedPreset,
    model: selectedModel,
    currentPlanRank,
    t,
  });
  const canSubmit =
    Boolean(selectedModel) &&
    Boolean(selectedPreset) &&
    prompt.trim().length > 0 &&
    !submitting &&
    !selectedBlockedReason &&
    selectedPreset?.enabled !== false &&
    selectedModel?.enabled !== false;

  useEffect(() => {
    const hasActiveJobs = activeJobs.length > 0;
    const interval = window.setInterval(() => void loadJobs(mode), hasActiveJobs ? 4_000 : 15_000);
    return () => window.clearInterval(interval);
  }, [activeJobs.length, loadJobs, mode]);

  const setFieldValue = useCallback(
    (name: string, value: unknown) => {
      if (!selectedModel) return;
      setIssues((prev) => prev.filter((issue) => issue.field !== name));
      setFormByModel((prev) => ({
        ...prev,
        [selectedModel.id]: {
          ...(prev[selectedModel.id] ?? deriveInitialValues(selectedModel.input_schema)),
          [name]: value,
        },
      }));
    },
    [selectedModel]
  );

  const resetForm = useCallback(() => {
    if (!selectedModel) return;
    setIssues([]);
    setFormByModel((prev) => ({
      ...prev,
      [selectedModel.id]: deriveInitialValues(selectedModel.input_schema),
    }));
  }, [selectedModel]);

  const handleSubmit = useCallback(async () => {
    if (!selectedModel || !selectedPreset) return;
    const validation = [
      ...validateInput(selectedModel.input_schema, formData, validationMessages),
      ...lockedOptionIssues({
        fields,
        values: formData,
        currentPlanRank,
        t,
      }),
    ];
    setIssues(validation);
    if (validation.length > 0) {
      toast.error(validation[0]?.message ?? t("error.validation"));
      return;
    }
    setSubmitting(true);
    const values = pruneInput(selectedModel.input_schema, formData);
    try {
      if (catalogSource === "preview") {
        const previewJob = makePreviewJob({
          response: {
            request_id: `preview:${Date.now()}`,
            workspace_id: null,
            project_id: null,
            document_id: null,
            document_block_id: null,
            site_region: "preview",
            source_surface: "ai-lab",
            status: "in_queue",
            stage: "queued",
            progress: null,
            queue_position: 1,
            estimated_wait_seconds: 3,
            estimated_run_seconds: selectedModel.type === "video" ? 18 : 5,
            estimated_total_seconds: selectedModel.type === "video" ? 21 : 8,
            eta_confidence: "medium",
            logs: [],
            response_url: "",
            status_url: "",
            cancel_url: "",
          },
          model: selectedModel,
          preset: selectedPreset,
          input: values,
        });
        setJobs((prev) => [previewJob, ...prev]);
        toast.success(t("toast.accepted"));
        window.setTimeout(() => {
          setJobs((prev) =>
            prev.map((job) =>
              job.id === previewJob.id
                ? {
                    ...job,
                    status: "completed",
                    stage: "completed",
                    progress: 100,
                    queuePosition: null,
                    outputs: [
                      {
                        id: `${previewJob.id}:output`,
                        type: selectedModel.type,
                        url: selectedModel.type === "video" ? PREVIEW_VIDEO : PREVIEW_IMAGE,
                        createdAt: new Date().toISOString(),
                      },
                    ],
                    completedAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                  }
                : job
            )
          );
        }, 1200);
        return;
      }

      const response = await submitAiJob({
        presetId: selectedPreset.id,
        campaignId: selectedPreset.campaignId,
        schemaVersion: selectedModel.schemaVersion,
        values,
        idempotencyKey: crypto.randomUUID(),
      });
      setJobs((prev) => [
        makePreviewJob({ response, model: selectedModel, preset: selectedPreset, input: values }),
        ...prev.filter((job) => job.id !== response.request_id),
      ]);
      setSelectedJobId(response.request_id);
      toast.success(t("toast.accepted"));
      void loadJobs(mode);
    } catch (error) {
      toast.error(friendlyError(error, t("error.submit")));
    } finally {
      setSubmitting(false);
    }
  }, [
    catalogSource,
    currentPlanRank,
    fields,
    formData,
    loadJobs,
    mode,
    selectedModel,
    selectedPreset,
    t,
    validationMessages,
  ]);

  const handleRetry = useCallback(
    async (job: AiJobView) => {
      try {
        const response = await retryAiJob(job.id);
        setJobs((prev) =>
          prev.map((item) =>
            item.id === job.id
              ? {
                  ...item,
                  id: response.request_id,
                  status: response.status,
                  stage: response.stage,
                  queuePosition: response.queue_position,
                  progress: response.progress,
                  estimatedTotalSeconds: response.estimated_total_seconds,
                  updatedAt: new Date().toISOString(),
                }
              : item
          )
        );
        toast.success(t("toast.accepted"));
      } catch (error) {
        toast.error(friendlyError(error, t("error.retry")));
      }
    },
    [t]
  );

  const handleCancel = useCallback(
    async (job: AiJobView) => {
      try {
        const next = await cancelAiJob(job.id);
        setJobs((prev) => prev.map((item) => (item.id === job.id ? next : item)));
      } catch (error) {
        toast.error(friendlyError(error, t("error.cancel")));
      }
    },
    [t]
  );

  return (
    <QuotaProvider enabled={Boolean(user)}>
      <UpgradeDialogHost />
      <MembershipUpgradeDialog open={upgradeOpen} onOpenChange={setUpgradeOpen} />
      <div className="min-h-[calc(100dvh-56px)] bg-black text-zinc-50">
        <div className="mx-auto flex min-h-[calc(100dvh-56px)] max-w-[1720px] flex-col px-4 py-4 md:px-6">
          <TopBar
            t={t}
            mode={mode}
            onModeChange={setMode}
            source={catalogSource}
            region={catalog?.region}
            activeCount={activeJobs.length}
            credits={credits}
            currentPlan={currentPlan}
            onRefresh={() => {
              void loadCatalog();
              void loadJobs(mode);
            }}
          />

          <div className="grid min-h-0 flex-1 gap-4 pt-4 xl:grid-cols-[300px_minmax(0,1fr)_340px]">
            <ModelRail
              t={t}
              mode={mode}
              presets={modePresets}
              models={modeModels}
              selectedPreset={selectedPreset}
              selectedModel={selectedModel}
              currentPlanRank={currentPlanRank}
              source={catalogSource}
              error={catalogError}
              campaignId={currentCampaign?.campaignId}
              onSelectPreset={(presetId) =>
                setSelectedPresetByMode((prev) => ({ ...prev, [mode]: presetId }))
              }
              onRetryCatalog={loadCatalog}
            />

            <main className="flex min-h-0 flex-col gap-4">
              <ResultCanvas
                t={t}
                mode={mode}
                selectedJob={selectedJob}
                activeJobs={activeJobs}
                outputs={resultOutputs}
                jobsLoading={jobsLoading}
                jobsError={jobsError}
                onSelectJob={setSelectedJobId}
                onRetryLoad={() => void loadJobs(mode)}
              />
              <ComposerPanel
                t={t}
                model={selectedModel}
                preset={selectedPreset}
                campaign={currentCampaign}
                promptField={promptField}
                prompt={prompt}
                topFields={topFields}
                groups={groups}
                values={formData}
                issues={issues}
                expandedGroups={expandedGroups}
                currentPlanRank={currentPlanRank}
                canSubmit={canSubmit}
                blockedReason={selectedBlockedReason}
                upgradeable={isPlanBlocked}
                submitting={submitting}
                onFieldChange={setFieldValue}
                onToggleGroup={(id) => setExpandedGroups((prev) => ({ ...prev, [id]: !prev[id] }))}
                onSubmit={handleSubmit}
                onUpgrade={() => setUpgradeOpen(true)}
                onReset={resetForm}
              />
            </main>

            <QueuePanel
              t={t}
              jobs={jobs}
              activeJobs={activeJobs}
              selectedJob={selectedJob}
              selectedModel={selectedModel}
              selectedPreset={selectedPreset}
              onSelectJob={setSelectedJobId}
              onCancel={handleCancel}
              onRetry={handleRetry}
            />
          </div>
        </div>
      </div>
    </QuotaProvider>
  );
}

function TopBar({
  t,
  mode,
  onModeChange,
  source,
  region,
  activeCount,
  credits,
  currentPlan,
  onRefresh,
}: {
  t: TFn;
  mode: AiLabMode;
  onModeChange: (mode: AiLabMode) => void;
  source: CatalogSource;
  region?: string;
  activeCount: number;
  credits?: number;
  currentPlan: string;
  onRefresh: () => void;
}) {
  return (
    <header className="flex flex-col gap-3 border-b border-white/10 pb-4 lg:flex-row lg:items-center">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-normal text-zinc-500">
          <IconSparkles className="size-3.5 text-primary" />
          <span>{t("eyebrow")}</span>
          <span className="h-1 w-1 rounded-full bg-zinc-700" />
          <span>{region ?? "global"}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-end gap-x-3 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-normal text-white md:text-3xl">
            {t("title")}
          </h1>
          <p className="max-w-2xl pb-1 text-sm text-zinc-400">{t("subtitle")}</p>
        </div>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <SegmentedMode value={mode} onChange={onModeChange} t={t} />
        <StatusPill
          icon={<IconRoute className="size-3.5" />}
          label={
            source === "live"
              ? t("source.live")
              : source === "preview"
                ? t("source.preview")
                : source === "error"
                  ? t("source.error")
                  : t("source.loading")
          }
          tone={source === "live" ? "success" : source === "error" ? "danger" : "muted"}
        />
        <StatusPill
          icon={<IconClockHour4 className="size-3.5" />}
          label={t("activeCount", { count: activeCount })}
          tone={activeCount > 0 ? "warning" : "muted"}
        />
        <StatusPill
          icon={<IconBolt className="size-3.5" />}
          label={t("credits", { count: Number.isFinite(Number(credits)) ? Number(credits) : 0 })}
          tone="muted"
        />
        <StatusPill
          icon={<IconCrown className="size-3.5" />}
          label={planLabel(currentPlan, t)}
          tone="muted"
        />
        <Button type="button" variant="outline" color="muted" size="icon" onClick={onRefresh}>
          <IconRefresh className="size-4" />
        </Button>
      </div>
    </header>
  );
}

function SegmentedMode({
  value,
  onChange,
  t,
}: {
  value: AiLabMode;
  onChange: (mode: AiLabMode) => void;
  t: TFn;
}) {
  return (
    <div className="grid h-9 grid-cols-2 rounded-lg border border-white/10 bg-white/[0.04] p-1">
      {(["image", "video"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          className={cn(
            "inline-flex min-w-22 items-center justify-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors",
            value === mode ? "bg-white text-black" : "text-zinc-400 hover:text-white"
          )}
        >
          {mode === "image" ? (
            <IconWand className="size-3.5" />
          ) : (
            <IconVideo className="size-3.5" />
          )}
          {t(`mode.${mode}`)}
        </button>
      ))}
    </div>
  );
}

function ModelRail({
  t,
  mode,
  presets,
  models,
  selectedPreset,
  selectedModel,
  currentPlanRank,
  source,
  error,
  campaignId,
  onSelectPreset,
  onRetryCatalog,
}: {
  t: TFn;
  mode: AiLabMode;
  presets: AiLabPreset[];
  models: AiLabModel[];
  selectedPreset: AiLabPreset | null;
  selectedModel: AiLabModel | null;
  currentPlanRank: number;
  source: CatalogSource;
  error: string | null;
  campaignId?: string;
  onSelectPreset: (id: string) => void;
  onRetryCatalog: () => void;
}) {
  return (
    <aside className="min-h-0 overflow-hidden rounded-xl border border-white/10 bg-zinc-950">
      <div className="border-b border-white/10 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white">{t("modelRail.title")}</h2>
            <p className="mt-1 text-xs text-zinc-500">{t("modelRail.subtitle")}</p>
          </div>
          <IconBoxMultiple className="size-4 text-zinc-500" />
        </div>
      </div>
      <div className="max-h-[calc(100dvh-220px)] overflow-y-auto p-3">
        {source === "loading" ? (
          <RailEmpty
            icon={<IconRefresh className="size-5 animate-spin" />}
            text={t("source.loading")}
          />
        ) : error ? (
          <div className="rounded-lg border border-red-500/25 bg-red-500/10 p-3">
            <p className="text-xs text-red-100">{error}</p>
            <Button
              className="mt-3 w-full"
              size="sm"
              variant="soft"
              color="destructive"
              onClick={onRetryCatalog}
            >
              {t("action.retry")}
            </Button>
          </div>
        ) : presets.length === 0 ? (
          <RailEmpty
            icon={<IconAlertTriangle className="size-5" />}
            text={t("modelRail.empty", { mode: t(`mode.${mode}`) })}
          />
        ) : (
          <div className="space-y-2">
            {presets.map((preset) => {
              const active = preset.id === selectedPreset?.id;
              const locked = planRank(preset.requiredPlan) > currentPlanRank;
              const primaryModel = preset.modelIds
                .map((id) => models.find((model) => model.id === id))
                .find(Boolean);
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => onSelectPreset(preset.id)}
                  className={cn(
                    "w-full rounded-lg border p-3 text-left transition-colors",
                    active
                      ? "border-primary/60 bg-primary/10"
                      : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-white">
                          {preset.label}
                        </span>
                        {preset.campaignId ? <Badge tone="success">{t("badge.free")}</Badge> : null}
                        {locked ? (
                          <Badge tone="warning">{planLabel(preset.requiredPlan, t)}</Badge>
                        ) : null}
                      </div>
                      {preset.description ? (
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">
                          {preset.description}
                        </p>
                      ) : null}
                    </div>
                    {locked ? <IconLock className="mt-0.5 size-4 text-amber-300" /> : null}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-zinc-500">
                    <Metric label={t("modelRail.cost")} value={formatCost(preset, t)} />
                    <Metric
                      label={t("modelRail.queue")}
                      value={String(preset.queuePolicy.perUserQueued)}
                    />
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/10 pt-2">
                    <span className="truncate text-[11px] text-zinc-500">
                      {primaryModel?.name ?? t("modelRail.noModel")}
                    </span>
                    <span className="text-[11px] text-zinc-600">{preset.routeMode}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-zinc-300">
              {t("modelRail.selectedModel")}
            </span>
            {campaignId ? <Badge tone="success">{campaignId}</Badge> : null}
          </div>
          <p className="mt-2 text-sm font-medium text-white">
            {selectedModel?.name ?? t("modelRail.noModel")}
          </p>
          <p className="mt-1 line-clamp-3 text-xs leading-5 text-zinc-500">
            {selectedModel?.description ?? t("modelRail.noModelDesc")}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {selectedModel?.provider ? <Badge tone="muted">{selectedModel.provider}</Badge> : null}
            {selectedModel?.schemaVersion ? (
              <Badge tone="muted">{selectedModel.schemaVersion}</Badge>
            ) : null}
            {selectedModel?.generationModes.slice(0, 2).map((item) => (
              <Badge key={item} tone="muted">
                {modeLabel(item, t)}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    </aside>
  );
}

function ResultCanvas({
  t,
  mode,
  selectedJob,
  activeJobs,
  outputs,
  jobsLoading,
  jobsError,
  onSelectJob,
  onRetryLoad,
}: {
  t: TFn;
  mode: AiLabMode;
  selectedJob: AiJobView | null;
  activeJobs: AiJobView[];
  outputs: Array<{ job: AiJobView; output: AiJobOutput }>;
  jobsLoading: boolean;
  jobsError: string | null;
  onSelectJob: (id: string) => void;
  onRetryLoad: () => void;
}) {
  const heroOutput = selectedJob?.outputs[0] ?? outputs[0]?.output ?? null;
  return (
    <section className="grid min-h-[420px] gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="relative overflow-hidden rounded-xl border border-white/10 bg-zinc-950">
        <div className="absolute left-4 top-4 z-10 flex items-center gap-2">
          <Badge tone={activeJobs.length > 0 ? "warning" : "muted"}>
            {activeJobs.length > 0
              ? t("canvas.active", { count: activeJobs.length })
              : t("canvas.ready")}
          </Badge>
          {selectedJob ? <Badge tone="muted">{stageLabel(selectedJob.stage, t)}</Badge> : null}
        </div>
        <div className="flex h-full min-h-[420px] items-center justify-center p-5">
          {heroOutput ? (
            <MediaPreview output={heroOutput} mode={mode} />
          ) : activeJobs[0] ? (
            <ProgressPreview job={activeJobs[0]} t={t} />
          ) : (
            <div className="max-w-sm text-center">
              <span className="mx-auto flex size-12 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
                <IconSparkles className="size-6 text-zinc-400" />
              </span>
              <h2 className="mt-4 text-base font-semibold text-white">{t("canvas.emptyTitle")}</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-500">{t("canvas.emptyBody")}</p>
            </div>
          )}
        </div>
      </div>
      <div className="rounded-xl border border-white/10 bg-zinc-950 p-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">{t("results.title")}</h2>
          {jobsLoading ? <IconRefresh className="size-4 animate-spin text-zinc-500" /> : null}
        </div>
        {jobsError ? (
          <div className="mt-3 rounded-lg border border-red-500/25 bg-red-500/10 p-3">
            <p className="text-xs text-red-100">{jobsError}</p>
            <Button
              className="mt-3 w-full"
              size="sm"
              variant="soft"
              color="destructive"
              onClick={onRetryLoad}
            >
              {t("action.retry")}
            </Button>
          </div>
        ) : outputs.length === 0 ? (
          <p className="mt-3 text-xs leading-5 text-zinc-500">{t("results.empty")}</p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {outputs.slice(0, 8).map(({ job, output }) => (
              <button
                key={output.id}
                type="button"
                onClick={() => onSelectJob(job.id)}
                className="group relative aspect-square overflow-hidden rounded-lg border border-white/10 bg-white/[0.04]"
              >
                {output.type === "video" ? (
                  <video
                    src={output.url}
                    className="h-full w-full object-cover"
                    muted
                    playsInline
                  />
                ) : (
                  <img src={output.url} alt="" className="h-full w-full object-cover" />
                )}
                <span className="absolute inset-x-0 bottom-0 bg-black/70 px-2 py-1 text-left text-[10px] text-zinc-300 opacity-0 transition-opacity group-hover:opacity-100">
                  {job.prompt || t("results.untitled")}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ComposerPanel({
  t,
  model,
  preset,
  campaign,
  promptField,
  prompt,
  topFields,
  groups,
  values,
  issues,
  expandedGroups,
  currentPlanRank,
  canSubmit,
  blockedReason,
  upgradeable,
  submitting,
  onFieldChange,
  onToggleGroup,
  onSubmit,
  onUpgrade,
  onReset,
}: {
  t: TFn;
  model: AiLabModel | null;
  preset: AiLabPreset | null;
  campaign?: { campaignId: string; label?: string } | undefined;
  promptField?: AiFieldDescriptor;
  prompt: string;
  topFields: AiFieldDescriptor[];
  groups: AiFieldGroup[];
  values: Record<string, unknown>;
  issues: AiValidationIssue[];
  expandedGroups: Record<string, boolean>;
  currentPlanRank: number;
  canSubmit: boolean;
  blockedReason?: string;
  upgradeable: boolean;
  submitting: boolean;
  onFieldChange: (name: string, value: unknown) => void;
  onToggleGroup: (id: string) => void;
  onSubmit: () => void;
  onUpgrade: () => void;
  onReset: () => void;
}) {
  const issueByField = useMemo(
    () => new Map(issues.map((issue) => [issue.field, issue])),
    [issues]
  );
  return (
    <section className="rounded-xl border border-white/10 bg-zinc-950">
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="muted">{preset?.label ?? t("composer.noPreset")}</Badge>
            {campaign ? (
              <Badge tone="success">{campaign.label ?? campaign.campaignId}</Badge>
            ) : null}
            {model?.access?.allowed === false ? (
              <Badge tone="warning">{t("badge.locked")}</Badge>
            ) : null}
          </div>
          <label className="mt-4 block">
            <span className="text-xs font-medium text-zinc-400">
              {promptField ? fieldLabel(promptField.field, promptField.name) : t("composer.prompt")}
            </span>
            <Textarea
              value={prompt}
              onChange={(event) => onFieldChange("prompt", event.target.value)}
              placeholder={t("composer.placeholder")}
              className="mt-2 min-h-32 resize-y rounded-lg border-white/10 bg-black/40 text-sm leading-6 text-white placeholder:text-zinc-600"
            />
          </label>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {topFields.map((field) => (
              <SchemaFieldControl
                key={field.name}
                descriptor={field}
                value={values[field.name]}
                issue={issueByField.get(field.name)}
                currentPlanRank={currentPlanRank}
                onChange={(value) => onFieldChange(field.name, value)}
              />
            ))}
          </div>
        </div>
        <div className="flex flex-col justify-between rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <div>
            <h3 className="text-sm font-semibold text-white">{t("composer.routeTitle")}</h3>
            <p className="mt-1 text-xs leading-5 text-zinc-500">{t("composer.routeBody")}</p>
            <div className="mt-3 space-y-2">
              <Metric label={t("composer.cost")} value={formatCost(preset, t)} />
              <Metric
                label={t("composer.queue")}
                value={
                  preset
                    ? `${preset.queuePolicy.perUserRunning}/${preset.queuePolicy.perUserQueued}`
                    : "-"
                }
              />
              <Metric label={t("composer.model")} value={model?.name ?? "-"} />
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-2">
            {blockedReason ? (
              <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-2 text-xs leading-5 text-amber-100">
                {blockedReason}
              </div>
            ) : null}
            <Button
              type="button"
              className="h-10 w-full"
              disabled={upgradeable ? false : !canSubmit}
              loading={submitting && !upgradeable}
              onClick={upgradeable ? onUpgrade : onSubmit}
              icon={
                upgradeable ? <IconCrown className="size-4" /> : <IconSparkles className="size-4" />
              }
            >
              {upgradeable
                ? t("action.upgrade")
                : blockedReason
                  ? t("action.unavailable")
                  : t("action.generate")}
            </Button>
            <Button
              type="button"
              className="w-full"
              variant="outline"
              color="muted"
              onClick={onReset}
            >
              {t("action.reset")}
            </Button>
          </div>
        </div>
      </div>
      <div className="border-t border-white/10 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">{t("advanced.title")}</h3>
            <p className="mt-1 text-xs text-zinc-500">{t("advanced.body")}</p>
          </div>
          <IconSettings className="size-4 text-zinc-500" />
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {groups
            .filter((group) =>
              group.fields.some(
                (field) =>
                  field.name !== "prompt" && !topFields.some((top) => top.name === field.name)
              )
            )
            .map((group) => {
              const isOpen = expandedGroups[group.id] ?? !group.defaultCollapsed;
              const fields = group.fields.filter(
                (field) =>
                  field.name !== "prompt" && !topFields.some((top) => top.name === field.name)
              );
              if (fields.length === 0) return null;
              return (
                <div key={group.id} className="rounded-lg border border-white/10 bg-white/[0.03]">
                  <button
                    type="button"
                    onClick={() => onToggleGroup(group.id)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                  >
                    <span>
                      <span className="block text-xs font-semibold text-zinc-200">
                        {group.title}
                      </span>
                      {group.description ? (
                        <span className="mt-0.5 block text-[11px] text-zinc-500">
                          {group.description}
                        </span>
                      ) : null}
                    </span>
                    <IconChevronDown
                      className={cn(
                        "size-4 text-zinc-500 transition-transform",
                        isOpen && "rotate-180"
                      )}
                    />
                  </button>
                  {isOpen ? (
                    <div className="grid gap-3 border-t border-white/10 p-3 md:grid-cols-2">
                      {fields.map((field) => (
                        <SchemaFieldControl
                          key={field.name}
                          descriptor={field}
                          value={values[field.name]}
                          issue={issueByField.get(field.name)}
                          currentPlanRank={currentPlanRank}
                          onChange={(value) => onFieldChange(field.name, value)}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
        </div>
      </div>
    </section>
  );
}

function SchemaFieldControl({
  descriptor,
  value,
  issue,
  currentPlanRank,
  onChange,
}: {
  descriptor: AiFieldDescriptor;
  value: unknown;
  issue?: AiValidationIssue;
  currentPlanRank: number;
  onChange: (value: unknown) => void;
}) {
  const { field, name, ui, required } = descriptor;
  const label = fieldLabel(field, name);
  const disabled = descriptor.enabled === false;
  const description = disabled ? descriptor.disabledReason : fieldDescription(field);
  const options = readOptions(field);
  const control = ui.control ?? inferControl(field);
  const commonLabel = (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <span className="truncate text-xs font-medium text-zinc-400">
        {label}
        {required ? <span className="text-primary"> *</span> : null}
      </span>
      {ui.unit ? <span className="text-[10px] uppercase text-zinc-600">{ui.unit}</span> : null}
    </div>
  );

  if ((control === "segmented" || control === "radio") && options.length > 0) {
    return (
      <div>
        {commonLabel}
        <div className="flex flex-wrap gap-1.5">
          {options.map((option) => {
            const locked = optionLocked(option, currentPlanRank, planRank);
            const active = value === option.value;
            return (
              <button
                key={String(option.value)}
                type="button"
                disabled={locked || disabled}
                onClick={() => onChange(option.value)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors",
                  active
                    ? "border-primary/70 bg-primary/15 text-white"
                    : "border-white/10 bg-black/30 text-zinc-400 hover:border-white/20 hover:text-white",
                  (locked || disabled) && "cursor-not-allowed opacity-50"
                )}
              >
                {locked ? <IconLock className="size-3" /> : null}
                {option.label}
              </button>
            );
          })}
        </div>
        <FieldHelp issue={issue} description={description} />
      </div>
    );
  }

  if (control === "select" && options.length > 0) {
    return (
      <label className="block">
        {commonLabel}
        <NativeSelect
          value={serializeFieldValue(field, value)}
          disabled={disabled}
          onChange={(nextValue) => onChange(normalizeFieldValue(field, nextValue))}
          className="h-8 w-full rounded-md border border-white/10 bg-black/40 px-2 text-xs text-white outline-none focus:border-primary/60"
        >
          {options.map((option) => {
            const locked = optionLocked(option, currentPlanRank, planRank);
            return (
              <option key={String(option.value)} value={String(option.value)} disabled={locked}>
                {option.label}
              </option>
            );
          })}
        </NativeSelect>
        <FieldHelp issue={issue} description={description} />
      </label>
    );
  }

  if (field.type === "boolean" || control === "switch" || control === "checkbox") {
    return (
      <label className="flex items-start gap-2 rounded-md border border-white/10 bg-black/30 p-2">
        <input
          type="checkbox"
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-0.5 size-4 accent-primary"
        />
        <span className="min-w-0">
          <span className="block text-xs font-medium text-zinc-300">{label}</span>
          <FieldHelp issue={issue} description={description} />
        </span>
      </label>
    );
  }

  if (
    field.type === "array" ||
    control === "media_upload" ||
    control === "image_upload" ||
    control === "video_upload"
  ) {
    return (
      <label className="block md:col-span-2">
        {commonLabel}
        <Textarea
          value={serializeFieldValue(field, value)}
          disabled={disabled}
          onChange={(event) => onChange(normalizeFieldValue(field, event.target.value))}
          placeholder={description ?? ""}
          className="min-h-20 rounded-md border-white/10 bg-black/40 text-xs text-white placeholder:text-zinc-600"
        />
        <FieldHelp issue={issue} description={description} />
      </label>
    );
  }

  if (field.type === "number" || field.type === "integer") {
    return (
      <label className="block">
        {commonLabel}
        <Input
          type="number"
          min={"minimum" in field ? field.minimum : undefined}
          max={"maximum" in field ? field.maximum : undefined}
          step={field.type === "integer" ? 1 : "any"}
          value={serializeFieldValue(field, value)}
          disabled={disabled}
          onChange={(event) => onChange(normalizeFieldValue(field, event.target.value))}
          className="border-white/10 bg-black/40 text-white"
        />
        <FieldHelp issue={issue} description={description} />
      </label>
    );
  }

  if (control === "textarea") {
    return (
      <label className="block md:col-span-2">
        {commonLabel}
        <Textarea
          value={serializeFieldValue(field, value)}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          rows={ui.rows ?? 4}
          className="min-h-20 rounded-md border-white/10 bg-black/40 text-xs text-white placeholder:text-zinc-600"
        />
        <FieldHelp issue={issue} description={description} />
      </label>
    );
  }

  return (
    <label className="block">
      {commonLabel}
      <Input
        value={serializeFieldValue(field, value)}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="border-white/10 bg-black/40 text-white"
      />
      <FieldHelp issue={issue} description={description} />
    </label>
  );
}

function QueuePanel({
  t,
  jobs,
  activeJobs,
  selectedJob,
  selectedModel,
  selectedPreset,
  onSelectJob,
  onCancel,
  onRetry,
}: {
  t: TFn;
  jobs: AiJobView[];
  activeJobs: AiJobView[];
  selectedJob: AiJobView | null;
  selectedModel: AiLabModel | null;
  selectedPreset: AiLabPreset | null;
  onSelectJob: (id: string) => void;
  onCancel: (job: AiJobView) => void;
  onRetry: (job: AiJobView) => void;
}) {
  return (
    <aside className="min-h-0 overflow-hidden rounded-xl border border-white/10 bg-zinc-950">
      <div className="border-b border-white/10 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white">{t("queue.title")}</h2>
            <p className="mt-1 text-xs text-zinc-500">{t("queue.subtitle")}</p>
          </div>
          <Badge tone={activeJobs.length > 0 ? "warning" : "muted"}>{activeJobs.length}</Badge>
        </div>
      </div>
      <div className="max-h-[calc(100dvh-220px)] overflow-y-auto p-3">
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <h3 className="text-xs font-semibold text-zinc-300">{t("queue.policy")}</h3>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Metric
              label={t("queue.running")}
              value={selectedPreset ? String(selectedPreset.queuePolicy.perUserRunning) : "-"}
            />
            <Metric
              label={t("queue.queued")}
              value={selectedPreset ? String(selectedPreset.queuePolicy.perUserQueued) : "-"}
            />
            <Metric
              label={t("queue.global")}
              value={selectedPreset ? String(selectedPreset.queuePolicy.globalConcurrency) : "-"}
            />
            <Metric label={t("queue.model")} value={selectedModel?.provider ?? "-"} />
          </div>
        </div>

        <div className="mt-3">
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold text-zinc-300">
            <IconPlayerPlay className="size-3.5" />
            {t("queue.active")}
          </h3>
          {activeJobs.length === 0 ? (
            <p className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-xs leading-5 text-zinc-500">
              {t("queue.emptyActive")}
            </p>
          ) : (
            <div className="space-y-2">
              {activeJobs.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  selected={job.id === selectedJob?.id}
                  t={t}
                  onSelect={onSelectJob}
                  onCancel={onCancel}
                  onRetry={onRetry}
                />
              ))}
            </div>
          )}
        </div>

        <div className="mt-4">
          <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold text-zinc-300">
            <IconHistory className="size-3.5" />
            {t("queue.history")}
          </h3>
          {jobs.length === 0 ? (
            <p className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-xs leading-5 text-zinc-500">
              {t("queue.emptyHistory")}
            </p>
          ) : (
            <div className="space-y-2">
              {jobs.slice(0, 18).map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  selected={job.id === selectedJob?.id}
                  t={t}
                  onSelect={onSelectJob}
                  onCancel={onCancel}
                  onRetry={onRetry}
                />
              ))}
            </div>
          )}
        </div>

        {selectedJob ? <JobDetail job={selectedJob} t={t} /> : null}
      </div>
    </aside>
  );
}

function JobRow({
  job,
  selected,
  t,
  onSelect,
  onCancel,
  onRetry,
}: {
  job: AiJobView;
  selected: boolean;
  t: TFn;
  onSelect: (id: string) => void;
  onCancel: (job: AiJobView) => void;
  onRetry: (job: AiJobView) => void;
}) {
  const terminal = TERMINAL_STATUSES.has(job.status);
  const failed = job.status === "failed";
  return (
    <div
      className={cn(
        "rounded-lg border bg-white/[0.03] p-3 transition-colors",
        selected ? "border-primary/60" : "border-white/10 hover:border-white/20"
      )}
    >
      <button type="button" className="block w-full text-left" onClick={() => onSelect(job.id)}>
        <div className="flex items-start justify-between gap-2">
          <p className="line-clamp-2 text-xs font-medium leading-5 text-zinc-200">
            {job.prompt || t("queue.untitled")}
          </p>
          <StatusIcon job={job} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge tone={job.status === "completed" ? "success" : failed ? "danger" : "muted"}>
            {stageLabel(job.stage, t)}
          </Badge>
          {job.queuePosition ? (
            <Badge tone="warning">{t("queue.position", { n: job.queuePosition })}</Badge>
          ) : null}
          {job.estimatedTotalSeconds ? (
            <Badge tone="muted">{formatSeconds(job.estimatedTotalSeconds)}</Badge>
          ) : null}
        </div>
        {!terminal ? (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.max(6, Math.min(100, job.progress ?? 14))}%` }}
            />
          </div>
        ) : null}
      </button>
      <div className="mt-2 flex items-center gap-2">
        {!terminal ? (
          <Button
            size="xs"
            variant="ghost"
            color="muted"
            onClick={() => onCancel(job)}
            icon={<IconPlayerPause className="size-3" />}
          >
            {t("action.cancel")}
          </Button>
        ) : null}
        {failed && job.error?.retryable ? (
          <Button
            size="xs"
            variant="ghost"
            color="primary"
            onClick={() => onRetry(job)}
            icon={<IconRefresh className="size-3" />}
          >
            {t("action.retry")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function JobDetail({ job, t }: { job: AiJobView; t: TFn }) {
  return (
    <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <h3 className="text-xs font-semibold text-zinc-300">{t("detail.title")}</h3>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Metric label={t("detail.id")} value={job.id} />
        <Metric label={t("detail.status")} value={stageLabel(job.stage, t)} />
        <Metric label={t("detail.model")} value={job.modelId} />
        <Metric label={t("detail.created")} value={formatTime(job.createdAt)} />
      </div>
      {job.error ? (
        <div className="mt-3 rounded-lg border border-red-500/25 bg-red-500/10 p-2">
          <div className="text-[11px] font-semibold text-red-100">{job.error.code}</div>
          <p className="mt-1 text-xs leading-5 text-red-50">{job.error.userMessage}</p>
        </div>
      ) : null}
      {job.logs?.length ? (
        <div className="mt-3 space-y-2">
          {job.logs.slice(-4).map((log) => (
            <div key={`${log.time}-${log.stage}`} className="border-l border-white/10 pl-2">
              <div className="text-[11px] text-zinc-500">{formatTime(log.time)}</div>
              <p className="text-xs leading-5 text-zinc-300">{log.message}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MediaPreview({ output, mode }: { output: AiJobOutput; mode: AiLabMode }) {
  if (mode === "video" || output.type === "video") {
    return (
      <video
        src={output.url}
        controls
        className="max-h-[620px] w-full max-w-4xl rounded-lg object-contain"
      />
    );
  }
  return (
    <img
      src={output.url}
      alt=""
      className="max-h-[620px] w-full max-w-4xl rounded-lg object-contain"
    />
  );
}

function ProgressPreview({ job, t }: { job: AiJobView; t: TFn }) {
  return (
    <div className="w-full max-w-sm text-center">
      <span className="mx-auto flex size-12 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
        <IconRefresh className="size-6 animate-spin text-primary" />
      </span>
      <h2 className="mt-4 text-base font-semibold text-white">{stageLabel(job.stage, t)}</h2>
      <p className="mt-2 line-clamp-3 text-sm leading-6 text-zinc-500">{job.prompt}</p>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${Math.max(6, Math.min(100, job.progress ?? 18))}%` }}
        />
      </div>
      {job.estimatedTotalSeconds ? (
        <p className="mt-2 text-xs text-zinc-500">{formatSeconds(job.estimatedTotalSeconds)}</p>
      ) : null}
    </div>
  );
}

function StatusIcon({ job }: { job: AiJobView }) {
  if (job.status === "completed") return <IconCircleCheck className="size-4 text-emerald-400" />;
  if (job.status === "failed") return <IconAlertTriangle className="size-4 text-red-400" />;
  if (job.status === "cancelled") return <IconPlayerPause className="size-4 text-zinc-500" />;
  return <IconRefresh className="size-4 animate-spin text-amber-300" />;
}

function FieldHelp({ issue, description }: { issue?: AiValidationIssue; description?: string }) {
  if (issue) return <p className="mt-1 text-[11px] leading-4 text-red-300">{issue.message}</p>;
  if (description) return <p className="mt-1 text-[11px] leading-4 text-zinc-600">{description}</p>;
  return null;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0 rounded-md bg-black/30 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-normal text-zinc-600">{label}</div>
      <div className="truncate text-xs font-medium text-zinc-200">{value}</div>
    </div>
  );
}

function StatusPill({
  icon,
  label,
  tone,
}: {
  icon: ReactNode;
  label: string;
  tone: "success" | "warning" | "danger" | "muted";
}) {
  return (
    <span
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium",
        toneClass(tone)
      )}
    >
      {icon}
      {label}
    </span>
  );
}

function Badge({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "success" | "warning" | "danger" | "muted";
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full border px-2 text-[10px] font-medium",
        toneClass(tone)
      )}
    >
      {children}
    </span>
  );
}

function RailEmpty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex min-h-36 flex-col items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] p-4 text-center text-xs leading-5 text-zinc-500">
      <span className="mb-2 text-zinc-500">{icon}</span>
      {text}
    </div>
  );
}

function toneClass(tone: "success" | "warning" | "danger" | "muted") {
  if (tone === "success") return "border-emerald-400/25 bg-emerald-400/10 text-emerald-200";
  if (tone === "warning") return "border-amber-400/25 bg-amber-400/10 text-amber-200";
  if (tone === "danger") return "border-red-400/25 bg-red-400/10 text-red-200";
  return "border-white/10 bg-white/[0.04] text-zinc-400";
}

function inferControl(field: AiLabField): string {
  if (field.type === "boolean") return "checkbox";
  if ("enum" in field && Array.isArray(field.enum)) return "segmented";
  if (field.type === "array") return "media_upload";
  if (field.type === "number" || field.type === "integer") return "stepper";
  return "text";
}

function jobOutputs(job: AiJobView): Array<{ job: AiJobView; output: AiJobOutput }> {
  return job.outputs.map((output) => ({ job, output }));
}

function makePreviewJob({
  response,
  model,
  preset,
  input,
}: {
  response: AiSubmitResponse;
  model: AiLabModel;
  preset: AiLabPreset;
  input: Record<string, unknown>;
}): AiJobView {
  const now = new Date().toISOString();
  return {
    id: response.request_id,
    request_id: response.request_id,
    type: model.type,
    workspaceId: response.workspace_id,
    projectId: response.project_id,
    documentId: response.document_id,
    documentBlockId: response.document_block_id,
    siteRegion: response.site_region,
    sourceSurface: response.source_surface,
    provider: model.provider,
    modelId: model.id,
    deployment: model.deployment,
    status: response.status,
    stage: response.stage,
    routing: {
      presetId: preset.id,
      strategy: preset.routeMode,
      quota: {
        mode: preset.billingPolicy.mode,
        cost: preset.billingPolicy.preflightCost,
        campaignId: preset.campaignId,
      },
    },
    queuePosition: response.queue_position,
    progress: response.progress,
    estimatedWaitSeconds: response.estimated_wait_seconds,
    estimatedRunSeconds: response.estimated_run_seconds,
    estimatedTotalSeconds: response.estimated_total_seconds,
    etaConfidence: response.eta_confidence,
    prompt: typeof input.prompt === "string" ? input.prompt : "",
    input,
    outputs: [],
    logs: response.logs,
    createdAt: now,
    updatedAt: now,
  };
}

function blockedReason({
  preset,
  model,
  currentPlanRank,
  t,
}: {
  preset: AiLabPreset | null;
  model: AiLabModel | null;
  currentPlanRank: number;
  t: TFn;
}): string | undefined {
  const requiredPlan = requiredPlanFor(preset, model);
  if (requiredPlan && planRank(requiredPlan) > currentPlanRank) {
    return t("error.requiresPlan", { plan: planLabel(requiredPlan, t) });
  }
  if (preset?.enabled === false) return preset.disabledReason ?? t("error.routeUnavailable");
  if (model?.enabled === false) return model.disabledReason ?? t("error.modelUnavailable");
  if (model?.access?.allowed === false) return t("error.accessDenied");
  return undefined;
}

function lockedOptionIssues({
  fields,
  values,
  currentPlanRank,
  t,
}: {
  fields: AiFieldDescriptor[];
  values: Record<string, unknown>;
  currentPlanRank: number;
  t: TFn;
}): AiValidationIssue[] {
  return fields.flatMap((field) => {
    const options = readOptions(field.field);
    if (options.length === 0) return [];
    const selected = options.find((option) => option.value === values[field.name]);
    if (!selected || !optionLocked(selected, currentPlanRank, planRank)) return [];
    return [
      {
        field: field.name,
        message: t("error.optionRequiresPlan", {
          label: fieldLabel(field.field, field.name),
          plan: planLabel(selected.requiredPlan, t),
        }),
      },
    ];
  });
}

function requiredPlanFor(preset: AiLabPreset | null, model: AiLabModel | null): string | null {
  return (
    preset?.requiredPlan ?? model?.access?.requiredPlan ?? model?.entitlement?.requiredPlan ?? null
  );
}

function planRank(plan: string | null | undefined): number {
  if (!plan) return 0;
  const ranks: Record<string, number> = {
    free: 0,
    basic: 10,
    standard: 20,
    pro: 30,
    team: 40,
  };
  return ranks[plan.trim().toLowerCase()] ?? Number.POSITIVE_INFINITY;
}

function planLabel(plan: string | null | undefined, t?: TFn): string {
  const normalized = plan?.trim().toLowerCase() || "free";
  const translated = t?.(`plan.${normalized}`);
  if (translated && translated !== `aiLab.plan.${normalized}`) return translated;
  if (normalized === "free") return "Free";
  if (normalized === "basic") return "Basic";
  if (normalized === "standard") return "Standard";
  if (normalized === "pro") return "Pro";
  if (normalized === "team") return "Team";
  return normalized;
}

function formatCost(preset: AiLabPreset | null | undefined, t?: TFn): string {
  if (!preset) return "-";
  if (preset.billingPolicy.mode === "free") return t?.("cost.free") ?? "Free";
  const cost = preset.billingPolicy.preflightCost;
  if (cost === undefined || cost === null) return t?.("cost.metered") ?? "Metered";
  return `${cost} ${preset.billingPolicy.displayCurrency}`;
}

function stageLabel(stage: string, t: TFn): string {
  const value = t(`stage.${stage}`);
  return value === `aiLab.stage.${stage}` ? stage : value;
}

function modeLabel(mode: string, t?: TFn): string {
  const translated = t?.(`generationMode.${mode}`);
  if (translated && translated !== `aiLab.generationMode.${mode}`) return translated;
  return mode.replace(/_/g, " ");
}

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

type TFn = (key: string, params?: Record<string, string | number | Date>) => string;
