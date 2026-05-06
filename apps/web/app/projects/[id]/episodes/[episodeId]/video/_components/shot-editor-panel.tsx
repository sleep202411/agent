"use client";

import { useEffect, useMemo, useState } from "react";
import { IconLoader2, IconSparkles } from "@tabler/icons-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ToolbarSelect } from "@/components/ui/schema-field/toolbar-select";
import { calcModelCost, type AiModel } from "@/components/ui/schema-field/schema";
import { AI_MODEL_PATHS } from "@/components/ui/schema-field/paths";
import { useAiModels, useEnsureAiModels } from "@/src/hooks/use-ai-models";
import { RichMentionEditor } from "@/app/projects/_components/storyboard/editor/rich-mention-editor";
import {
  saveProduceShotTextCell,
  type ProduceJavaAssetLists,
  type ProduceShotColumn,
} from "@/src/lib/produce/java-produce-data";
import type { ShotRow } from "@/src/store/slices/projectSlice";
import {
  buildMentionItems,
  displayPlainText,
  getCell,
  getMediaPath,
  getText,
  updateRowCell,
} from "../_lib/shot-helpers";
import { useGenerateShotVideo } from "../_hooks/use-generate-shot-video";

interface ShotEditorPanelProps {
  selectedRow: ShotRow | null;
  promptColumn: ProduceShotColumn | null;
  videoColumn: ProduceShotColumn | null;
  imageColumn: ProduceShotColumn | null;
  durationColumn: ProduceShotColumn | null;
  assets: ProduceJavaAssetLists;
  setRows: React.Dispatch<React.SetStateAction<ShotRow[]>>;
  reload: () => Promise<void> | void;
}

/** Pull `enum` + `x-enum-labels` off a model's input schema and shape
 *  it for `ToolbarSelect`. Returns an empty array when the model
 *  doesn't expose that field — the select will then render nothing. */
function readEnumOptions(
  model: AiModel | null,
  field: "size" | "videoLength" | "ratio"
): { label: string; value: string }[] {
  const schema = model?.inputSchema?.properties?.[field];
  if (!schema?.enum) return [];
  const labels = schema["x-enum-labels"] ?? {};
  return schema.enum.map((value) => ({
    label: labels[String(value)] ?? `${value}${field === "videoLength" ? "s" : ""}`,
    value: String(value),
  }));
}

function readSchemaDefault(model: AiModel | null, field: "size" | "videoLength" | "ratio"): string {
  const fallback = model?.inputSchema?.properties?.[field]?.default;
  return fallback != null ? String(fallback) : "";
}

/**
 * Single-model whitelist for the produce video editor — pinning to
 * `wan2.6-i2v-flash-free` keeps quality consistent across the wizard
 * and rules out accidental drift to a paid / different provider
 * while we stabilise the pipeline. Loosen this (or move to a
 * per-tier config) once the model menu is well understood by users.
 */
const ALLOWED_MODEL_IDS = ["wan2.6-i2v-flash-free"] as const;

/**
 * Prompt editor + model / size / length toolbar + GenerateButton.
 *
 * Models come from the sync-video endpoint's slice of the
 * preloaded AI model cache (`AI_MODEL_PATHS.videoSync`). Default
 * model is whichever has `isDefault` (or the first in the list);
 * its inputSchema seeds the size / videoLength / ratio defaults.
 *
 * Cost displayed on the GenerateButton is computed via
 * `calcModelCost` and tracks the current selection live.
 */
