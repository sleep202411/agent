"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconSparkles } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import type { AssetEvent, AiJobUpdatePayload } from "@repo/shared";
import { MOCK_AI_MODEL, type AiModel } from "./_data/mock-model";
import {
  listAiJobs,
  listAiModels,
  retryAiJob,
  submitAiJob,
  type AiJobView,
} from "./_data/ai-generation-client";
import { openAssetsRealtime } from "./_data/assets-realtime";
import { ComposeBar } from "./_components/compose-bar";
import { QuotaBadge } from "@/components/quota/quota-badge";
import { QuotaProvider } from "@/src/lib/quota/quota-provider";
import { UpgradeDialogHost } from "@/components/quota/upgrade-dialog";
import { GalleryGrid, type GalleryItem } from "./_components/gallery-grid";
import { useFeature } from "@/src/lib/region/provider";
import { useCurrentUser } from "@/src/hooks/use-user";

type ModelSource = "loading" | "live" | "preview" | "unavailable";

const MOCK_RESULT_IMAGE =
  "https://images.unsplash.com/photo-1604079628040-94301bb21b91?auto=format&fit=crop&w=1400&q=86";

const HISTORY_LIMIT = 60;
const ALLOW_LOCAL_PREVIEW = process.env.NODE_ENV !== "production";

