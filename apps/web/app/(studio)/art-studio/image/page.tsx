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
import { GalleryGrid, type GalleryItem } from "./_components/gallery-grid";

type ModelSource = "loading" | "live" | "preview";
type TopTab = "history" | "community" | "tutorial";

const MOCK_RESULT_IMAGE =
  "https://images.unsplash.com/photo-1604079628040-94301bb21b91?auto=format&fit=crop&w=1400&q=86";

const HISTORY_LIMIT = 60;

export default function AiImageLabPage() {
  const rawT = useTranslations("aiGen");
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [activeTab, setActiveTab] = useState<TopTab>("history");

  const itemsRef = useRef(items);
  itemsRef.current = items;

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
          return;
        }
        setModelSource("preview");
      } catch (error) {
        if (cancelled) return;
        if (process.env.NODE_ENV !== "production") {
          console.warn("[ai-gen] Falling back to local image schema preview.", error);
        }
        setModelSource("preview");
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
  }, []);

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

      const status = job.status.toUpperCase();
      if (status === "COMPLETED" && job.outputs.length > 0) {
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
      if (status === "FAILED" || status === "CANCELLED") {
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
        // First `connected` is the initial handshake — history was
        // already loaded by the bootstrap effect. Any subsequent
        // connected fires after a network drop / token refresh, and
        // we may have missed events in between, so reconcile.
        if (hasConnectedBefore) void reconcileFromServer();
        hasConnectedBefore = true;
      },
      onEvent: handleAssetEvent,
      onDisconnected: (reason) => console.log(`[assets-realtime] disconnected: ${reason}`),
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
  const sizeOptions = useMemo(() => {
    const sizeField = model.input_schema.properties.size;
    const ui = sizeField && typeof sizeField === "object" ? (sizeField as any)["x-ui"] : null;
    const rawOptions: Array<{ value: string; label: string }> =
      ui && Array.isArray(ui.options) ? ui.options : [];
    return rawOptions.map((opt) => ({
      value: opt.value,
      label: opt.label,
      ratio: extractRatio(opt.label, opt.value),
    }));
  }, [model]);

  const sizeValue = typeof formData.size === "string" ? formData.size : "auto";
  const outputs = typeof formData.n === "number" ? formData.n : 1;

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
    return enumVals.filter((v) => v !== "auto").map((v) => ({ value: v, label: v }));
  }, [model]);
  const qualityValue = typeof formData.quality === "string" ? formData.quality : "low";

  const canSubmit =
    prompt.trim().length > 0 && !isSubmitting && model.enabled && modelSource !== "loading";

  // ─── Submit ──────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    const promptText = prompt.trim();
    const tempId = `temp:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const activeSize = sizeOptions.find((o) => o.value === sizeValue);
    const ratio = activeSize?.ratio ?? "1:1";
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
    sizeOptions,
    sizeValue,
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
      if (modelSource === "preview" || !id.match(/^[0-9a-f-]{20,}$/i)) {
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
        };
        replaceItem(id, [requeued]);
      } catch (error) {
        // Leave the error card in place — user can try again.
      }
    },
    [items, modelSource, replaceItem]
  );

  // ─── Render ───────────────────────────────────────────────────
  return (
    <div className="relative flex h-[calc(100dvh-56px)] flex-col overflow-hidden bg-black text-foreground lg:pl-20">
      {/* Top tabs */}
      <header className="shrink-0 px-4 pb-2 pt-4 md:px-6">
        <div className="flex items-center gap-1">
          {(["history", "community", "tutorial"] as const).map((tab) => {
            const isActive = tab === activeTab;
            const disabled = tab !== "history";
            return (
              <button
                key={tab}
                type="button"
                disabled={disabled}
                onClick={() => setActiveTab(tab)}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                  isActive ? "bg-zinc-900 text-foreground" : "text-zinc-500 hover:text-zinc-200"
                } disabled:cursor-not-allowed disabled:hover:text-zinc-500`}
              >
                {t(`imageLab.tab.${tab}`, tab[0].toUpperCase() + tab.slice(1))}
              </button>
            );
          })}
        </div>
      </header>

      {/* Canvas */}
      <main className="min-h-0 flex-1 overflow-y-auto px-2 pb-40 md:px-4">
        {activeTab === "history" && items.length > 0 && (
          <GalleryGrid items={items} onRetry={handleRetry} t={t} />
        )}
        {activeTab === "history" && items.length === 0 && (
          <EmptyState t={t} onTry={(text) => setPrompt(text)} modelName={model.name} />
        )}
        {activeTab !== "history" && (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-zinc-500">
            {t("imageLab.tab.placeholder", "Coming soon.")}
          </div>
        )}
      </main>

      {/* Fixed compose bar */}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-3 lg:left-20">
        <div className="pointer-events-auto w-full max-w-3xl">
          <ComposeBar
            prompt={prompt}
            onPromptChange={setPrompt}
            model={model}
            models={availableModels}
            onModelChange={(next) => {
              setModel(next);
              setFormData(deriveDefaults(next.input_schema.properties));
            }}
            sizeValue={sizeValue}
            sizeOptions={sizeOptions}
            onSizeChange={(v) => setFormData((prev) => ({ ...prev, size: v }))}
            qualityValue={qualityValue}
            qualityOptions={qualityOptions}
            onQualityChange={(v) => setFormData((prev) => ({ ...prev, quality: v }))}
            outputs={outputs}
            onOutputsChange={(n) => setFormData((prev) => ({ ...prev, n }))}
            canSubmit={canSubmit}
            isSubmitting={isSubmitting}
            onSubmit={handleSubmit}
            disabled={modelSource === "loading"}
            t={t}
          />
        </div>
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

function jobToItems(job: AiJobView): GalleryItem[] {
  const promptText =
    job.prompt ?? (typeof job.input?.prompt === "string" ? (job.input.prompt as string) : "");
  const inputSize = typeof job.input?.size === "string" ? (job.input.size as string) : "auto";
  const ratio = ratioFromSize(inputSize);
  const createdAt = job.completedAt
    ? new Date(job.completedAt).getTime()
    : new Date(job.createdAt).getTime();

  if (job.status === "completed" && job.outputs.length > 0) {
    return job.outputs.map((out) => ({
      id: out.id,
      kind: "done",
      url: out.url,
      prompt: promptText,
      ratio: out.width && out.height ? `${out.width}:${out.height}` : ratio,
      createdAt,
    }));
  }
  if (job.status === "failed" || job.status === "cancelled") {
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
    },
  ];
}

function inferRatio(job: AiJobUpdatePayload, knownItems: GalleryItem[]): string {
  // 1. First output's actual dimensions (most reliable when done)
  const out = job.outputs[0];
  if (out?.width && out?.height) return `${out.width}:${out.height}`;
  // 2. Whatever ratio the queued cell already has (set when submitted
  //    locally; preserves the user's chosen aspect ratio through the
  //    queued → done transition)
  const existing = knownItems.find((it) => it.id === job.id);
  if (existing?.ratio) return existing.ratio;
  // 3. Fallback — square
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

function extractRatio(label: string, value: string): string {
  // Labels look like "1024 × 1024  · 1:1" — pick the segment after "·".
  const sep = label.split("·").pop()?.trim();
  if (sep && /^\d/.test(sep)) return sep;
  return ratioFromSize(value);
}

function friendlyError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message.trim() : "";
  if (!message) return fallback;
  if (/<!doctype html|<html|page not found|not-found|HTTP_404/i.test(message)) return fallback;
  if (message.length > 220) return fallback;
  return message;
}
