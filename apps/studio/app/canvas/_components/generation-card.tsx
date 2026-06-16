"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useStore, type Node, type NodeProps } from "@xyflow/react";
import {
  IconAdjustments,
  IconAlertTriangle,
  IconArrowsMaximize,
  IconArrowUp,
  IconBolt,
  IconChevronDown,
  IconDownload,
  IconLoader2,
  IconPencil,
  IconBulb,
  IconPhoto,
  IconRefresh,
  IconScissors,
  IconVideo,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { ReactCompareSlider } from "react-compare-slider";
import { cn } from "@/lib/utils";
import { isUploadAbort, uploadFileViaSignedUrl } from "@/lib/media-upload";
import { useDismiss } from "@/lib/use-dismiss";
import { useAiCatalog, usableModelsByModality } from "@/app/canvas/_lib/use-ai-catalog";
import { useGeneration } from "@/app/canvas/_lib/use-canvas-generation";
import {
  OperationConfirmBar,
  PANORAMA_OP,
  RELIGHT_OP,
  REMOVE_BG_OP,
  UPSCALE_OP,
  useSpawnComposedOperation,
  type OperationDef,
} from "./operation-confirm-bar";
import { useCanvasGraphContext } from "@/lib/collab/canvas-graph-context";
import {
  defaultMode,
  defaultSettingsForModel,
  estimateModelSellPoints,
  hasSchemaProperty,
  modeLabel,
  referenceFieldsForMode,
  type FizzAiModel,
  type GenerationState,
  type ModelSettings,
} from "@/app/canvas/_lib/generation-api";
import { CanvasNodeToolbar, ToolbarButton } from "./node-toolbar";
import { Icon720, PanoramaViewer } from "./panorama-viewer";
import { ModeMenu } from "./mode-menu";
import { ModelPicker } from "./model-picker";
import { ModelSettings as ModelSettingsPanel } from "./model-settings";
import { ReferenceStack, type CardReference, type CardReferences } from "./reference-stack";
import { PortPlus } from "./ports";

/**
 * One generation card for both image and video — the card is a display
 * container for the produced media; selecting it reveals its composer below
 * (references / prompt / mode / model / schema-driven settings / submit).
 * The only thing that varies by modality is the descriptor below, so image and
 * video cards share this single component (registered as the `prompt`/`video`
 * node types via the thin wrappers at the bottom).
 */
export type GenerationModality = "image" | "video";

export type GenerationNodeData = {
  name?: string;
  prompt?: string;
  modelId?: string;
  modelName?: string;
  mode?: string;
  settings?: ModelSettings;
  references?: CardReferences;
  generation?: GenerationState;
  /** Set when a node is spawned to auto-run once on mount (e.g. panorama). */
  autoSubmit?: boolean;
  /**
   * Operation-locked card (spawned from a specific op like Upscale): its model +
   * mode are fixed by the operation, so the composer hides the model + mode
   * pickers (switching them would contradict the operation the card represents).
   */
  locked?: boolean;
  /**
   * Model-locked card (spawned from a prompt-driven op like Relight): the model
   * + mode pickers are hidden (fixed by the op), but the composer stays open so
   * the user can write the prompt + tune settings before generating.
   */
  modelLocked?: boolean;
};
export type GenerationNodeType = Node<GenerationNodeData, "prompt" | "video">;

const MODALITY = {
  image: { icon: IconPhoto, label: "Image" },
  video: { icon: IconVideo, label: "Video" },
} as const;

/**
 * CSS aspect-ratio for the result area so the card matches its content: actual
 * output dimensions win; otherwise the selected size token (e.g. "3:4") shapes
 * the placeholder; otherwise the modality default.
 */
function resultAspectRatio(
  modality: GenerationModality,
  settings: ModelSettings,
  generation: GenerationState | undefined
): string {
  const output = generation?.outputs?.[0];
  if (output?.width && output?.height) return `${output.width} / ${output.height}`;
  const token = String(settings.imageSize ?? settings.aspectRatio ?? settings.size ?? "");
  const match = token.match(/(\d+)\s*[:x]\s*(\d+)/);
  if (match) return `${match[1]} / ${match[2]}`;
  return modality === "video" ? "16 / 9" : "1 / 1";
}

/**
 * Result-area video preview: plays on hover, pauses on leave. Muted so the
 * hover-triggered play() isn't blocked by the autoplay policy; native controls
 * stay for scrub / fullscreen / unmute.
 */
function HoverPreviewVideo({ src, className }: { src: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  return (
    <video
      ref={ref}
      src={src}
      loop
      muted
      playsInline
      controls
      onMouseEnter={() => void ref.current?.play().catch(() => {})}
      onMouseLeave={() => ref.current?.pause()}
      className={className}
    />
  );
}

/** Live ETA countdown (whole seconds) while a job runs. */
function useCountdown(seconds: number | undefined, active: boolean): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (!active || seconds == null) return;
    const end = Date.now() + seconds * 1000;
    const tick = () => setRemaining(Math.max(0, Math.ceil((end - Date.now()) / 1000)));
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [seconds, active]);
  if (!active || seconds == null) return null;
  return remaining;
}

