import { useTranslations } from "@/src/i18n/i18n";
import { Field, FieldLabel } from "@/components/ui/field";
import { ToolbarSelect } from "@/components/ui/schema-field/toolbar-select";
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
  const t = useTranslations("storyboard");
  if (editMode === "repaint") {
    return (
      <div className="flex flex-wrap items-center gap-3 border-t border-white/[0.06] px-4 py-3">
        <ToolbarSelect
          value={controlCondition}
          options={[
            { label: t("posebodyface"), value: "posebodyface" },
            { label: t("posebody"), value: "posebody" },
            { label: t("depth"), value: "depth" },
            { label: t("scribble"), value: "scribble" },
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
          <FieldLabel className="text-xs text-muted-foreground">{t("maskTypeLabel")}</FieldLabel>
          <select
            value={maskType}
            onChange={(event) => onMaskTypeChange(event.target.value as "tracking" | "fixed")}
            className="rounded-lg bg-white/[0.06] px-3 py-2 text-white/85 outline-none"
          >
            <option value="tracking">{t("tracking")}</option>
            <option value="fixed">{t("fixed")}</option>
          </select>
        </Field>
        {maskType === "tracking" ? (
          <Field orientation="horizontal" className="w-auto">
            <FieldLabel className="text-xs text-muted-foreground">
              {t("expandRatioLabel")}
            </FieldLabel>
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
          <FieldLabel className="text-xs text-muted-foreground">{t("maskFrameLabel")}</FieldLabel>
          <input
            type="number"
            min="0"
            value={maskFrameId}
            onChange={(event) => onMaskFrameIdChange(event.target.value)}
            placeholder={t("optional")}
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
      { label: t("top"), value: outpaintingTop, direction: "top" },
      { label: t("bottom"), value: outpaintingBottom, direction: "bottom" },
      { label: t("left"), value: outpaintingLeft, direction: "left" },
      { label: t("right"), value: outpaintingRight, direction: "right" },
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

export { ToolbarSelect } from "@/components/ui/schema-field/toolbar-select";
