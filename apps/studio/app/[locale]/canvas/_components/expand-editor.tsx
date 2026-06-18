"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useStore } from "@xyflow/react";
import { IconArrowUp, IconBolt, IconLoader2, IconRefresh, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAiCatalog } from "@/app/[locale]/canvas/_lib/use-ai-catalog";
import {
  estimateModelSellPoints,
  type ModelSettings,
} from "@/app/[locale]/canvas/_lib/generation-api";
import { EXPAND_OP, useSpawnOperationResult } from "./operation-confirm-bar";

/** Margins (source-image px) added on each side of the original. */
type Margins = { l: number; t: number; r: number; b: number };
const ZERO: Margins = { l: 0, t: 0, r: 0, b: 0 };

/** Max canvas growth per axis (× the original). */
const LIMIT = 3;
const STAGE_W = 320;
const STAGE_H = 280;

/** Handles: which margins each one drives. */
const HANDLES: {
  id: string;
  fx: number;
  fy: number;
  sides: ("l" | "t" | "r" | "b")[];
  cursor: string;
}[] = [
  { id: "tl", fx: 0, fy: 0, sides: ["l", "t"], cursor: "nwse-resize" },
  { id: "t", fx: 0.5, fy: 0, sides: ["t"], cursor: "ns-resize" },
  { id: "tr", fx: 1, fy: 0, sides: ["r", "t"], cursor: "nesw-resize" },
  { id: "r", fx: 1, fy: 0.5, sides: ["r"], cursor: "ew-resize" },
  { id: "br", fx: 1, fy: 1, sides: ["r", "b"], cursor: "nwse-resize" },
  { id: "b", fx: 0.5, fy: 1, sides: ["b"], cursor: "ns-resize" },
  { id: "bl", fx: 0, fy: 1, sides: ["l", "b"], cursor: "nesw-resize" },
  { id: "l", fx: 0, fy: 0.5, sides: ["l"], cursor: "ew-resize" },
];

/** `key` "original" is a translated word; the rest are aspect-ratio notations
 *  shown verbatim. */
const PRESETS: { key: string; label: string | null; ratio: number | null }[] = [
  { key: "original", label: null, ratio: null },
  { key: "1:1", label: "1:1", ratio: 1 },
  { key: "16:9", label: "16:9", ratio: 16 / 9 },
  { key: "9:16", label: "9:16", ratio: 9 / 16 },
  { key: "4:3", label: "4:3", ratio: 4 / 3 },
  { key: "3:4", label: "3:4", ratio: 3 / 4 },
];

/** Margins that grow the original (w×h) to the target aspect, centred, without
 *  shrinking it — expand only. */
function marginsForRatio(w: number, h: number, ratio: number): Margins {
  const cur = w / h;
  if (ratio > cur) {
    const newW = Math.round(h * ratio);
    const pad = (newW - w) / 2;
    return { l: pad, r: pad, t: 0, b: 0 };
  }
  const newH = Math.round(w / ratio);
  const pad = (newH - h) / 2;
  return { l: 0, r: 0, t: pad, b: pad };
}

/**
 * Expand (outpainting) editor — a bespoke operation surface shown under the
 * source node. Drag the frame handles to pull the canvas outward around the
 * pinned original; the margin area is the region Bria will generatively fill.
 * Aspect presets set the frame to a common ratio; an optional prompt steers the
 * fill. Generate spawns the locked result card (before/after slider) sized to
 * the new canvas.
 */
