"use client";

import { useMemo, useState } from "react";
import { useReactFlow, useStore } from "@xyflow/react";
import { IconArrowUp, IconBolt, IconChevronDown, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { FLOATING_PANEL } from "./node-toolbar";
import { useAiCatalog } from "@/app/canvas/_lib/use-ai-catalog";
import { useCanvasGraphContext } from "@/lib/collab/canvas-graph-context";
import { findPanoramaModel } from "@/app/canvas/_lib/use-panorama";
import {
  defaultSettingsForModel,
  estimateModelSellPoints,
  maxOutputs,
  referenceFieldsForMode,
  schemaFields,
  type FizzAiCatalog,
  type FizzAiModel,
  type ModelSettings,
  type SchemaFieldDescriptor,
} from "@/app/canvas/_lib/generation-api";

/**
 * An inline enum-parameter dropdown for the operation confirm bar (e.g. the
 * upscale factor "2× / 4×"). Closes on select; keeps the value's native type
 * (number enums stay numbers, so the provider gets the right shape).
 */
export function ParamPill({
  field,
  value,
  onChange,
}: {
  field: SchemaFieldDescriptor;
  value: string | number | undefined;
  onChange: (next: string | number) => void;
}) {
  const [open, setOpen] = useState(false);
  const options = field.enum ?? [];
  const current = value ?? field.default ?? options[0] ?? "";
  const fmt = (v: string | number | boolean) => `${v}${field.unit ?? ""}`;
  return (
    <div className="relative" data-popover-zone>
      <button
        type="button"
        title={field.title ?? field.name}
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 items-center gap-1.5 rounded-full bg-white/[0.06] px-3 text-xs font-medium transition-colors hover:bg-white/[0.1]"
      >
        {field.title && <span className="text-white/45">{field.title}</span>}
        <span>{fmt(current)}</span>
        <IconChevronDown className="size-3.5 text-muted-foreground" stroke={1.8} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-10 mb-2 min-w-[88px] rounded-xl bg-popover p-1 shadow-md ring-1 ring-white/10">
          {options.map((opt) => (
            <button
              key={String(opt)}
              type="button"
              onClick={() => {
                onChange(opt);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center rounded-lg px-3 py-1.5 text-left text-xs transition-colors hover:bg-white/[0.06]",
                String(current) === String(opt) ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {fmt(opt)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A canvas operation that runs on a source image (Upscale, 720° Panorama, …). */
export interface OperationDef {
  /** Result-card display name. */
  name: string;
  /** Resolve the catalog model that backs this op (region/availability aware). */
  findModel: (catalog: FizzAiCatalog | undefined) => FizzAiModel | undefined;
  /** The generation mode the op runs in, given its model. */
  resolveMode: (model: FizzAiModel) => string;
  /** Optional fixed prompt (e.g. panorama); transforms like upscale have none. */
  buildPrompt?: () => string | undefined;
}

/** Output-count selector for the confirm bar — a synthetic enum field (1–4)
 *  bound to `numOutputs`, rendered with the same ParamPill as schema params. */
const COUNT_FIELD: SchemaFieldDescriptor = {
  name: "numOutputs",
  control: "segmented",
  group: "settings",
  order: 999,
  type: "integer",
  enum: [1, 2, 3, 4],
  default: 1,
  title: "Count",
};

export const UPSCALE_OP: OperationDef = {
  name: "Upscale",
  findModel: (catalog) => catalog?.models.find((m) => m.generationModes?.includes("upscale")),
  resolveMode: () => "upscale",
};

export const PANORAMA_OP: OperationDef = {
  name: "Panorama",
  findModel: (catalog) => findPanoramaModel(catalog),
  resolveMode: (model) =>
    model.generationModes?.find((m) => m === "image_to_panorama") ??
    model.generationModes?.[0] ??
    "image_to_image",
  buildPrompt: () => "a 360 degree panorama scene",
};

/**
 * Confirm bar shown UNDER the source node when an operation is invoked: pick the
 * op's inline params, see the credit cost, then Run (which only NOW creates the
 * result node, wired from the source, set to auto-generate). ✕ dismisses with no
 * node created. Anchored to the source node's DOM (counter-scaled by zoom).
 */
export function OperationConfirmBar({
  op,
  sourceNodeId,
  sourceUrl,
  onClose,
}: {
  op: OperationDef;
  sourceNodeId: string;
  sourceUrl: string;
  onClose: () => void;
}) {
  const { data: catalog } = useAiCatalog();
  const graph = useCanvasGraphContext();
  const { getNode } = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const model = useMemo(() => op.findModel(catalog), [op, catalog]);
  const [overrides, setOverrides] = useState<ModelSettings>({});
  // Defaults from the model's schema, overlaid with the user's picks.
  const settings = useMemo<ModelSettings>(
    () => ({ ...defaultSettingsForModel(model), ...overrides }),
    [model, overrides]
  );
  const fields = useMemo(
    () => schemaFields(model).filter((f) => f.enum && f.enum.length > 0),
    [model]
  );
  // Single-output ops (e.g. Topaz upscale) produce exactly one result — a Count
  // selector would mislead and over-estimate cost, so only offer it when the
  // model can actually return more than one output.
  const allowsMultiple = model ? maxOutputs(model) > 1 : false;
  const cost = useMemo(
    () =>
      model
        ? (estimateModelSellPoints(model, {
            numOutputs: Number(settings.numOutputs ?? 1) || 1,
            resolution: settings.resolution != null ? String(settings.resolution) : undefined,
            quality: settings.quality != null ? String(settings.quality) : undefined,
          })?.sellPoints ?? null)
        : null,
    [model, settings]
  );

  const onRun = () => {
    if (!model) {
      toast.error(`No ${op.name.toLowerCase()} model in the catalog yet`);
      return;
    }
    const mode = op.resolveMode(model);
    const field = referenceFieldsForMode(model, mode)[0]?.field ?? "referenceImages";
    const source = getNode(sourceNodeId);
    const nodeId = crypto.randomUUID();
    const edgeId = crypto.randomUUID();
    const prompt = op.buildPrompt?.();
    graph.addNode({
      id: nodeId,
      type: "prompt",
      position: source ? { x: source.position.x + 440, y: source.position.y } : { x: 0, y: 0 },
      data: {
        name: op.name,
        modelId: model.id,
        modelName: model.name,
        mode,
        locked: true,
        settings,
        ...(prompt ? { prompt } : {}),
        references: {
          [field]: [{ id: edgeId, edgeId, sourceNodeId, url: sourceUrl, kind: "image" as const }],
        },
        autoSubmit: true,
      },
    });
    graph.addEdge({
      id: edgeId,
      source: sourceNodeId,
      sourceHandle: "output",
      target: nodeId,
      targetHandle: "input",
    });
    onClose();
  };

  return (
    <div
      className="absolute top-full left-1/2 z-10 mt-3 duration-200 animate-in fade-in-0 slide-in-from-bottom-3"
      style={{ transform: `translateX(-50%) scale(${1 / zoom})`, transformOrigin: "top center" }}
    >
      {/* Compact pill, same language as the node action toolbar above the card. */}
      <div
        className={cn(
          "nodrag flex h-11 w-fit items-center gap-1 rounded-full px-2",
          FLOATING_PANEL
        )}
      >
        <button
          type="button"
          aria-label="Cancel"
          onClick={onClose}
          className="flex size-8 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/[0.1] hover:text-white"
        >
          <IconX className="size-4" stroke={2} />
        </button>
        <span className="px-1 text-xs font-medium text-white/80">{op.name}</span>
        {fields.map((f) => (
          <ParamPill
            key={f.name}
            field={f}
            value={settings[f.name] as string | number | undefined}
            onChange={(next) => setOverrides((o) => ({ ...o, [f.name]: next }))}
          />
        ))}
        {allowsMultiple && (
          <ParamPill
            field={COUNT_FIELD}
            value={(settings.numOutputs as number | undefined) ?? 1}
            onChange={(next) => setOverrides((o) => ({ ...o, numOutputs: next }))}
          />
        )}
        {cost != null && (
          <span className="flex items-center gap-1 px-1.5 text-sm text-white/70 tabular-nums">
            <IconBolt className="size-4" stroke={1.8} />
            {cost}
          </span>
        )}
        <button
          type="button"
          aria-label="Run"
          onClick={onRun}
          className="flex size-8 items-center justify-center rounded-full bg-[#E52227] text-white shadow-md shadow-[#E52227]/25 transition-colors hover:bg-[#c91e22]"
        >
          <IconArrowUp className="size-4" stroke={2} />
        </button>
      </div>
    </div>
  );
}