export default function AiImageLabPage() {
  const rawT = useTranslations("aiGen");
  const { user } = useCurrentUser();
  const t = useCallback(
    (key: string, fallback = key) => {
      const normalized = key.replace(/^aiGen\./, "");
      const value = rawT(normalized);
      return value === `aiGen.${normalized}` ? fallback : value;
    },
    [rawT]
  );

  const [model, setModel] = useState<AiModel>(MOCK_AI_MODEL);
  const [availableModels, setAvailableModels] = useState<AiModel[]>([MOCK_AI_MODEL]);
  const [modelSource, setModelSource] = useState<ModelSource>("loading");
  const [formData, setFormData] = useState<Record<string, unknown>>(() =>
    deriveDefaults(MOCK_AI_MODEL.input_schema.properties)
  );
  const [prompt, setPrompt] = useState("");
  // Bumped whenever the prompt is refilled by an external action (a
  // gallery cell click). ComposeBar watches the token and focuses the
  // textarea + scrolls into view when it changes, so the user lands
  // ready to edit instead of having to click into the bar manually.
  const [promptFocusToken, setPromptFocusToken] = useState(0);
  const refillPrompt = useCallback((text: string) => {
    setPrompt(text);
    setPromptFocusToken((n) => n + 1);
  }, []);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [modelLoadError, setModelLoadError] = useState<string | null>(null);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const itemsRef = useRef(items);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // ─── Model + history bootstrap ────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function loadModels() {
      try {
        const models = await listAiModels();
        if (cancelled) return;
        const imageModels = models.filter((m) => m.type === "image");
        if (imageModels.length > 0) setAvailableModels(imageModels);
        const picked = imageModels.find((m) => m.id.includes("gpt-image-2")) ?? imageModels[0];
        if (picked) {
          setModel(picked);
          setFormData(deriveDefaults(picked.input_schema.properties));
          setModelSource("live");
          setModelLoadError(null);
          return;
        }
        if (ALLOW_LOCAL_PREVIEW) {
          setModelSource("preview");
        } else {
          setModelLoadError(t("imageLab.error.noModels", "No image model is available."));
          setModelSource("unavailable");
        }
      } catch (error) {
        if (cancelled) return;
        if (process.env.NODE_ENV !== "production") {
          console.warn("[ai-gen] Falling back to local image schema preview.", error);
        }
        if (ALLOW_LOCAL_PREVIEW) {
          setModelSource("preview");
        } else {
          setModelLoadError(
            friendlyError(error, t("imageLab.error.loadModels", "Failed to load image models."))
          );
          setModelSource("unavailable");
        }
      }
    }

    async function loadHistory() {
      try {
        const jobs = await listAiJobs({ type: "image", limit: HISTORY_LIMIT });
        if (cancelled) return;
        setItems(jobs.flatMap(jobToItems));
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[ai-gen] Could not load history.", error);
        }
      }
    }

    void loadModels();
    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [t]);

  // ─── Reconciliation ──────────────────────────────────────────
  // "Push first, poll as safety net" — Web PubSub is the primary
  // signal, but it's not durable. After a reconnect or after the tab
  // wakes from background, the server may have shipped events we
  // missed. Re-fetch history and merge in by id; preserve optimistic
  // `temp:*` cards that haven't been ack'd by the server yet.
  const reconcileFromServer = useCallback(async () => {
    try {
      const jobs = await listAiJobs({ type: "image", limit: HISTORY_LIMIT });
      const serverItems = jobs.flatMap(jobToItems);
      const serverIds = new Set(serverItems.map((it) => it.id));
      setItems((prev) => {
        const pending = prev.filter((it) => it.id.startsWith("temp:") && !serverIds.has(it.id));
        // Server is authoritative for any non-temp id; freshly-clicked
        // optimistic cards still in flight survive on top.
        return [...pending, ...serverItems];
      });
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[ai-gen] reconcile failed", error);
      }
    }
  }, []);

  // ─── Realtime push subscription ───────────────────────────────
  // One Azure Web PubSub connection per page mount. Server pushes
  // `ai_job_update` events to `assets-user:{userId}`; we map
  // each push into the gallery cell with matching job id.
  const replaceItem = useCallback((oldId: string, replacements: GalleryItem[]) => {
    setItems((prev) => {
      const next: GalleryItem[] = [];
      let replaced = false;
      for (const it of prev) {
        if (it.id === oldId) {
          if (!replaced) {
            next.push(...replacements);
            replaced = true;
          }
        } else {
          next.push(it);
        }
      }
      return next;
    });
  }, []);

  const handleAssetEvent = useCallback(
    (event: AssetEvent) => {
      if (event.kind !== "ai_job_update") return;
      const job = event.job;
      const ratio = inferRatio(job, itemsRef.current);
      const promptText = job.prompt;

      const status = job.status.toLowerCase();
      if (status === "completed" && job.outputs.length > 0) {
        const dones: GalleryItem[] = job.outputs.map((out) => ({
          id: out.id,
          kind: "done",
          url: out.url,
          prompt: promptText,
          ratio: out.width && out.height ? `${out.width}:${out.height}` : ratio,
          createdAt: new Date(out.createdAt).getTime(),
        }));
        replaceItem(job.id, dones);
        return;
      }
      if (status === "failed" || status === "cancelled") {
        replaceItem(job.id, [
          {
            id: job.id,
            kind: "error",
            prompt: promptText,
            ratio,
            createdAt: Date.now(),
            message: job.error?.userMessage ?? t("imageLab.error.failed", "Generation failed."),
          },
        ]);
        return;
      }
      // queued / running / uploading — update existing cell or insert
      // if it's brand-new (a job submitted from another tab).
      setItems((prev) => {
        const idx = prev.findIndex((it) => it.id === job.id);
        if (idx >= 0) {
          const cur = prev[idx];
          if (cur.kind !== "queued") return prev;
          const next = [...prev];
          next[idx] = {
            ...cur,
            stage: job.stage,
            queuePosition: job.queuePosition,
            progress: job.progress,
            etaSeconds: job.estimatedTotalSeconds,
          };
          return next;
        }
        const fresh: GalleryItem = {
          id: job.id,
          kind: "queued",
          prompt: promptText,
          ratio,
          createdAt: Date.now(),
          stage: job.stage,
          queuePosition: job.queuePosition,
          progress: job.progress,
          etaSeconds: job.estimatedTotalSeconds,
        };
        return [fresh, ...prev];
      });
    },
    [replaceItem, t]
  );

  useEffect(() => {
    let hasConnectedBefore = false;
    const client = openAssetsRealtime({
      onConnected: () => {
        setRealtimeConnected(true);
        // First `connected` is the initial handshake — history was
        // already loaded by the bootstrap effect. Any subsequent
        // connected fires after a network drop / token refresh, and
        // we may have missed events in between, so reconcile.
        if (hasConnectedBefore) void reconcileFromServer();
        hasConnectedBefore = true;
      },
      onEvent: handleAssetEvent,
      onDisconnected: (reason) => {
        setRealtimeConnected(false);
        if (process.env.NODE_ENV !== "production") {
          console.log(`[assets-realtime] disconnected: ${reason}`);
        }
      },
    });
    return () => client.close();
  }, [handleAssetEvent, reconcileFromServer]);

  // Tab returns from background — events may have piled up during
  // throttled-tab time even with the WS still nominally open.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void reconcileFromServer();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reconcileFromServer]);

  // ─── Compose bar wiring ───────────────────────────────────────
  // Pull option lists straight from the schema's `x-ui.options`.
  // The schema is the source of truth for both label *and* tier
  // gating — server's `assertCanUseOptions` reads the same field.
  const aspectRatioOptions = useMemo(
    () => readOptions(model.input_schema.properties.aspect_ratio),
    [model]
  );
  const resolutionTierOptions = useMemo(
    () => readOptions(model.input_schema.properties.resolution_tier),
    [model]
  );
  const aspectRatioValue =
    typeof formData.aspect_ratio === "string" ? formData.aspect_ratio : "1:1";
  const resolutionTierValue =
    typeof formData.resolution_tier === "string" ? formData.resolution_tier : "hd";

  const outputs = typeof formData.n === "number" ? formData.n : 1;
  // Flat segmented buttons for output count — schema allows 1-10 but
  // ≥4 outputs balloons cost; cap UI at 4 (matches PoseAI).
  const outputOptions = useMemo(() => [1, 2, 3, 4], []);

  // Quality: gpt-image-2 enum is auto/low/medium/high. We hide `auto`
  // because that path is chronically EngineOverloaded on Azure's
  // preview pool — leaving it as a clickable option would lead users
  // straight into the failure mode we worked around with the `low`
  // default. Re-add when Azure GAs gpt-image-2.
  const qualityOptions = useMemo(() => {
    const qf = model.input_schema.properties.quality;
    const enumVals =
      qf && typeof qf === "object" && Array.isArray((qf as { enum?: unknown[] }).enum)
        ? ((qf as { enum: string[] }).enum as string[])
        : [];
    return enumVals.filter((v) => v !== "auto").map((v) => ({ value: v, label: v, tier: null }));
  }, [model]);
  const qualityValue = typeof formData.quality === "string" ? formData.quality : "low";

  // In-flight jobs on this model — drives the "in queue / generating"
  // badge on the model chip and disables the submit button. We allow
  // only one concurrent generation per user; a queued/running card in
  // `items` is either an unacknowledged optimistic submit (`temp:*`)
  // or a real server-side job that hasn't completed yet.
  const activeJobs = useMemo(() => items.filter((it) => it.kind === "queued"), [items]);
  const activeJobCount = activeJobs.length;
  // "排队中" only when the active job is truly waiting for a worker
  // slot. Once the worker picks it up (any stage beyond `queued`),
  // surface "生成中" so users with a 1-user dev queue don't see a
  // misleading "queued" label for the whole 50 s run.
  const isAnyJobRunning = activeJobs.some(
    (it) => it.stage && it.stage !== "queued" && it.stage !== "created"
  );

  // Active jobs get a REST reconciliation heartbeat. Web PubSub is still
  // the fast path, but this makes "push first, poll as safety net" true
  // even when the realtime connection is down for the whole run.
  useEffect(() => {
    if (activeJobCount === 0) return;
    const intervalMs = realtimeConnected ? 15_000 : 5_000;
    const timer = window.setInterval(() => {
      void reconcileFromServer();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [activeJobCount, realtimeConnected, reconcileFromServer]);

  const userPlanRank = useMemo(() => planRank(user?.userLevel), [user?.userLevel]);

  const canSubmit =
    prompt.trim().length > 0 &&
    !isSubmitting &&
    model.enabled &&
    (modelSource === "live" || modelSource === "preview") &&
    activeJobCount === 0;

  // ─── Submit ──────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    const promptText = prompt.trim();
    const tempId = `temp:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ratio = aspectRatioValue;
    const count = Math.max(1, outputs);

    // Optimistic — single queued card with ×N badge. When the job
    // completes, the card expands into N final cells.
    const optimisticItem: GalleryItem = {
      id: tempId,
      kind: "queued",
      prompt: promptText,
      ratio,
      createdAt: Date.now(),
      count,
      stage: "queued",
    };
    setItems((prev) => [optimisticItem, ...prev]);
    setPrompt("");
    setIsSubmitting(true);

    try {
      if (modelSource === "preview") {
        // Simulate a queued → running → done transition so the cell
        // visibly cycles through states even in preview mode.
        window.setTimeout(() => {
          setItems((prev) =>
            prev.map((it) =>
              it.id === tempId && it.kind === "queued" ? { ...it, stage: "running" } : it
            )
          );
        }, 350);
        window.setTimeout(() => {
          const dones: GalleryItem[] = Array.from({ length: count }, (_, i) => ({
            id: `${tempId}#${i}-done`,
            kind: "done",
            url: MOCK_RESULT_IMAGE,
            prompt: promptText,
            ratio,
            createdAt: Date.now(),
          }));
          replaceItem(tempId, dones);
          setIsSubmitting(false);
        }, 1400);
        return;
      }

      const values = { ...formData, prompt: promptText };
      const response = await submitAiJob({
        modelId: model.id,
        schemaVersion: model.schemaVersion,
        values,
        idempotencyKey: crypto.randomUUID(),
      });

      // Re-key the optimistic card with the real job id and seed
      // status from the submit response. Subsequent status changes
      // arrive as `ai_job_update` pushes via assets-realtime.
      setItems((prev) =>
        prev.map((it) =>
          it.id === tempId && it.kind === "queued"
            ? {
                ...it,
                id: response.request_id,
                stage: response.stage,
                queuePosition: response.queue_position,
                progress: response.progress,
                etaSeconds: response.estimated_total_seconds,
              }
            : it
        )
      );
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code: unknown }).code)
          : "";
      const message =
        code === "MEMBERSHIP_REQUIRED" || code === "MEMBERSHIP_EXPIRED"
          ? t(
              code === "MEMBERSHIP_EXPIRED"
                ? "imageLab.error.membershipExpired"
                : "imageLab.error.membershipRequired",
              code === "MEMBERSHIP_EXPIRED"
                ? "Your membership has expired. Renew to keep generating."
                : "This model is for members only. Upgrade to unlock."
            )
          : friendlyError(
              error,
              t("imageLab.error.submitFailed", "Failed to submit generation task.")
            );
      replaceItem(tempId, [
        {
          id: tempId,
          kind: "error",
          prompt: promptText,
          ratio,
          message,
          createdAt: Date.now(),
        },
      ]);
    } finally {
      if (modelSource !== "preview") setIsSubmitting(false);
    }
  }, [
    canSubmit,
    prompt,
    aspectRatioValue,
    outputs,
    modelSource,
    formData,
    model.id,
    model.schemaVersion,
    replaceItem,
    t,
  ]);

  const handleRetry = useCallback(
    async (id: string) => {
      const original = items.find((it) => it.id === id);
      if (!original || original.kind !== "error") return;
      if (modelSource === "preview" || id.startsWith("temp:")) {
        // Local error — just resubmit with the same prompt/ratio
        setPrompt(original.prompt);
        return;
      }
      try {
        const response = await retryAiJob(id);
        const requeued: GalleryItem = {
          id: response.request_id,
          kind: "queued",
          prompt: original.prompt,
          ratio: original.ratio,
          createdAt: Date.now(),
          stage: response.stage,
          queuePosition: response.queue_position,
          progress: response.progress,
          etaSeconds: response.estimated_total_seconds,
        };
        replaceItem(id, [requeued]);
      } catch (error) {
        replaceItem(id, [
          {
            ...original,
            message: friendlyError(error, t("imageLab.error.retryFailed", "Failed to retry task.")),
            createdAt: Date.now(),
          },
        ]);
      }
    },
    [items, modelSource, replaceItem, t]
  );

  // ─── Region gate ──────────────────────────────────────────────
  // Image generation is bound to Azure Foundry (eastus2) — see
  // features.ts. On cn the route still mounts (sidebar entry is
  // hidden, but direct navigation / shared links land here); render
  // an unavailable card instead of letting the lab fail at submit
  // time.
  const imageGenAvailable = useFeature("imageGeneration");
  if (!imageGenAvailable) {
    return <UnavailableInRegion t={t} />;
  }
  if (modelSource === "unavailable") {
    return <UnavailableInRegion t={t} detail={modelLoadError} />;
  }

  // ─── Render ───────────────────────────────────────────────────
  return (
    // QuotaProvider lives at the page boundary, NOT in the app shell —
    // chat / workflow / profile pages don't need it and shouldn't
    // share its WS + GET /aurora/quota chatter. UpgradeDialogHost is
    // co-located so 429s from submitAiJob (which emit via the upgrade
    // store) only open the dialog when the user is actually on this
    // page. Gated on `user` so anonymous visits skip the WS entirely.
    <QuotaProvider enabled={Boolean(user)}>
      <UpgradeDialogHost />
      <div className="relative flex h-[calc(100dvh-56px)] flex-col overflow-hidden bg-black text-foreground lg:pl-20">
        {/* Canvas — the scrollable content keeps a `pb-28` runway so the
          last row can scroll past the fixed compose bar instead of
          being permanently hidden underneath it. The bar itself
          overlays this area with a soft blur. */}
        <main className="min-h-0 flex-1 overflow-y-auto px-2 pb-28 pt-4 md:px-4">
          {items.length > 0 ? (
            <GalleryGrid items={items} onRetry={handleRetry} onReusePrompt={refillPrompt} t={t} />
          ) : (
            <EmptyState t={t} onTry={refillPrompt} modelName={model.name} />
          )}
        </main>

        {/* Fixed compose bar */}
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-3 lg:left-20">
          <div className="pointer-events-auto w-full max-w-3xl">
            {/* Inline quota chip — shows daily image used/limit so users
              see the cap BEFORE they submit and hit a 429. VIP3 renders
              an ∞ badge instead; loading state is a quiet shimmer. */}
            <div className="mb-1.5 flex justify-end px-1">
              <QuotaBadge dimension="image" />
            </div>
            <ComposeBar
              prompt={prompt}
              onPromptChange={setPrompt}
              model={model}
              models={availableModels}
              onModelChange={(next) => {
                setModel(next);
                setFormData(deriveDefaults(next.input_schema.properties));
              }}
              aspectRatioValue={aspectRatioValue}
              aspectRatioOptions={aspectRatioOptions}
              onAspectRatioChange={(v) => setFormData((prev) => ({ ...prev, aspect_ratio: v }))}
              resolutionTierValue={resolutionTierValue}
              resolutionTierOptions={resolutionTierOptions}
              onResolutionTierChange={(v) =>
                setFormData((prev) => ({ ...prev, resolution_tier: v }))
              }
              qualityValue={qualityValue}
              qualityOptions={qualityOptions}
              onQualityChange={(v) => setFormData((prev) => ({ ...prev, quality: v }))}
              outputs={outputs}
              outputOptions={outputOptions}
              onOutputsChange={(n) => setFormData((prev) => ({ ...prev, n }))}
              formData={formData}
              onFieldChange={(name, value) => setFormData((prev) => ({ ...prev, [name]: value }))}
              userPlanRank={userPlanRank}
              planRank={planRank}
              activeJobCount={activeJobCount}
              activeJobRunning={isAnyJobRunning}
              canSubmit={canSubmit}
              isSubmitting={isSubmitting}
              onSubmit={handleSubmit}
              disabled={modelSource === "loading"}
              focusToken={promptFocusToken}
              t={t}
            />
          </div>
        </div>
      </div>
    </QuotaProvider>
  );
}

