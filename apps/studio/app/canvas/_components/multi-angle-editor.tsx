"use client";

import { useMemo, useState } from "react";
import { useStore } from "@xyflow/react";
import { IconArrowUp, IconBolt, IconRefresh, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAiCatalog } from "@/app/canvas/_lib/use-ai-catalog";
import {
  defaultSettingsForModel,
  estimateModelSellPoints,
  type ModelSettings,
} from "@/app/canvas/_lib/generation-api";
import { MULTI_ANGLE_OP, useSpawnOperationResult } from "./operation-confirm-bar";
import { OrbitSphere } from "./orbit-sphere";

const AZIMUTH = { min: 0, max: 360 };
const ELEVATION = { min: -30, max: 90 };
const ZOOM = { min: 0, max: 10 };

/** Viewpoint presets — combos of the real model params (orbit / tilt / zoom). */
const PRESETS: { label: string; h: number; v: number; z: number }[] = [
  { label: "Front", h: 0, v: 0, z: 5 },
  { label: "Three-quarter", h: 45, v: 10, z: 5 },
  { label: "Right", h: 90, v: 0, z: 5 },
  { label: "Back", h: 180, v: 0, z: 5 },
  { label: "Left", h: 270, v: 0, z: 5 },
  { label: "Low angle", h: 0, v: -30, z: 5 },
  { label: "Top-down", h: 0, v: 90, z: 2 },
];

/** Shot-size word for a zoom value (0 wide … 10 close-up). */
function shotSize(zoom: number): string {
  if (zoom <= 3.33) return "Wide";
  if (zoom <= 6.66) return "Medium";
  return "Close-up";
}

function Slider({
  label,
  value,
  min,
  max,
  readout,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  readout: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-sm text-white/80 tabular-nums">{readout}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[#E52227]"
      />
    </div>
  );
}

/**
 * Multi-Angle editor — a bespoke operation surface (vs the inline confirm bar)
 * shown under the source node. An interactive orbit sphere + sliders drive the
 * model's real camera params (horizontal orbit / vertical tilt / shot-size
 * zoom), with viewpoint presets and an optional refine prompt. Generate spawns
 * the locked result card (before/after slider), wired from the source.
 */
export function MultiAngleEditor({
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
  const model = useMemo(() => MULTI_ANGLE_OP.findModel(catalog), [catalog]);

  const [overrides, setOverrides] = useState<ModelSettings>({});
  const settings = useMemo<ModelSettings>(
    () => ({ ...defaultSettingsForModel(model), ...overrides }),
    [model, overrides]
  );
  const azimuth = Number(settings.horizontalAngle ?? 0) || 0;
  const elevation = Number(settings.verticalAngle ?? 0) || 0;
  const shot = Number(settings.zoom ?? 5);
  const numOutputs = Number(settings.numOutputs ?? 1) || 1;

  const [promptOn, setPromptOn] = useState(false);
  const [prompt, setPrompt] = useState("");

  const set = (patch: ModelSettings) => setOverrides((o) => ({ ...o, ...patch }));

  const activePreset = PRESETS.find((p) => p.h === azimuth && p.v === elevation && p.z === shot);

  const cost = useMemo(
    () => (model ? (estimateModelSellPoints(model, { numOutputs })?.sellPoints ?? null) : null),
    [model, numOutputs]
  );

  const onRun = () => {
    if (!model) {
      toast.error("No multi-angle model in the catalog yet");
      return;
    }
    const finalSettings: ModelSettings = {
      horizontalAngle: azimuth,
      verticalAngle: elevation,
      zoom: shot,
      numOutputs,
    };
    if (promptOn && prompt.trim()) finalSettings.additionalPrompt = prompt.trim();
    spawnResult({ op: MULTI_ANGLE_OP, model, sourceNodeId, sourceUrl, settings: finalSettings });
    onClose();
  };

  return (
    <div
      className="absolute top-full left-1/2 z-10 mt-3 duration-200 animate-in fade-in-0 slide-in-from-bottom-3"
      style={{ transform: `translateX(-50%) scale(${1 / zoom})`, transformOrigin: "top center" }}
    >
      <div className="nodrag nowheel w-[640px] rounded-3xl bg-white/[0.05] p-4 backdrop-blur-3xl backdrop-saturate-200 shadow-[0_24px_80px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.16)]">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-base font-semibold">Multi-Angle</span>
          <button
            type="button"
            aria-label="Cancel"
            onClick={onClose}
            className="flex size-7 items-center justify-center rounded-full text-white/55 transition-colors hover:bg-white/[0.1] hover:text-white"
          >
            <IconX className="size-4" stroke={2} />
          </button>
        </div>

        {/* Viewpoint presets */}
        <div className="mb-3 flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => set({ horizontalAngle: p.h, verticalAngle: p.v, zoom: p.z })}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                activePreset?.label === p.label
                  ? "bg-white/[0.14] text-foreground"
                  : "bg-white/[0.05] text-muted-foreground hover:text-foreground"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex gap-4">
          {/* Interactive orbit sphere */}
          <OrbitSphere
            src={sourceUrl}
            azimuth={azimuth}
            elevation={elevation}
            minElevation={ELEVATION.min}
            maxElevation={ELEVATION.max}
            onChange={(h, v) => set({ horizontalAngle: h, verticalAngle: v })}
            className="aspect-square w-[240px] shrink-0 rounded-2xl bg-black/20"
          />

          {/* Sliders */}
          <div className="flex flex-1 flex-col justify-center gap-4">
            <Slider
              label="Horizontal orbit"
              value={azimuth}
              min={AZIMUTH.min}
              max={AZIMUTH.max}
              readout={`${azimuth}°`}
              onChange={(v) => set({ horizontalAngle: v })}
            />
            <Slider
              label="Vertical tilt"
              value={elevation}
              min={ELEVATION.min}
              max={ELEVATION.max}
              readout={`${elevation}°`}
              onChange={(v) => set({ verticalAngle: v })}
            />
            <Slider
              label="Shot size"
              value={shot}
              min={ZOOM.min}
              max={ZOOM.max}
              readout={shotSize(shot)}
              onChange={(v) => set({ zoom: v })}
            />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Prompt</span>
              <button
                type="button"
                role="switch"
                aria-checked={promptOn}
                onClick={() => setPromptOn((v) => !v)}
                className={cn(
                  "flex h-6 w-10 items-center rounded-full p-0.5 transition-colors",
                  promptOn ? "bg-white/80" : "bg-white/[0.12]"
                )}
              >
                <span
                  className={cn(
                    "size-5 rounded-full transition-transform",
                    promptOn ? "translate-x-4 bg-background" : "translate-x-0 bg-white/70"
                  )}
                />
              </button>
            </div>
            {promptOn && (
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Optional: refine the new view.."
                rows={2}
                className="block w-full resize-none rounded-lg bg-white/[0.06] p-2 text-sm outline-none placeholder:text-muted-foreground"
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              setOverrides({});
              setPromptOn(false);
              setPrompt("");
            }}
            className="flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-white/55 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            <IconRefresh className="size-3.5" stroke={1.8} />
            Reset
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
              aria-label="Generate"
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
