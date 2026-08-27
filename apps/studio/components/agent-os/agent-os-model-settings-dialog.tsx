"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { FizzAiModel } from "@/lib/canvas-authoring/generation-api";
import { isOperationOnlyModel } from "@/lib/canvas-authoring/generation-api";
import { usableModelsByModality, useAiCatalog } from "@/lib/canvas-authoring/use-ai-catalog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FIELD_BUTTON, FIELD_CONTROL } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useAgentOsModelPreferences,
  useUpdateAgentOsModelPreferences,
} from "./use-agent-os-model-preferences";
import type { AgentOsModelPreferences } from "@/lib/agent-os/api-client";

const AUTOMATIC = "__automatic__";

export interface AgentOsChatModelOption {
  id: string;
  label: string;
  hint?: string;
}

interface AgentOsModelSettingsDialogProps {
  projectId: string;
  chatModels: AgentOsChatModelOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
  onSaved?: (preferences: AgentOsModelPreferences) => void;
}

/**
 * One product-level settings surface, backed by three deliberately separate
 * model domains. Saving a preference never turns a media model into an Agent
 * chat profile; the dialog only gives creators one predictable place to set
 * their project defaults across devices.
 */
export function AgentOsModelSettingsDialog({
  projectId,
  chatModels,
  open,
  onOpenChange,
  disabled = false,
  onSaved,
}: AgentOsModelSettingsDialogProps) {
  const t = useTranslations("agentOs.modelSettings");
  const preferences = useAgentOsModelPreferences(projectId);
  const catalog = useAiCatalog();
  const imageModels = useMemo(() => generationModels(catalog.data, "image"), [catalog.data]);
  const videoModels = useMemo(() => generationModels(catalog.data, "video"), [catalog.data]);

  const loading = preferences.isPending || catalog.isPending;
  const failed = preferences.isError || catalog.isError;
  const loadError = preferences.error ?? catalog.error;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="liquid-rim w-[min(520px,calc(100vw-24px))] max-w-none gap-5 bg-[oklch(0.18_0_0_/_0.98)] p-5 ring-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_28px_90px_rgba(0,0,0,0.68)] backdrop-blur-[36px]">
        <DialogHeader className="pr-8">
          <DialogTitle className="text-base">{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        {failed ? (
          <div
            role="alert"
            className="rounded-xl bg-red-500/[0.09] px-3 py-2 text-xs text-red-100/80"
          >
            {errorMessage(loadError, t("loadFailed"))}
          </div>
        ) : preferences.data ? (
          <ModelSettingsForm
            key={preferences.data.version}
            projectId={projectId}
            preferences={preferences.data}
            chatModels={chatModels}
            imageModels={imageModels}
            videoModels={videoModels}
            disabled={disabled || loading}
            onCancel={() => onOpenChange(false)}
            onSaved={(next) => {
              onSaved?.(next);
              onOpenChange(false);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ModelSettingsForm({
  projectId,
  preferences,
  chatModels,
  imageModels,
  videoModels,
  disabled,
  onCancel,
  onSaved,
}: {
  projectId: string;
  preferences: AgentOsModelPreferences;
  chatModels: AgentOsChatModelOption[];
  imageModels: Array<{ id: string; name: string }>;
  videoModels: Array<{ id: string; name: string }>;
  disabled: boolean;
  onCancel: () => void;
  onSaved: (preferences: AgentOsModelPreferences) => void;
}) {
  const t = useTranslations("agentOs.modelSettings");
  const updatePreferences = useUpdateAgentOsModelPreferences(projectId);
  const [chatModelProfileId, setChatModelProfileId] = useState(
    preferences.chatModelProfileId ?? AUTOMATIC
  );
  const [imageModelId, setImageModelId] = useState(preferences.imageModelId ?? AUTOMATIC);
  const [videoModelId, setVideoModelId] = useState(preferences.videoModelId ?? AUTOMATIC);

  const save = async () => {
    if (disabled) return;
    const next = await updatePreferences.mutateAsync({
      expectedVersion: preferences.version,
      chatModelProfileId: nullableSelection(chatModelProfileId),
      imageModelId: nullableSelection(imageModelId),
      videoModelId: nullableSelection(videoModelId),
    });
    onSaved(next);
  };

  return (
    <>
      <div className="grid gap-4">
        <ModelField
          label={t("conversationModel")}
          hint={t("conversationModelHint")}
          value={chatModelProfileId}
          onValueChange={setChatModelProfileId}
          options={chatModels.map((model) => ({ id: model.id, name: model.label }))}
          automaticLabel={t("automatic")}
          disabled={disabled}
        />
        <ModelField
          label={t("imageModel")}
          hint={t("imageModelHint")}
          value={imageModelId}
          onValueChange={setImageModelId}
          options={imageModels}
          automaticLabel={t("automatic")}
          disabled={disabled}
        />
        <ModelField
          label={t("videoModel")}
          hint={t("videoModelHint")}
          value={videoModelId}
          onValueChange={setVideoModelId}
          options={videoModels}
          automaticLabel={t("automatic")}
          disabled={disabled}
        />
        <p className="text-[11px]/relaxed text-white/42">{t("automaticHint")}</p>
      </div>

      {updatePreferences.isError ? (
        <div
          role="alert"
          className="rounded-xl bg-red-500/[0.09] px-3 py-2 text-xs text-red-100/80"
        >
          {errorMessage(updatePreferences.error, t("saveFailed"))}
        </div>
      ) : null}

      <DialogFooter>
        <Button variant="secondary" className={FIELD_BUTTON} onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button
          className={FIELD_BUTTON}
          loading={updatePreferences.isPending}
          disabled={disabled}
          onClick={() => void save()}
        >
          {updatePreferences.isPending ? t("saving") : t("save")}
        </Button>
      </DialogFooter>
    </>
  );
}

function ModelField({
  label,
  hint,
  value,
  onValueChange,
  options,
  automaticLabel,
  disabled,
}: {
  label: string;
  hint: string;
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ id: string; name: string }>;
  automaticLabel: string;
  disabled: boolean;
}) {
  return (
    <Field label={label} hint={hint} dense>
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger className={`${FIELD_CONTROL} w-full bg-white/[0.055]`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" align="start" className="max-h-72">
          <SelectItem value={AUTOMATIC}>{automaticLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function generationModels(
  catalog: Parameters<typeof usableModelsByModality>[0],
  modality: "image" | "video"
): Array<{ id: string; name: string }> {
  return usableModelsByModality(catalog, modality)
    .filter(
      (model: FizzAiModel) => !isOperationOnlyModel(model) && !/hunyuan|panorama/i.test(model.id)
    )
    .map((model) => ({ id: model.id, name: model.name }));
}

function nullableSelection(value: string): string | null {
  return value === AUTOMATIC ? null : value;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}
