"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { QuickParamChips } from "@/components/canvas/authoring/quick-param-chips";
import { ModelSettings as ModelSettingsPanel } from "@/components/canvas/authoring/model-settings";
import { Field } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  defaultMode,
  enumOptions,
  type FizzAiModel,
  type ModelSettings,
} from "@/lib/canvas-authoring/generation-api";
import {
  applyOmniModeSelection,
  lockedSettingFields,
  menuValueForMode,
  modeMenuValues,
  OMNI_TASK_TYPE_FIELD,
} from "@/lib/canvas-authoring/omni-task-modes";
import { useComposerModeLabel } from "@/lib/canvas-authoring/use-labels";

/**
 * Clip-inspector generation knobs. Same catalog contract as the canvas
 * composer: mode menu (including Seedance omni task types), quick chips, then
 * the remaining schema-driven settings. Task-type locks hide the chips the
 * provider owns.
 */
export function StoryClipGenerationFields({
  models,
  model,
  onSelectModel,
  settings,
  onSettingsChange,
  mode,
  onSelectMode,
  disabled,
  loading,
}: {
  models: FizzAiModel[];
  model: FizzAiModel | undefined;
  onSelectModel: (model: FizzAiModel) => void;
  settings: ModelSettings;
  onSettingsChange: (next: ModelSettings) => void;
  mode: string | undefined;
  onSelectMode: (mode: string) => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const t = useTranslations("storyStudio.editorPage.inspectorForm");
  const tg = useTranslations("generation");
  const cl = useComposerModeLabel();
  const modes = model?.generationModes ?? [];
  const omniTaskTypes = model ? enumOptions(model, OMNI_TASK_TYPE_FIELD) : null;
  const omniTaskValue =
    typeof settings.omniReferenceTaskType === "string" ? settings.omniReferenceTaskType : "auto";
  const menuModes = modeMenuValues(modes, omniTaskTypes);
  const menuValue = menuValueForMode(mode ?? defaultMode(model), omniTaskValue);
  const lockedFields = useMemo(() => {
    const locked = lockedSettingFields(omniTaskValue);
    return new Set([...locked, OMNI_TASK_TYPE_FIELD]);
  }, [omniTaskValue]);
  const showMode = menuModes.length > 1;

  return (
    <>
      <Field dense required label={t("model")}>
        <Select
          value={model?.id ?? ""}
          onValueChange={(value) => {
            const next = models.find((candidate) => candidate.id === value);
            if (next) onSelectModel(next);
          }}
          disabled={disabled || loading || !model}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={loading ? t("loadingModels") : t("noModels")} />
          </SelectTrigger>
          <SelectContent>
            {models.map((candidate) => (
              <SelectItem key={candidate.id} value={candidate.id}>
                {candidate.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {showMode ? (
        <Field dense required label={tg("mode")}>
          <Select
            value={menuValue ?? ""}
            onValueChange={(value) => {
              const next = applyOmniModeSelection(value, settings);
              onSettingsChange(next.settings);
              onSelectMode(next.mode);
            }}
            disabled={disabled || loading || !model}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {menuModes.map((value) => (
                <SelectItem key={value} value={value}>
                  {cl(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}
      <QuickParamChips
        model={model}
        settings={settings}
        onChange={onSettingsChange}
        excludedFieldNames={[...lockedFields]}
      />
      <ModelSettingsPanel
        model={model}
        settings={settings}
        onChange={onSettingsChange}
        hideQuickFields
        lockedFields={lockedFields}
        presentation="inline"
      />
    </>
  );
}
