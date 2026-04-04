"use client";

import { Field, FieldLabel } from "@/components/ui/field";
import type { EditMode } from "./video-types";

export interface VideoModeSettingsProps {
  editMode: EditMode | null;
  controlCondition: string;
  onControlConditionChange: (value: string) => void;
  maskType: "tracking" | "fixed";
  onMaskTypeChange: (value: "tracking" | "fixed") => void;
  expandRatio: number;
  onExpandRatioChange: (value: number) => void;
  maskFrameId: string;
  onMaskFrameIdChange: (value: string) => void;
  outpaintingTop: number;
  outpaintingBottom: number;
  outpaintingLeft: number;
  outpaintingRight: number;
  onOutpaintingChange: (direction: "top" | "bottom" | "left" | "right", value: number) => void;
}

export function VideoModeSettings({
  editMode,
  controlCondition,
  onControlConditionChange,
  maskType,
  onMaskTypeChange,
  expandRatio,
  onExpandRatioChange,
  maskFrameId,
  onMaskFrameIdChange,
  outpaintingTop,
  outpaintingBottom,
  outpaintingLeft,
  outpaintingRight,
  onOutpaintingChange,
}: VideoModeSettingsProps) {
  if (editMode === "repaint") {
    return (
      <div className="flex flex-wrap items-center gap-3 border-t border-white/[0.06] px-4 py-3">
        <ToolbarSelect
          value={controlCondition}
          options={[
            { label: "姿态+肢体+面部", value: "posebodyface" },
            { label: "姿态+肢体", value: "posebody" },
            { label: "深度", value: "depth" },
            { label: "涂鸦", value: "scribble" },
          ]}
          onChange={onControlConditionChange}
        />
      </div>
    );
  }

  if (editMode === "localEdit") {
    return (
      <div className="flex flex-wrap items-center gap-3 border-t border-white/[0.06] px-4 py-3 text-xs text-muted-foreground">
        <Field orientation="horizontal" className="w-auto">
          <FieldLabel className="text-xs text-muted-foreground">掩码类型</FieldLabel>
          <select
            value={maskType}
            onChange={(event) => onMaskTypeChange(event.target.value as "tracking" | "fixed")}
            className="rounded-lg bg-white/[0.06] px-3 py-2 text-white/85 outline-none"
          >
            <option value="tracking">跟踪</option>
            <option value="fixed">固定</option>
          </select>
        </Field>
        {maskType === "tracking" ? (
          <Field orientation="horizontal" className="w-auto">
            <FieldLabel className="text-xs text-muted-foreground">扩展比例</FieldLabel>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={expandRatio}
              onChange={(event) => onExpandRatioChange(Number(event.target.value))}
            />
            <span>{expandRatio.toFixed(1)}</span>
          </Field>
        ) : null}
        <Field orientation="horizontal" className="w-auto">
          <FieldLabel className="text-xs text-muted-foreground">掩码帧</FieldLabel>
          <input
            type="number"
            min="0"
            value={maskFrameId}
            onChange={(event) => onMaskFrameIdChange(event.target.value)}
            placeholder="可选"
            className="w-24 rounded-lg bg-white/[0.06] px-3 py-2 text-white/85 outline-none"
          />
        </Field>
      </div>
    );
  }

  if (editMode === "outpainting") {
    const outpaintingControls: Array<{
      label: string;
      value: number;
      direction: "top" | "bottom" | "left" | "right";
    }> = [
      { label: "上", value: outpaintingTop, direction: "top" },
      { label: "下", value: outpaintingBottom, direction: "bottom" },
      { label: "左", value: outpaintingLeft, direction: "left" },
      { label: "右", value: outpaintingRight, direction: "right" },
    ];

    return (
      <div className="grid gap-3 border-t border-white/[0.06] px-4 py-3 text-xs text-muted-foreground sm:grid-cols-2">
        {outpaintingControls.map((item) => (
          <Field key={item.label} orientation="horizontal" className="w-auto">
            <FieldLabel className="w-6 text-xs text-muted-foreground">{item.label}</FieldLabel>
            <input
              type="range"
              min="1"
              max="2"
              step="0.1"
              value={item.value}
              onChange={(event) => onOutpaintingChange(item.direction, Number(event.target.value))}
              className="flex-1"
            />
            <span className="w-8 text-right text-white/80">{item.value.toFixed(1)}</span>
          </Field>
        ))}
      </div>
    );
  }

  return null;
}

export function ToolbarSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
}) {
  if (options.length === 0) return null;

  return (
    <div className="relative">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 appearance-none rounded-lg bg-white/[0.04] pl-3 pr-7 text-[13px] text-white/85 outline-none transition-colors hover:bg-white/[0.08] focus:bg-white/[0.08]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-white/50">
        ▼
      </span>
    </div>
  );
}