function UnavailableInRegion({
  t,
  detail,
}: {
  t: (key: string, fallback?: string) => string;
  detail?: string | null;
}) {
  return (
    <div className="flex h-[calc(100dvh-56px)] items-center justify-center bg-black px-6 text-foreground lg:pl-20">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
          <IconSparkles className="size-6" />
        </span>
        <h2 className="text-lg font-semibold">
          {t("imageLab.unavailable.title", "Image lab isn't available in your region")}
        </h2>
        <p className="text-sm text-zinc-500">
          {t(
            "imageLab.unavailable.body",
            "Image generation runs on infrastructure that isn't deployed for this site yet. Stay tuned — coming soon."
          )}
        </p>
        {detail && <p className="text-xs text-zinc-600">{detail}</p>}
      </div>
    </div>
  );
}

function EmptyState({
  t,
  onTry,
  modelName,
}: {
  t: (key: string, fallback?: string) => string;
  onTry: (text: string) => void;
  modelName: string;
}) {
  const examples = [
    t(
      "imageLab.example.one",
      "A tiny dragon mascot reading a book in a cozy library, soft golden light, studio illustration"
    ),
    t(
      "imageLab.example.two",
      "Top-down shot of a desk covered in colorful sticky notes, pastel palette, isometric perspective"
    ),
    t(
      "imageLab.example.three",
      "A windswept lighthouse on a cliff at dusk, dramatic clouds, cinematic photography"
    ),
  ];
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 px-6 py-16 text-center">
      <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <IconSparkles className="size-6" />
      </span>
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">
          {t("imageLab.empty.title", "Your gallery is empty")}
        </h2>
        <p className="text-sm text-zinc-500">
          {t("imageLab.empty.subtitle", "Try one of these to see {model} in action.").replace(
            "{model}",
            modelName
          )}
        </p>
      </div>
      <div className="grid w-full gap-2">
        {examples.map((text) => (
          <button
            key={text}
            type="button"
            onClick={() => onTry(text)}
            className="rounded-xl bg-zinc-900 px-4 py-3 text-left text-sm leading-5 text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-foreground"
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function deriveDefaults(
  properties: Record<string, { default?: unknown }>
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(properties)) {
    if (field.default !== undefined) output[name] = field.default;
  }
  return output;
}

// Pull `x-ui.options` off a schema field into the `{value,label,requiredPlan}`
// shape ComposeBar expects. Returns [] for fields without options so
// callers can render nothing without an extra null check.
function readOptions(
  field: unknown
): Array<{ value: string; label: string; requiredPlan?: string | null }> {
  if (!field || typeof field !== "object") return [];
  const ui = (field as { "x-ui"?: { options?: unknown } })["x-ui"];
  const opts = ui?.options;
  if (!Array.isArray(opts)) return [];
  return opts
    .filter((o): o is { value: string; label?: string; requiredPlan?: string | null } => {
      if (o == null || typeof o !== "object") return false;
      return typeof (o as { value?: unknown }).value === "string";
    })
    .map((o) => ({
      value: o.value,
      label: o.label ?? o.value,
      requiredPlan: o.requiredPlan ?? null,
    }));
}

// Product entitlement rank. Auth still comes from the existing account
// payload, so this page adapts that claim into the new AI model protocol.
const PLAN_RANK: Record<string, number> = {
  FREE: 0,
  CREATOR: 1,
  PRO: 2,
  STUDIO: 3,
  ENTERPRISE: 4,
  VIP1: 1,
  VIP2: 2,
  VIP3: 3,
};
function planRank(level: string | null | undefined): number {
  if (!level) return 0;
  return PLAN_RANK[level.toUpperCase()] ?? 0;
}

function jobToItems(job: AiJobView): GalleryItem[] {
  const promptText =
    job.prompt ?? (typeof job.input?.prompt === "string" ? (job.input.prompt as string) : "");
  // New schema: ratio is in input.aspect_ratio. Old jobs (input.size)
  // still need to render until they age out of history.
  const inputRatio =
    typeof job.input?.aspect_ratio === "string" ? (job.input.aspect_ratio as string) : undefined;
  const inputSize = typeof job.input?.size === "string" ? (job.input.size as string) : "auto";
  const ratio = inputRatio ?? ratioFromSize(inputSize);
  const createdAt = job.completedAt
    ? new Date(job.completedAt).getTime()
    : new Date(job.createdAt).getTime();

  // AiJobStatus is lowercase snake_case on the wire — lowercase once
  // defensively in case a future caller passes mixed case.
  const status = job.status.toLowerCase();
  if (status === "completed" && job.outputs.length > 0) {
    return job.outputs.map((out) => ({
      id: out.id,
      kind: "done",
      url: out.url,
      prompt: promptText,
      ratio: out.width && out.height ? `${out.width}:${out.height}` : ratio,
      createdAt,
    }));
  }
  if (status === "failed" || status === "cancelled") {
    return [
      {
        id: job.id,
        kind: "error",
        prompt: promptText,
        ratio,
        createdAt,
        message: job.error?.userMessage ?? "Generation failed.",
      },
    ];
  }
  return [
    {
      id: job.id,
      kind: "queued",
      prompt: promptText,
      ratio,
      createdAt,
      stage: job.stage,
      queuePosition: job.queuePosition,
      progress: job.progress,
      etaSeconds: job.estimatedTotalSeconds,
    },
  ];
}

function inferRatio(job: AiJobUpdatePayload, knownItems: GalleryItem[]): string {
  // 1. First output's actual dimensions (most reliable when done)
  const out = job.outputs[0];
  if (out?.width && out?.height) return `${out.width}:${out.height}`;
  // 2. Submitted aspect ratio carried in the event payload (handles
  //    reload-during-flight where there's no existing local card)
  const inputRatio =
    typeof job.input?.aspect_ratio === "string" ? (job.input.aspect_ratio as string) : undefined;
  if (inputRatio) return inputRatio;
  // 3. Whatever ratio the queued cell already has (set when submitted
  //    locally; preserves the user's chosen aspect ratio through the
  //    queued → done transition)
  const existing = knownItems.find((it) => it.id === job.id);
  if (existing?.ratio) return existing.ratio;
  // 4. Fallback — square
  return "1:1";
}

function ratioFromSize(size: string): string {
  if (!size || size === "auto") return "1:1";
  const match = size.match(/^(\d+)x(\d+)$/i);
  if (!match) return "1:1";
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (!w || !h) return "1:1";
  return `${w}:${h}`;
}

function friendlyError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message.trim() : "";
  if (!message) return fallback;
  if (/<!doctype html|<html|page not found|not-found|HTTP_404/i.test(message)) return fallback;
  if (message.length > 220) return fallback;
  return message;
}