/** Mode-specific prompt hints — generic "Write your prompt.." gives no guidance
 *  for ops where the prompt has a particular job (e.g. relight = the lighting). */
const PROMPT_PLACEHOLDERS: Record<string, string> = {
  relight: "Describe the lighting, e.g. “warm sunset light from the left”",
};
function promptPlaceholder(mode: string | undefined): string {
  return (mode && PROMPT_PLACEHOLDERS[mode]) || "Write your prompt..";
}

function GenerationCard({
  id,
  data,
  selected,
  dragging,
  modality,
}: NodeProps<GenerationNodeType> & { modality: GenerationModality }) {
  const { patchNodeData, canEdit, nodes } = useCanvasGraphContext();
  const { data: catalog } = useAiCatalog();
  // Composer is click-triggered: it opens for a sole selected node only, so a
  // marquee / select-all doesn't pop every card's prompt at once.
  const soleSelected = nodes.filter((n) => n.selected).length === 1;
  const { submit, cancel } = useGeneration();
  const spawnComposedOp = useSpawnComposedOperation();
  const [pendingOp, setPendingOp] = useState<OperationDef | null>(null);
  const autoSubmittedRef = useRef(false);
  const [panel, setPanel] = useState<"model" | "settings" | "mode" | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [pano, setPano] = useState(false);
  // Actual rendered-output aspect ratio (e.g. Topaz upscale returns no width/
  // height metadata) so the card hugs its content instead of the size default.
  const [loadedRatio, setLoadedRatio] = useState<string | null>(null);
  // Keep the composer at a constant screen size (don't shrink/grow with zoom).
  const zoom = useStore((s) => s.transform[2]);
  useDismiss(panel !== null, () => setPanel(null));

  const descriptor = MODALITY[modality];
  const Icon = descriptor.icon;
  const generation = data.generation;
  const settings = useMemo(() => data.settings ?? {}, [data.settings]);
  const busy =
    generation?.status === "submitting" ||
    generation?.status === "queued" ||
    generation?.status === "generating";
  const eta = useCountdown(generation?.etaSeconds, generation?.status === "generating");
  const progressPct =
    generation?.progress != null
      ? Math.round(
          (generation.progress <= 1 ? generation.progress : generation.progress / 100) * 100
        )
      : null;

  const model = useMemo(
    () => catalog?.models.find((m) => m.id === data.modelId),
    [catalog, data.modelId]
  );
  const references = useMemo(() => data.references ?? {}, [data.references]);
  // First bound input image — the "before" for an op's before/after comparison.
  const compareBeforeUrl = useMemo(() => {
    for (const list of Object.values(references)) {
      const hit = (list ?? []).find((r) => r.kind === "image" && /^https?:/i.test(r.url));
      if (hit) return hit.url;
    }
    return null;
  }, [references]);
  // Optimistic, LOCAL-only reference chips still streaming to storage (blob
  // preview + spinner) — never written to the doc; on confirm the durable URL
  // is patched into `references` and the pending chip is dropped.
  const [pendingRefs, setPendingRefs] = useState<CardReferences>({});
  const referencesForDisplay = useMemo<CardReferences>(() => {
    const fields = Object.keys(pendingRefs);
    if (fields.length === 0) return references;
    const merged: CardReferences = { ...references };
    for (const field of fields) {
      const pend = pendingRefs[field] ?? [];
      if (pend.length) merged[field] = [...(references[field] ?? []), ...pend];
    }
    return merged;
  }, [references, pendingRefs]);
  const mode = data.mode ?? defaultMode(model);
  const modes = model?.generationModes ?? [];
  const refFields = useMemo(() => referenceFieldsForMode(model, mode), [model, mode]);

  // Live compute-point estimate for the current model + settings + wired/uploaded
  // references — mirrors the model-settings panel and the standalone studio
  // composer so the same run is priced identically everywhere. Null when the
  // model has no pricing policy.
  const cost = useMemo(() => {
    if (!model) return null;
    const referenceImageCount = refFields.reduce(
      (n, ff) => n + (references[ff.field]?.length ?? 0),
      0
    );
    return (
      estimateModelSellPoints(model, {
        numOutputs: Number(settings.numOutputs ?? settings.n ?? 1) || 1,
        resolution: settings.resolution != null ? String(settings.resolution) : undefined,
        quality: settings.quality != null ? String(settings.quality) : undefined,
        duration: settings.duration != null ? String(settings.duration) : undefined,
        durationSeconds:
          typeof settings.durationSeconds === "number" ? settings.durationSeconds : undefined,
        referenceImageCount: referenceImageCount || undefined,
      })?.sellPoints ?? null
    );
  }, [model, settings, refFields, references]);
  const isPanorama =
    mode === "image_to_panorama" || /hunyuan|panorama|world/i.test(model?.id ?? "");

  // A spawned panorama node auto-runs once, as soon as its model resolves.
  useEffect(() => {
    if (data.autoSubmit && !autoSubmittedRef.current && model) {
      autoSubmittedRef.current = true;
      submit(id);
      patchNodeData(id, { autoSubmit: false });
    }
  }, [data.autoSubmit, model, id, submit, patchNodeData]);

  // Revoke object URLs this card created when it unmounts (blobs would leak).
  const createdUrls = useRef<string[]>([]);
  useEffect(() => () => createdUrls.current.forEach((url) => URL.revokeObjectURL(url)), []);

  const dropPending = (field: string, refId: string) =>
    setPendingRefs((prev) => ({
      ...prev,
      [field]: (prev[field] ?? []).filter((r) => r.id !== refId),
    }));

  const addReferences = (field: string, files: File[]) => {
    const kind = refFields.find((f) => f.field === field)?.kind ?? "image";
    for (const file of files) {
      const refId = crypto.randomUUID();
      const objectUrl = URL.createObjectURL(file);
      createdUrls.current.push(objectUrl);
      // Show an optimistic local chip immediately; upload in the background.
      setPendingRefs((prev) => ({
        ...prev,
        [field]: [
          ...(prev[field] ?? []),
          { id: refId, url: objectUrl, name: file.name, kind, uploading: true },
        ],
      }));
      uploadFileViaSignedUrl(file, { kind: "ai_reference_image" })
        .then((uploaded) => {
          // Persist the DURABLE url (never the blob:) into the doc, drop the chip.
          patchNodeData(id, (node) => {
            const refs: CardReferences = (node.data as GenerationNodeData).references ?? {};
            return {
              references: {
                ...refs,
                [field]: [
                  ...(refs[field] ?? []),
                  { id: refId, url: uploaded.url, name: file.name, kind },
                ],
              },
            };
          });
          dropPending(field, refId);
        })
        .catch((err) => {
          dropPending(field, refId);
          URL.revokeObjectURL(objectUrl);
          if (!isUploadAbort(err)) toast.error(`Couldn't upload ${file.name}`);
        });
    }
  };

  const removeReference = (field: string, refId: string) =>
    patchNodeData(id, (node) => {
      const refs: CardReferences = (node.data as GenerationNodeData).references ?? {};
      const removed = (refs[field] ?? []).find((r) => r.id === refId);
      if (removed) URL.revokeObjectURL(removed.url);
      return {
        references: { ...refs, [field]: (refs[field] ?? []).filter((r) => r.id !== refId) },
      };
    });

  const onSelectModel = (selected: FizzAiModel) =>
    patchNodeData(id, {
      modelId: selected.id,
      modelName: selected.name,
      mode: defaultMode(selected),
      settings: { ...defaultSettingsForModel(selected), ...settings },
    });

  // Default to the first usable model when none is picked yet, so a card is
  // generation-ready without forcing a manual selection. Only the editor writes
  // it (viewers are read-only); idempotent — the `data.modelId` guard stops it
  // re-firing, and concurrent editors converge on the same default.
  useEffect(() => {
    if (data.modelId || !canEdit || !catalog) return;
    const def = usableModelsByModality(catalog, modality)[0];
    if (!def) return;
    patchNodeData(id, {
      modelId: def.id,
      modelName: def.name,
      mode: defaultMode(def),
      settings: defaultSettingsForModel(def),
    });
  }, [data.modelId, canEdit, catalog, modality, id, patchNodeData]);

  const output = generation?.outputs?.[0];
  const onDownload = async () => {
    if (!output?.url) return;
    const ext = output.type === "video" ? "mp4" : "png";
    try {
      const blob = await (await fetch(output.url)).blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${data.name ?? "result"}.${ext}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      window.open(output.url, "_blank");
    }
  };

  return (
    <div className="relative">
      <CanvasNodeToolbar nodeId={id} visible={(selected ?? false) && panel === null && !dragging}>
        {output?.type === "image" &&
          (isPanorama ? (
            <ToolbarButton label="720° View" onClick={() => setPano(true)}>
              <Icon720 className="size-4" />
            </ToolbarButton>
          ) : (
            <>
              <ToolbarButton label="Upscale" onClick={() => setPendingOp(UPSCALE_OP)}>
                <IconArrowsMaximize className="size-4" stroke={1.8} />
              </ToolbarButton>
              <ToolbarButton label="Remove BG" onClick={() => setPendingOp(REMOVE_BG_OP)}>
                <IconScissors className="size-4" stroke={1.8} />
              </ToolbarButton>
              <ToolbarButton
                label="Relight"
                onClick={() => output?.url && spawnComposedOp(RELIGHT_OP, id, output.url)}
              >
                <IconBulb className="size-4" stroke={1.8} />
              </ToolbarButton>
              <ToolbarButton label="Generate Panorama" onClick={() => setPendingOp(PANORAMA_OP)}>
                <Icon720 className="size-4" />
              </ToolbarButton>
            </>
          ))}
        {output && (
          <ToolbarButton label="Download" onClick={onDownload}>
            <IconDownload className="size-4" stroke={1.8} />
          </ToolbarButton>
        )}
        <ToolbarButton label="Rename" onClick={() => setRenaming(true)}>
          <IconPencil className="size-4" stroke={1.8} />
        </ToolbarButton>
      </CanvasNodeToolbar>
      {pano && output && <PanoramaViewer src={output.url} onClose={() => setPano(false)} />}

      <div
        className={cn(
          "w-[360px] overflow-hidden rounded-2xl bg-card",
          selected && "ring-2 ring-ring"
        )}
      >
        {/* Header: node name left, model used right — a lighter frosted strip
            distinct from the preview well below. */}
        <div className="flex items-center justify-between gap-2 bg-white/[0.12] px-3 py-2 text-xs">
          <span className="flex min-w-0 items-center gap-1.5 text-white/80">
            <Icon className="size-3.5 shrink-0" stroke={1.8} />
            {renaming ? (
              <input
                autoFocus
                defaultValue={data.name ?? descriptor.label}
                onBlur={(event) => {
                  patchNodeData(id, { name: event.target.value.trim() || descriptor.label });
                  setRenaming(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  else if (event.key === "Escape") setRenaming(false);
                }}
                className="nodrag w-28 bg-transparent text-white/80 outline-none"
              />
            ) : (
              <span className="truncate">{data.name ?? descriptor.label}</span>
            )}
          </span>
          <span className="shrink-0 text-muted-foreground">{data.modelName ?? "Select model"}</span>
        </div>

        {/* Result display area — content-aware aspect ratio; shows the produced
            media or the live job state (queued / generating+ETA / failed). */}
        <div
          className="relative flex flex-col items-center justify-center gap-3 overflow-hidden bg-muted"
          style={{ aspectRatio: loadedRatio ?? resultAspectRatio(modality, settings, generation) }}
        >
          {generation?.status === "done" && generation.outputs?.[0] ? (
            generation.outputs[0].type === "video" ? (
              <HoverPreviewVideo
                src={generation.outputs[0].url}
                className="size-full object-contain"
              />
            ) : (data.locked || data.modelLocked) && compareBeforeUrl ? (
              // Operation result (upscale / remove-bg / relight): before/after
              // comparison slider — drag the handle to compare input vs output.
              <ReactCompareSlider
                className="size-full"
                itemOne={
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={compareBeforeUrl} alt="Before" className="size-full object-contain" />
                }
                itemTwo={
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={generation.outputs[0].url}
                    alt="After"
                    onLoad={(e) => {
                      const t = e.currentTarget;
                      if (t.naturalWidth && t.naturalHeight) {
                        setLoadedRatio(`${t.naturalWidth} / ${t.naturalHeight}`);
                      }
                    }}
                    className="size-full object-contain"
                  />
                }
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={generation.outputs[0].url}
                alt={data.prompt ?? "Result"}
                onLoad={(e) => {
                  const t = e.currentTarget;
                  if (t.naturalWidth && t.naturalHeight) {
                    setLoadedRatio(`${t.naturalWidth} / ${t.naturalHeight}`);
                  }
                }}
                className="size-full object-contain"
              />
            )
          ) : busy ? (
            <>
              <IconLoader2 className="size-7 animate-spin text-white/50" stroke={1.8} />
              <p className="text-sm text-white/55">
                {generation?.status === "submitting"
                  ? "Submitting…"
                  : generation?.status === "queued"
                    ? generation.queuePosition != null
                      ? `Queued · #${generation.queuePosition}`
                      : "Queued…"
                    : eta != null
                      ? `Generating · ~${eta}s`
                      : "Generating…"}
              </p>
              {progressPct != null && (
                <div
                  className="absolute bottom-0 left-0 h-0.5 bg-white/70 transition-[width] duration-500"
                  style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }}
                />
              )}
            </>
          ) : generation?.status === "failed" ? (
            <>
              <IconAlertTriangle className="size-7 text-destructive" stroke={1.6} />
              <p className="px-5 text-center text-sm text-white/55">
                {generation.error ?? "Generation failed"}
              </p>
              <button
                type="button"
                onClick={() => submit(id)}
                className="flex items-center gap-1.5 rounded-full bg-white/[0.1] px-3 py-1 text-xs font-medium text-white/80 transition-colors hover:bg-white/[0.16] hover:text-white"
              >
                <IconRefresh className="size-3.5" stroke={1.8} />
                Retry
              </button>
            </>
          ) : (
            <>
              <Icon className="size-7 text-white/30" stroke={1.5} />
              <p className="text-sm text-white/45">Results will appear here.</p>
            </>
          )}
        </div>
      </div>

      {/* Card-specific composer — slides up below the card while selected.
          Outer wrapper animates in; inner is counter-scaled by 1/zoom so it
          stays a constant, readable screen size. */}
      {pendingOp && output?.url && (
        <OperationConfirmBar
          op={pendingOp}
          sourceNodeId={id}
          sourceUrl={output.url}
          onClose={() => setPendingOp(null)}
        />
      )}
      {canEdit &&
        selected &&
        soleSelected &&
        !dragging &&
        !isPanorama &&
        !data.locked &&
        !pendingOp && (
          <div className="absolute top-full left-1/2 z-10 mt-3 duration-200 animate-in fade-in-0 slide-in-from-bottom-3">
            <div
              className="nodrag w-[600px] rounded-3xl bg-white/[0.05] p-4 backdrop-blur-3xl backdrop-saturate-200 shadow-[0_24px_80px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.16)]"
              style={{
                transform: `translateX(-50%) scale(${1 / zoom})`,
                transformOrigin: "top center",
              }}
            >
              {refFields.length > 0 && (
                <ReferenceStack
                  fields={refFields}
                  references={referencesForDisplay}
                  onAdd={addReferences}
                  onRemove={removeReference}
                />
              )}
              {/* Pure transform ops (e.g. upscale) declare no prompt in their
                schema — hide the textarea so the composer is just the op + send. */}
              {(!model || hasSchemaProperty(model, "prompt")) && (
                <textarea
                  value={data.prompt ?? ""}
                  onChange={(event) => patchNodeData(id, { prompt: event.target.value })}
                  placeholder={promptPlaceholder(mode)}
                  rows={3}
                  autoFocus
                  className="block w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
              )}
              <div className="flex items-center gap-2 pt-2">
                {/* Mode pill — hidden on operation-locked / model-locked cards
                  (the op fixes the mode). */}
                {!data.locked && !data.modelLocked && modes.length > 1 && (
                  <div className="relative" data-popover-zone>
                    <button
                      type="button"
                      onClick={() => setPanel((p) => (p === "mode" ? null : "mode"))}
                      className="flex h-8 items-center gap-1 rounded-full bg-white/[0.06] px-3 text-xs font-medium transition-colors hover:bg-white/[0.1]"
                    >
                      {modeLabel(mode ?? "")}
                      <IconChevronDown className="size-3.5 text-muted-foreground" stroke={1.8} />
                    </button>
                    {panel === "mode" && (
                      <ModeMenu
                        modes={modes}
                        value={mode}
                        onSelect={(mo) => patchNodeData(id, { mode: mo })}
                        onClose={() => setPanel(null)}
                      />
                    )}
                  </div>
                )}
                {/* Model pill — hidden on operation-locked / model-locked cards
                  (op fixes the model; switching it would contradict the
                  operation + bring back mode/prompt). Header still shows it. */}
                {!data.locked && !data.modelLocked && (
                  <div className="relative" data-popover-zone>
                    <button
                      type="button"
                      onClick={() => setPanel((p) => (p === "model" ? null : "model"))}
                      className="flex h-8 items-center rounded-full bg-white/[0.06] px-3 text-xs font-medium transition-colors hover:bg-white/[0.1]"
                    >
                      {data.modelName ?? "Select model"}
                    </button>
                    {panel === "model" && (
                      <ModelPicker
                        catalog={catalog}
                        modality={modality}
                        selectedId={data.modelId}
                        onSelect={onSelectModel}
                        onClose={() => setPanel(null)}
                      />
                    )}
                  </div>
                )}

                {/* Schema-driven settings pill */}
                <div className="relative" data-popover-zone>
                  <button
                    type="button"
                    onClick={() => setPanel((p) => (p === "settings" ? null : "settings"))}
                    className="flex size-8 items-center justify-center rounded-full bg-white/[0.06] transition-colors hover:bg-white/[0.1]"
                    aria-label="Settings"
                  >
                    <IconAdjustments className="size-4" stroke={1.8} />
                  </button>
                  {panel === "settings" && (
                    <ModelSettingsPanel
                      model={model}
                      settings={settings}
                      onChange={(next) => patchNodeData(id, { settings: next })}
                    />
                  )}
                </div>

                <div className="ml-auto flex items-center gap-3">
                  {cost != null && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
                      <IconBolt className="size-3.5" stroke={1.8} />
                      {cost}
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={busy ? "Cancel generation" : "Generate"}
                    onClick={() => (busy ? cancel(id) : submit(id))}
                    // Brand red as the hero CTA — sanctioned case-by-case accent
                    // (DESIGN.md rule 3), applied locally, never a token.
                    className="flex size-8 items-center justify-center rounded-full bg-[#E52227] text-white shadow-lg shadow-[#E52227]/25 transition-colors hover:bg-[#c91e22]"
                  >
                    {busy ? (
                      <IconX className="size-4" stroke={2} />
                    ) : (
                      <IconArrowUp className="size-4" stroke={2} />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      {/* Every card connects on both sides: "+" input on the left, "+" output on
          the right. The output port is tinted by the card's output kind. */}
      <PortPlus type="target" id="input" side="left" />
      <PortPlus type="source" id="output" side="right" dataType={modality} />
    </div>
  );
}

const GenerationCardMemo = memo(GenerationCard);

/** Image generation card (`prompt` node type). */
export const PromptNode = memo((props: NodeProps<GenerationNodeType>) => (
  <GenerationCardMemo {...props} modality="image" />
));
PromptNode.displayName = "PromptNode";

/** Video generation card (`video` node type). */
export const VideoNode = memo((props: NodeProps<GenerationNodeType>) => (
  <GenerationCardMemo {...props} modality="video" />
));
VideoNode.displayName = "VideoNode";
