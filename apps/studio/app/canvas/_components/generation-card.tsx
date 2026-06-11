"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useReactFlow, useStore, type Node, type NodeProps } from "@xyflow/react";
import {
  IconAdjustments,
  IconArrowUp,
  IconChevronDown,
  IconPhoto,
  IconVideo,
  IconWand,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useDismiss } from "@/lib/use-dismiss";
import { useAiCatalog } from "@/app/canvas/_lib/use-ai-catalog";
import {
  defaultMode,
  defaultSettingsForModel,
  modeLabel,
  referenceFieldsForMode,
  type FizzAiModel,
  type ModelSettings,
} from "@/app/canvas/_lib/generation-api";
import { CanvasNodeToolbar } from "./node-toolbar";
import { ModeMenu } from "./mode-menu";
import { ModelPicker } from "./model-picker";
import { ModelSettings as ModelSettingsPanel } from "./model-settings";
import { ReferenceStack, type CardReferences } from "./reference-stack";
import { Port } from "./ports";

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
};
export type GenerationNodeType = Node<GenerationNodeData, "prompt" | "video">;

const MODALITY = {
  image: { icon: IconPhoto, label: "Image", aspect: "aspect-square" },
  video: { icon: IconVideo, label: "Video", aspect: "aspect-video" },
} as const;

const comingSoon = (label: string) => toast.info(`${label} · Coming soon`);

function GenerationCard({
  id,
  data,
  selected,
  modality,
}: NodeProps<GenerationNodeType> & { modality: GenerationModality }) {
  const { updateNodeData } = useReactFlow();
  const { data: catalog } = useAiCatalog();
  const [panel, setPanel] = useState<"model" | "settings" | "mode" | null>(null);
  // Keep the composer at a constant screen size (don't shrink/grow with zoom).
  const zoom = useStore((s) => s.transform[2]);
  useDismiss(panel !== null, () => setPanel(null));

  const descriptor = MODALITY[modality];
  const Icon = descriptor.icon;

  const model = useMemo(
    () => catalog?.models.find((m) => m.id === data.modelId),
    [catalog, data.modelId]
  );
  const settings = data.settings ?? {};
  const references = data.references ?? {};
  const mode = data.mode ?? defaultMode(model);
  const modes = model?.generationModes ?? [];
  const refFields = useMemo(() => referenceFieldsForMode(model, mode), [model, mode]);

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

  return (
    <div className="relative">
      <CanvasNodeToolbar nodeId={id} visible={(selected ?? false) && panel === null} />

      {/* Header: node name left, model used right. */}
      <div className="flex items-center justify-between px-1 pb-1.5 text-xs">
        <span className="flex items-center gap-1.5 text-white/80">
          <Icon className="size-3.5" stroke={1.8} />
          {data.name ?? descriptor.label}
        </span>
        <span className="text-muted-foreground">{data.modelName ?? "Auto"}</span>
      </div>

      <div
        className={cn(
          "w-[360px] overflow-hidden rounded-2xl bg-card shadow-xl shadow-black/40",
          selected && "ring-2 ring-ring"
        )}
      >
        {/* Result display area */}
        <div
          className={cn(
            "flex flex-col items-center justify-center gap-3 bg-muted",
            descriptor.aspect
          )}
        >
          <Icon className="size-7 text-white/30" stroke={1.5} />
          <p className="text-sm text-white/45">Results will appear here.</p>
        </div>
      </div>

      {/* Card-specific composer — slides up below the card while selected.
          Outer wrapper animates in; inner is counter-scaled by 1/zoom so it
          stays a constant, readable screen size. */}
      {selected && (
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
                onClick={() => comingSoon("Generation")}
                className="flex size-8 items-center justify-center rounded-full bg-white/[0.1] text-white/80 transition-colors hover:bg-white/[0.18] hover:text-white"
              >
                <IconArrowUp className="size-4" stroke={2} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Output ports — every generation card can emit image and video. */}
      <Port type="source" id="image" side="right" top={48} label="Image" />
      <Port type="source" id="video" side="right" top={84} label="Video" />
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
