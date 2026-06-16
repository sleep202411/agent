"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@xyflow/react";
import {
  IconArrowUp,
  IconBolt,
  IconBrush,
  IconEraser,
  IconLoader2,
  IconRefresh,
  IconRoute,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { isUploadAbort, uploadFileViaSignedUrl } from "@/lib/media-upload";
import { useAiCatalog } from "@/app/canvas/_lib/use-ai-catalog";
import { estimateModelSellPoints, type ModelSettings } from "@/app/canvas/_lib/generation-api";
import { MOTION_OP, useSpawnOperationResult } from "./operation-confirm-bar";

type Tool = "brush" | "erase" | "path";
type Pt = { x: number; y: number };

const MAX_W = 360;
const MAX_H = 320;
const MIN_DIM = 300; // Kling i2v rejects inputs smaller than 300×300.
const MIN_PATH_GAP = 6; // display px between captured trajectory points
const MAX_TRAJECTORY = 64; // Kling allows 2–77 trajectory points; stay safely under.
const DURATIONS = ["5", "10"] as const;

/** Evenly thin `pts` to at most `max` items, always keeping the first + last. */
function downsample<T>(pts: T[], max: number): T[] {
  if (pts.length <= max) return pts;
  const step = (pts.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => pts[Math.round(i * step)]);
}

/**
 * Motion editor (Kling i2v motion brush) — a bespoke surface shown under the
 * source node. Two on-image tools: a BRUSH to paint the region that should move
 * (rendered to a mask PNG and uploaded → mask_url) and a PATH to draw the
 * trajectory it follows (→ {x,y} points). With a required prompt + duration,
 * Generate spawns a locked video result that animates the masked region along
 * the path.
 */
export function MotionEditor({
  sourceNodeId,
  sourceUrl,
  onClose,
}: {
  sourceNodeId: string;
  sourceUrl: string;
  onClose: () => void;
}) {
  const { data: catalog } = useAiCatalog();
  const spawnResult = useSpawnOperationResult();
  const zoom = useStore((s) => s.transform[2]);
  const model = useMemo(() => MOTION_OP.findModel(catalog), [catalog]);

  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [tool, setTool] = useState<Tool>("brush");
  const [brushSize, setBrushSize] = useState(36); // display px
  const [path, setPath] = useState<Pt[]>([]); // display coords
  const [painted, setPainted] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState<(typeof DURATIONS)[number]>("5");
  const [submitting, setSubmitting] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const maskRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const lastPaint = useRef<Pt | null>(null);

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

  // Fit the image into the stage box (preserve aspect).
  const fit = dims ? Math.min(MAX_W / dims.w, MAX_H / dims.h, 1) : 1;
  const displayW = dims ? Math.round(dims.w * fit) : MAX_W;
  const displayH = dims ? Math.round(dims.h * fit) : MAX_H;
  // Natural pixels per display pixel (mask canvas + trajectories are natural-res).
  const scale = dims ? dims.w / displayW : 1;

  const cost = useMemo(
    () =>
      model
        ? (estimateModelSellPoints(model, { durationSeconds: Number(duration) })?.sellPoints ??
          null)
        : null,
    [model, duration]
  );

  const stagePoint = (e: React.PointerEvent): Pt => {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const paintTo = (p: Pt) => {
    const ctx = maskRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.globalCompositeOperation = tool === "erase" ? "destination-out" : "source-over";
    ctx.strokeStyle = "#fff";
    ctx.fillStyle = "#fff";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = brushSize * scale;
    const nx = p.x * scale;
    const ny = p.y * scale;
    if (lastPaint.current) {
      ctx.beginPath();
      ctx.moveTo(lastPaint.current.x, lastPaint.current.y);
      ctx.lineTo(nx, ny);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(nx, ny, (brushSize * scale) / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    lastPaint.current = { x: nx, y: ny };
    if (tool !== "erase") setPainted(true);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!dims) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drawing.current = true;
    const p = stagePoint(e);
    if (tool === "path") {
      setPath([p]); // a fresh trajectory each draw
    } else {
      lastPaint.current = null;
      paintTo(p);
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const p = stagePoint(e);
    if (tool === "path") {
      setPath((pts) => {
        const last = pts[pts.length - 1];
        if (last && Math.hypot(p.x - last.x, p.y - last.y) < MIN_PATH_GAP) return pts;
        return [...pts, p];
      });
    } else {
      paintTo(p);
    }
  };
  const onPointerUp = () => {
    drawing.current = false;
    lastPaint.current = null;
  };

  const reset = () => {
    const ctx = maskRef.current?.getContext("2d");
    if (ctx && dims) ctx.clearRect(0, 0, dims.w, dims.h);
    setPainted(false);
    setPath([]);
    setPrompt("");
  };

  const exportMaskBlob = () =>
    new Promise<Blob>((resolve, reject) => {
      const mask = maskRef.current;
      if (!mask || !dims) return reject(new Error("no mask"));
      const off = document.createElement("canvas");
      off.width = dims.w;
      off.height = dims.h;
      const ctx = off.getContext("2d");
      if (!ctx) return reject(new Error("no ctx"));
      // Kling expects a white-on-black mask: the painted (white) region marks
      // where motion applies.
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, dims.w, dims.h);
      ctx.drawImage(mask, 0, 0);
      off.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
    });

  const onRun = async () => {
    if (!model || !dims) {
      toast.error("No motion model in the catalog yet");
      return;
    }
    // Requirements are enforced inline (the Generate button is disabled until
    // `missing` clears), so by here region + path + prompt are all present.
    setSubmitting(true);
    try {
      const blob = await exportMaskBlob();
      const file = new File([blob], "motion-mask.png", { type: "image/png" });
      const { url: maskUrl } = await uploadFileViaSignedUrl(file, {
        kind: "ai_reference_image",
        contentType: "image/png",
      });
      // Kling caps a trajectory at 77 points — a freehand path can capture more,
      // so downsample evenly (keeping the first + last) to stay within range.
      const trajectories = downsample(path, MAX_TRAJECTORY).map((p) => ({
        x: Math.round(p.x * scale),
        y: Math.round(p.y * scale),
      }));
      const settings: ModelSettings = {
        dynamicMasks: [{ mask_url: maskUrl, trajectories }],
        duration,
      };
      spawnResult({
        op: MOTION_OP,
        model,
        sourceNodeId,
        sourceUrl,
        settings,
        prompt: prompt.trim(),
      });
      onClose();
    } catch (err) {
      setSubmitting(false);
      if (!isUploadAbort(err)) toast.error("Couldn't prepare the motion mask");
    }
  };

  const TOOLS: { id: Tool; label: string; hint: string; Icon: typeof IconBrush }[] = [
    {
      id: "brush",
      label: "Region",
      hint: "Paint the part of the image that should move",
      Icon: IconBrush,
    },
    { id: "erase", label: "Erase", hint: "Remove from the painted region", Icon: IconEraser },
    { id: "path", label: "Path", hint: "Draw the path that region follows", Icon: IconRoute },
  ];

  // The next still-needed step, shown inline by the Generate button and used to
  // gate it — no disconnected error toasts. Dimensions first: Kling rejects
  // inputs under 300×300, so catch it here instead of after a wasted submit.
  const tooSmall = dims != null && (dims.w < MIN_DIM || dims.h < MIN_DIM);
  const missing = tooSmall
    ? `Image is too small (min ${MIN_DIM}×${MIN_DIM})`
    : !painted
      ? "Brush the region that should move"
      : path.length < 2
        ? "Draw the motion path"
        : !prompt.trim()
          ? "Add a prompt"
          : null;

  return (
    <div
      className="absolute top-full left-1/2 z-10 mt-3 duration-200 animate-in fade-in-0 slide-in-from-bottom-3"
      style={{ transform: `translateX(-50%) scale(${1 / zoom})`, transformOrigin: "top center" }}
    >
      <div className="nodrag nowheel w-[600px] rounded-3xl bg-[oklch(0.2_0_0/0.92)] p-4 backdrop-blur-2xl shadow-[0_24px_80px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.12)]">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-base font-semibold">Motion</span>
          <button
            type="button"
            aria-label="Cancel"
            onClick={onClose}
            className="flex size-7 items-center justify-center rounded-full text-white/55 transition-colors hover:bg-white/[0.1] hover:text-white"
          >
            <IconX className="size-4" stroke={2} />
          </button>
        </div>

        {/* Tools */}
        <div className="mb-3 flex items-center gap-3">
          <div className="flex gap-1.5">
            {TOOLS.map(({ id, label, hint, Icon }) => (
              <button
                key={id}
                type="button"
                title={hint}
                onClick={() => setTool(id)}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
                  tool === id
                    ? "bg-white/[0.14] text-foreground"
                    : "bg-white/[0.05] text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="size-3.5" stroke={1.8} />
                {label}
              </button>
            ))}
          </div>
          {tool !== "path" && (
            <label className="flex flex-1 items-center gap-2 text-xs text-muted-foreground">
              Size
              <input
                type="range"
                min={10}
                max={90}
                value={brushSize}
                onChange={(e) => setBrushSize(Number(e.target.value))}
                className="w-full accent-[#E52227]"
              />
            </label>
          )}
          {tool === "path" && path.length > 0 && (
            <button
              type="button"
              onClick={() => setPath([])}
              className="text-xs text-white/55 transition-colors hover:text-white"
            >
              Clear path
            </button>
          )}
        </div>

        <div className="flex gap-4">
          {/* Stage */}
          <div
            ref={stageRef}
            className="relative shrink-0 overflow-hidden rounded-2xl bg-black/20"
            style={{ width: displayW, height: displayH }}
          >
            {!dims ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <IconLoader2 className="size-6 animate-spin text-white/50" stroke={1.8} />
              </div>
            ) : (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={sourceUrl}
                  alt=""
                  draggable={false}
                  className="absolute inset-0 size-full select-none"
                />
                <canvas
                  ref={maskRef}
                  width={dims.w}
                  height={dims.h}
                  className="pointer-events-none absolute inset-0 size-full opacity-50"
                />
                <svg
                  className="pointer-events-none absolute inset-0 size-full"
                  width={displayW}
                  height={displayH}
                >
                  <defs>
                    <marker
                      id="motion-arrow"
                      viewBox="0 0 10 10"
                      refX="8"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M0 0 L10 5 L0 10 z" fill="#E52227" />
                    </marker>
                  </defs>
                  {path.length >= 2 && (
                    <polyline
                      points={path.map((p) => `${p.x},${p.y}`).join(" ")}
                      fill="none"
                      stroke="#E52227"
                      strokeWidth={2.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      markerEnd="url(#motion-arrow)"
                    />
                  )}
                  {path[0] && (
                    <circle
                      cx={path[0].x}
                      cy={path[0].y}
                      r={4}
                      fill="#fff"
                      stroke="#E52227"
                      strokeWidth={1.5}
                    />
                  )}
                </svg>
                <div
                  className="absolute inset-0 touch-none"
                  style={{ cursor: "crosshair" }}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                />
              </>
            )}
          </div>

          {/* Side column */}
          <div className="flex flex-1 flex-col gap-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Brush the region that should move, then draw the path it follows.
            </p>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the motion, e.g. “the boar walks to the left”"
              rows={3}
              className="block w-full resize-none rounded-lg bg-white/[0.06] p-2 text-sm outline-none placeholder:text-muted-foreground"
            />
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Length</span>
              <div className="flex gap-1.5">
                {DURATIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDuration(d)}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                      duration === d
                        ? "bg-white/[0.14] text-foreground"
                        : "bg-white/[0.05] text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {d}s
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={reset}
            className="flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-white/55 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            <IconRefresh className="size-3.5" stroke={1.8} />
            Reset
          </button>
          <div className="flex items-center gap-2.5">
            {missing && <span className="text-xs text-white/45">{missing}</span>}
            {cost != null && (
              <span className="flex items-center gap-1 px-1 text-sm text-white/70 tabular-nums">
                <IconBolt className="size-4" stroke={1.8} />
                {cost}
              </span>
            )}
            <button
              type="button"
              aria-label="Generate"
              disabled={submitting || missing != null}
              onClick={onRun}
              className="flex size-9 items-center justify-center rounded-full bg-[#E52227] text-white shadow-md shadow-[#E52227]/25 transition-colors hover:bg-[#c91e22] disabled:opacity-50"
            >
              {submitting ? (
                <IconLoader2 className="size-4 animate-spin" stroke={2} />
              ) : (
                <IconArrowUp className="size-4" stroke={2} />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