export function ShotEditorPanel({
  selectedRow,
  promptColumn,
  videoColumn,
  imageColumn,
  durationColumn,
  assets,
  setRows,
  reload,
}: ShotEditorPanelProps) {
  const selectedShotId = String(selectedRow?.shotId ?? "");
  const promptValue = getText(getCell(selectedRow, promptColumn));
  const startImagePath = getMediaPath(getCell(selectedRow, imageColumn));
  const shotDuration = getText(getCell(selectedRow, durationColumn));
  const mentionItems = useMemo(() => buildMentionItems(assets), [assets]);

  // Sync and async basic-video endpoints share the same provider
  // model registry on Java; only the async path is reliably indexed
  // by `/api/ai/record/model/list` though, so we read from that
  // cache and pass the chosen model id straight to the sync gen.
  // The non-workspace route doesn't trigger the global preload
  // (which is gated on `currentProjectId` Redux state), so we
  // explicitly fire a targeted fetch for this single path.
  useEnsureAiModels(AI_MODEL_PATHS.video);
  const { models: allModels, loading: modelsLoading } = useAiModels(AI_MODEL_PATHS.video);
  const models = useMemo(
    () => allModels.filter((m) => (ALLOWED_MODEL_IDS as readonly string[]).includes(m.id)),
    [allModels]
  );

  // Local toolbar state. Initialised once models arrive (or when
  // the user switches model — handled in `handleModelChange`).
  const [modelId, setModelId] = useState("");
  const [size, setSize] = useState("");
  const [videoLength, setVideoLength] = useState("");
  const [ratio, setRatio] = useState("");

  const currentModel = useMemo(
    () => models.find((m) => m.id === modelId) ?? null,
    [models, modelId]
  );

  // TEMP: log what the model registry returned so we can verify
  // the whitelist actually matches an entry Java registers.
  // Remove once the picker is stable.
  useEffect(() => {
    console.log("[shot-editor] models:", {
      loading: modelsLoading,
      total: allModels.length,
      allIds: allModels.map((m) => m.id),
      whitelisted: models.length,
      whitelistedIds: models.map((m) => m.id),
    });
  }, [allModels, models, modelsLoading]);

  // Auto-pick the default model + apply its schema defaults the
  // first time models land. We don't overwrite later selections.
  useEffect(() => {
    if (modelId || models.length === 0) return;
    const defaultModel = models.find((m) => m.isDefault) ?? models[0];
    setModelId(defaultModel.id);
    setSize(readSchemaDefault(defaultModel, "size"));
    const lengthFallback = readSchemaDefault(defaultModel, "videoLength");
    // Prefer the row's own duration column when set — keeps editor
    // consistent with whatever the script writer / planner picked.
    setVideoLength(shotDuration || lengthFallback);
    setRatio(readSchemaDefault(defaultModel, "ratio"));
  }, [modelId, models, shotDuration]);

  const handleModelChange = (nextModelId: string) => {
    setModelId(nextModelId);
    const next = models.find((m) => m.id === nextModelId) ?? null;
    setSize(readSchemaDefault(next, "size"));
    setVideoLength(shotDuration || readSchemaDefault(next, "videoLength"));
    setRatio(readSchemaDefault(next, "ratio"));
  };

  const modelOptions = useMemo(() => models.map((m) => ({ label: m.name, value: m.id })), [models]);
  const sizeOptions = useMemo(() => readEnumOptions(currentModel, "size"), [currentModel]);
  const lengthOptions = useMemo(() => readEnumOptions(currentModel, "videoLength"), [currentModel]);
  const ratioOptions = useMemo(() => readEnumOptions(currentModel, "ratio"), [currentModel]);

  const cost = useMemo(
    () => calcModelCost(currentModel, { size, videoLength, count: 1 }),
    [currentModel, size, videoLength]
  );

  const { generate, generating } = useGenerateShotVideo({
    onSuccess: () => {
      void reload();
    },
  });

  if (!promptColumn) return null;

  const saveTextCell = async (value: string) => {
    if (!selectedShotId || !promptColumn.id) return;
    setRows((current) => updateRowCell(current, selectedShotId, promptColumn.id, value));
    try {
      await saveProduceShotTextCell(selectedShotId, promptColumn.id, value);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
      void reload();
    }
  };

  const canGenerate =
    Boolean(selectedShotId) &&
    Boolean(videoColumn?.id) &&
    Boolean(modelId) &&
    displayPlainText(promptValue).length > 0 &&
    !generating;

  const handleGenerate = () => {
    if (!videoColumn?.id) return;
    void generate({
      shotId: selectedShotId,
      videoColumnId: videoColumn.id,
      prompt: promptValue,
      startImagePath,
      modelId,
      size: size || undefined,
      videoLength: videoLength || undefined,
      ratio: ratio || undefined,
    });
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <Card className="relative min-h-0 flex-1 overflow-hidden p-4">
        <RichMentionEditor
          value={promptValue}
          onChange={(value) => void saveTextCell(value)}
          placeholder="输入片段画面、动作、镜头、对白，可输入 @ 引用资产"
          mentionItems={mentionItems}
          className="flex h-full min-h-0 flex-1 flex-col rounded-xl bg-muted/45 px-3 py-2 text-sm leading-7 [&>div]:flex [&>div]:min-h-0 [&>div]:flex-1 [&>div]:flex-col **:[[contenteditable]]:min-h-0 **:[[contenteditable]]:flex-1"
        />

        {/* Floating toolbar bottom-right: model / size / length /
            ratio selects + a labelled generate button. Selects hide
            individually when their schema doesn't expose enums; the
            button is always visible so the user can fire even
            before the model registry hydrates (Java picks the
            default in that case). */}
        <div className="absolute bottom-4 right-4 flex items-center gap-2">
          {modelOptions.length > 0 && (
            <ToolbarSelect value={modelId} options={modelOptions} onChange={handleModelChange} />
          )}
          {sizeOptions.length > 0 && (
            <ToolbarSelect value={size} options={sizeOptions} onChange={setSize} />
          )}
          {lengthOptions.length > 0 && (
            <ToolbarSelect value={videoLength} options={lengthOptions} onChange={setVideoLength} />
          )}
          {ratioOptions.length > 0 && (
            <ToolbarSelect value={ratio} options={ratioOptions} onChange={setRatio} />
          )}
          <Button
            variant="solid"
            color="primary"
            size="lg"
            onClick={handleGenerate}
            disabled={!canGenerate}
          >
            {generating ? <IconLoader2 className="animate-spin" /> : <IconSparkles />}
            生成视频
            {cost > 0 ? <span className="ml-1 tabular-nums opacity-80">·{cost}</span> : null}
          </Button>
        </div>
      </Card>
    </section>
  );
}
