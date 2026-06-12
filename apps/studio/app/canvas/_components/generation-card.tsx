"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useReactFlow, useStore, type Node, type NodeProps } from "@xyflow/react";
import {
  IconAdjustments,
  IconAlertTriangle,
  IconArrowUp,
  IconChevronDown,
  IconDownload,
  IconLoader2,
  IconPencil,
  IconPhoto,
  IconRefresh,
  IconVideo,
  IconWand,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useDismiss } from "@/lib/use-dismiss";
import { useAiCatalog } from "@/app/canvas/_lib/use-ai-catalog";
import { useGeneration } from "@/app/canvas/_lib/use-canvas-generation";
import { useCreatePanorama } from "@/app/canvas/_lib/use-panorama";
import {
  defaultMode,
  defaultSettingsForModel,
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
import { ReferenceStack, type CardReferences } from "./reference-stack";
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
};
export type GenerationNodeType = Node<GenerationNodeData, "prompt" | "video">;

const MODALITY = {
  image: { icon: IconPhoto, label: "Image" },
  video: { icon: IconVideo, label: "Video" },
} as const;

const comingSoon = (label: string) => toast.info(`${label} · Coming soon`);

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

function GenerationCard({
  id,
  data,
  selected,
  dragging,
  modality,
}: NodeProps<GenerationNodeType> & { modality: GenerationModality }) {
  const { updateNodeData } = useReactFlow();
  const { data: catalog } = useAiCatalog();
  const { submit } = useGeneration();
  const createPanorama = useCreatePanorama();
  const autoSubmittedRef = useRef(false);
  const [panel, setPanel] = useState<"model" | "settings" | "mode" | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [pano, setPano] = useState(false);
  // Keep the composer at a constant screen size (don't shrink/grow with zoom).
  const zoom = useStore((s) => s.transform[2]);
  useDismiss(panel !== null, () => setPanel(null));

  const descriptor = MODALITY[modality];
  const Icon = descriptor.icon;
  const generation = data.generation;
  const settings = data.settings ?? {};
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
  const references = data.references ?? {};
  const mode = data.mode ?? defaultMode(model);
  const modes = model?.generationModes ?? [];
  const refFields = useMemo(() => referenceFieldsForMode(model, mode), [model, mode]);
  const isPanorama =
    mode === "image_to_panorama" || /hunyuan|panorama|world/i.test(model?.id ?? "");

  // A spawned panorama node auto-runs once, as soon as its model resolves.
  useEffect(() => {
    if (data.autoSubmit && !autoSubmittedRef.current && model) {
      autoSubmittedRef.current = true;
      submit(id);
      updateNodeData(id, { autoSubmit: false });
    }
  }, [data.autoSubmit, model, id, submit, updateNodeData]);

  // Revoke object URLs this card created when it unmounts (blobs would leak).
  const createdUrls = useRef<string[]>([]);
  useEffect(() => () => createdUrls.current.forEach((url) => URL.revokeObjectURL(url)), []);

  const addReferences = (field: string, files: File[]) => {
    const kind = refFields.find((f) => f.field === field)?.kind ?? "image";
    const added = files.map((file) => {
      const url = URL.createObjectURL(file);
      createdUrls.current.push(url);
      return { id: crypto.randomUUID(), url, name: file.name, kind };
    });
    updateNodeData(id, (node) => {
      const refs: CardReferences = (node.data as GenerationNodeData).references ?? {};
      return { references: { ...refs, [field]: [...(refs[field] ?? []), ...added] } };
    });
  };

  const removeReference = (field: string, refId: string) =>
    updateNodeData(id, (node) => {
      const refs: CardReferences = (node.data as GenerationNodeData).references ?? {};
      const removed = (refs[field] ?? []).find((r) => r.id === refId);
      if (removed) URL.revokeObjectURL(removed.url);
      return {
        references: { ...refs, [field]: (refs[field] ?? []).filter((r) => r.id !== refId) },
      };
    });

  const onSelectModel = (selected: FizzAiModel) =>
    updateNodeData(id, {
      modelId: selected.id,
      modelName: selected.name,
      mode: defaultMode(selected),
      settings: { ...defaultSettingsForModel(selected), ...settings },
    });

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
            <ToolbarButton label="Generate Panorama" onClick={() => createPanorama(id, output.url)}>
              <Icon720 className="size-4" />
            </ToolbarButton>
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

      {/* Header: node name left, model used right. */}
      <div className="flex items-center justify-between px-1 pb-1.5 text-xs">
        <span className="flex items-center gap-1.5 text-white/80">
          <Icon className="size-3.5" stroke={1.8} />
          {renaming ? (
            <input
              autoFocus
              defaultValue={data.name ?? descriptor.label}
              onBlur={(event) => {
                updateNodeData(id, { name: event.target.value.trim() || descriptor.label });
                setRenaming(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                else if (event.key === "Escape") setRenaming(false);
              }}
              className="nodrag w-28 bg-transparent text-white/80 outline-none"
            />
          ) : (
            (data.name ?? descriptor.label)
          )}
        </span>
        <span className="text-muted-foreground">{data.modelName ?? "Auto"}</span>
      </div>

      <div
        className={cn(
          "w-[360px] overflow-hidden rounded-2xl bg-card",
          selected && "ring-2 ring-ring"
        )}
      >
        {/* Result display area — content-aware aspect ratio; shows the produced
            media or the live job state (queued / generating+ETA / failed). */}
        <div
          className="relative flex flex-col items-center justify-center gap-3 overflow-hidden bg-muted"
          style={{ aspectRatio: resultAspectRatio(modality, settings, generation) }}
        >
          {generation?.status === "done" && generation.outputs?.[0] ? (
            generation.outputs[0].type === "video" ? (
              <HoverPreviewVideo
                src={generation.outputs[0].url}
                className="size-full object-contain"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={generation.outputs[0].url}
                alt={data.prompt ?? "Result"}
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
      {selected && !dragging && !isPanorama && (
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
                references={references}
                onAdd={addReferences}
                onRemove={removeReference}
              />
            )}
            <textarea
              value={data.prompt ?? ""}
              onChange={(event) => updateNodeData(id, { prompt: event.target.value })}
              placeholder="Write your prompt.."
              rows={3}
              autoFocus
              className="block w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <div className="flex items-center gap-2 pt-2">
              {/* Mode pill */}
              {modes.length > 1 && (
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
                      onSelect={(mo) => updateNodeData(id, { mode: mo })}
                      onClose={() => setPanel(null)}
                    />
                  )}
                </div>
              )}
              {/* Model pill */}
              <div className="relative" data-popover-zone>
                <button
                  type="button"
                  onClick={() => setPanel((p) => (p === "model" ? null : "model"))}
                  className="flex h-8 items-center rounded-full bg-white/[0.06] px-3 text-xs font-medium transition-colors hover:bg-white/[0.1]"
                >
                  {data.modelName ?? "Auto"}
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
                    onChange={(next) => updateNodeData(id, { settings: next })}
                  />
                )}
              </div>

              <div className="flex-1" />
              <button
                type="button"
                aria-label="Enhance prompt"
                onClick={() => comingSoon("Prompt enhance")}
                className="flex size-8 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                <IconWand className="size-4" stroke={1.8} />
              </button>
              <button
                type="button"
                aria-label="Generate"
                disabled={busy}
                onClick={() => submit(id)}
                className="flex size-8 items-center justify-center rounded-full bg-white/[0.1] text-white/80 transition-colors hover:bg-white/[0.18] hover:text-white disabled:opacity-50"
              >
                {busy ? (
                  <IconLoader2 className="size-4 animate-spin" stroke={2} />
                ) : (
                  <IconArrowUp className="size-4" stroke={2} />
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Every card connects on both sides: "+" input on the left, "+" output on
          the right. Any card can wire into any other. */}
      <PortPlus type="target" id="input" side="left" />
      <PortPlus type="source" id="output" side="right" />
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