export function ExpandEditor({
  sourceNodeId,
  sourceUrl,
  onClose,
}: {
  sourceNodeId: string;
  sourceUrl: string;
  onClose: () => void;
}) {
  const tr = useTranslations("canvasEditors");
  const tc = useTranslations("common");
  const { data: catalog } = useAiCatalog();
  const spawnResult = useSpawnOperationResult();
  const zoom = useStore((s) => s.transform[2]);
  const model = useMemo(() => EXPAND_OP.findModel(catalog), [catalog]);

  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [margins, setMargins] = useState<Margins>(ZERO);
  const [prompt, setPrompt] = useState("");

  useEffect(() => {
    let active = true;
    const img = new Image();
    img.onload = () => {
      if (active) setDims({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.src = sourceUrl;
    return () => {
      active = false;
      img.onload = null;
    };
  }, [sourceUrl]);

  const cost = useMemo(
    () => (model ? (estimateModelSellPoints(model, { numOutputs: 1 })?.sellPoints ?? null) : null),
    [model]
  );

  // Fixed display scale so dragging never rescales/jumps: reserve room for the
  // max canvas (LIMIT× the original on each axis).
  const scale = dims ? Math.min(STAGE_W / (dims.w * LIMIT), STAGE_H / (dims.h * LIMIT)) : 1;
  const maxH = dims ? dims.w * (LIMIT - 1) : 0;
  const maxV = dims ? dims.h * (LIMIT - 1) : 0;

  const onHandleDown = (handleId: string) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const handle = HANDLES.find((h) => h.id === handleId);
    if (!handle) return;
    const move = (ev: PointerEvent) => {
      setMargins((m) => {
        const next = { ...m };
        for (const side of handle.sides) {
          if (side === "l")
            next.l = Math.max(0, Math.min(maxH - next.r, next.l - ev.movementX / scale));
          if (side === "r")
            next.r = Math.max(0, Math.min(maxH - next.l, next.r + ev.movementX / scale));
          if (side === "t")
            next.t = Math.max(0, Math.min(maxV - next.b, next.t - ev.movementY / scale));
          if (side === "b")
            next.b = Math.max(0, Math.min(maxV - next.t, next.b + ev.movementY / scale));
        }
        return next;
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onRun = () => {
    if (!model || !dims) {
      toast.error(tr("expand.noModel"));
      return;
    }
    // Round the margins FIRST, then derive the canvas from the integers, so the
    // placement stays exactly consistent (location + original + opposite margin
    // === canvas) and symmetric presets don't drift 1px off-centre.
    const l = Math.round(margins.l);
    const r = Math.round(margins.r);
    const t = Math.round(margins.t);
    const b = Math.round(margins.b);
    const canvasW = dims.w + l + r;
    const canvasH = dims.h + t + b;
    if (canvasW === dims.w && canvasH === dims.h) {
      toast.error(tr("expand.dragOutwardFirst"));
      return;
    }
    const settings: ModelSettings = {
      canvasSize: [canvasW, canvasH],
      originalImageSize: [dims.w, dims.h],
      originalImageLocation: [l, t],
    };
    if (prompt.trim()) settings.prompt = prompt.trim();
    spawnResult({ op: EXPAND_OP, model, sourceNodeId, sourceUrl, settings });
    onClose();
  };

  // Display geometry: original pinned centre, frame grows around it.
  const ow = dims ? dims.w * scale : 0;
  const oh = dims ? dims.h * scale : 0;
  const frameLeft = STAGE_W / 2 - ow / 2 - margins.l * scale;
  const frameTop = STAGE_H / 2 - oh / 2 - margins.t * scale;
  const frameW = (dims ? dims.w : 0) * scale + (margins.l + margins.r) * scale;
  const frameH = (dims ? dims.h : 0) * scale + (margins.t + margins.b) * scale;
  const canvasW = dims ? Math.round(dims.w + margins.l + margins.r) : 0;
  const canvasH = dims ? Math.round(dims.h + margins.t + margins.b) : 0;
  const activeRatio = dims ? canvasW / canvasH : 1;

  return (
    <div
      className="absolute top-full left-1/2 z-10 mt-3 duration-200 animate-in fade-in-0 slide-in-from-bottom-3"
      style={{ transform: `translateX(-50%) scale(${1 / zoom})`, transformOrigin: "top center" }}
    >
      <div className="nodrag nowheel w-[560px] rounded-3xl bg-[oklch(0.2_0_0/0.92)] p-4 backdrop-blur-2xl shadow-[0_24px_80px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.12)]">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-base font-semibold">{tr("expand.title")}</span>
          <button
            type="button"
            aria-label={tc("cancel")}
            onClick={onClose}
            className="flex size-7 items-center justify-center rounded-full text-white/55 transition-colors hover:bg-white/[0.1] hover:text-white"
          >
            <IconX className="size-4" stroke={2} />
          </button>
        </div>

        {/* Aspect presets */}
        <div className="mb-3 flex flex-wrap gap-1.5">
          {PRESETS.map((p) => {
            const isActive =
              p.ratio === null
                ? margins.l === 0 && margins.t === 0 && margins.r === 0 && margins.b === 0
                : dims != null && Math.abs(activeRatio - p.ratio) < 0.01;
            return (
              <button
                key={p.key}
                type="button"
                disabled={!dims}
                onClick={() => {
                  if (!dims) return;
                  setMargins(p.ratio === null ? ZERO : marginsForRatio(dims.w, dims.h, p.ratio));
                }}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40",
                  isActive
                    ? "bg-white/[0.14] text-foreground"
                    : "bg-white/[0.05] text-muted-foreground hover:text-foreground"
                )}
              >
                {p.label ?? tr("expand.presetOriginal")}
              </button>
            );
          })}
        </div>

        <div className="flex gap-4">
          {/* Drag-frame stage */}
          <div
            className="relative shrink-0 overflow-hidden rounded-2xl bg-black/20"
            style={{ width: STAGE_W, height: STAGE_H }}
          >
            {!dims ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <IconLoader2 className="size-6 animate-spin text-white/50" stroke={1.8} />
              </div>
            ) : (
              <>
                {/* Canvas frame (the new area to fill) */}
                <div
                  className="absolute rounded-[2px] border border-dashed border-[#E52227]/80 bg-[#E52227]/[0.06]"
                  style={{ left: frameLeft, top: frameTop, width: frameW, height: frameH }}
                />
                {/* The original, pinned at centre */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={sourceUrl}
                  alt=""
                  draggable={false}
                  className="absolute select-none"
                  style={{
                    left: STAGE_W / 2 - ow / 2,
                    top: STAGE_H / 2 - oh / 2,
                    width: ow,
                    height: oh,
                  }}
                />
                {/* Handles */}
                {HANDLES.map((h) => (
                  <div
                    key={h.id}
                    onPointerDown={onHandleDown(h.id)}
                    className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-[2px] border border-white/70 bg-[#E52227] shadow"
                    style={{
                      left: frameLeft + h.fx * frameW,
                      top: frameTop + h.fy * frameH,
                      cursor: h.cursor,
                      touchAction: "none",
                    }}
                  />
                ))}
              </>
            )}
          </div>

          {/* Side column: readout + prompt */}
          <div className="flex flex-1 flex-col gap-3">
            <div className="text-sm text-muted-foreground">
              {tr("expand.dragHint")}
              {dims && (
                <span className="mt-1 block text-white/70 tabular-nums">
                  {dims.w}×{dims.h} → {canvasW}×{canvasH}
                </span>
              )}
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={tr("expand.promptPlaceholder")}
              rows={4}
              className="block w-full flex-1 resize-none rounded-lg bg-white/[0.06] p-2 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              setMargins(ZERO);
              setPrompt("");
            }}
            className="flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-white/55 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            <IconRefresh className="size-3.5" stroke={1.8} />
            {tr("reset")}
          </button>
          <div className="flex items-center gap-2">
            {cost != null && (
              <span className="flex items-center gap-1 px-1 text-sm text-white/70 tabular-nums">
                <IconBolt className="size-4" stroke={1.8} />
                {cost}
              </span>
            )}
            <button
              type="button"
              aria-label={tr("generate")}
              onClick={onRun}
              className="flex size-9 items-center justify-center rounded-full bg-[#E52227] text-white shadow-md shadow-[#E52227]/25 transition-colors hover:bg-[#c91e22]"
            >
              <IconArrowUp className="size-4" stroke={2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
