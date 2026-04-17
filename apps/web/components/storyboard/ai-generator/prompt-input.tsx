"use client";

import { useTranslations } from "@/src/i18n/i18n";
import { RichMentionEditor } from "@/components/storyboard/editor/rich-mention-editor";
import { ReferenceGroup } from "./reference-group";
import { ToolbarSelect } from "@/components/ui/schema-field/toolbar-select";
import { GenerateButton } from "@/components/ui/generate-button";
import { ModelPicker } from "@/components/ui/schema-field/model-picker";
import { getModesByType } from "@/components/ui/schema-field/schema";
import type { AiModel } from "@/components/ui/schema-field/schema";
import type { AiSizeOption } from "@/src/store/slices/projectSlice";
import { env } from "@/src/env";

const OSS_BASE = env.OSS_BASE_URL;

function ossUrl(path?: string): string | null {
  if (!path) return null;
  if (path.startsWith("http") || path.startsWith("blob:")) return path;
  return `${OSS_BASE}/${path}`;
}

interface PromptInputProps {
  /** Current image mode id */
  imageMode?: string;
  /** Called when user changes image mode */
  onImageModeChange?: (mode: string) => void;
  prompt: string;
  onPromptChange: (v: string) => void;
  prefixPrompt: string;
  onPrefixChange: (v: string) => void;
  suffixPrompt: string;
  onSuffixChange: (v: string) => void;
  model: string;
  modelOptions: { label: string; value: string }[];
  /** Normalized models for ModelPicker (if provided, renders card picker instead of select) */
  normalizedModels?: AiModel[];
  onModelChange: (v: string) => void;
  size: string;
  sizeOptions: AiSizeOption[];
  onSizeChange: (v: string) => void;
  count: number;
  onCountChange: (v: number) => void;
  referenceImages: { url: string; path: string; label?: string }[];
  maxReferenceImages?: number;
  onAddReference: () => void;
  onRemoveReference: (idx: number) => void;
  referenceFields?: string[];
  cost?: number;
  loading?: boolean;
  hideExtraPrompts?: boolean;
  mentionDisabled?: boolean;
  onSubmit: () => void;
}

// Image mode options from schema (computed once)
const IMAGE_MODE_OPTIONS = getModesByType("image", true).map((m) => ({
  label: m.label ?? m.id,
  value: m.id,
  disabled: m.disabled,
}));

export function PromptInput({
  imageMode,
  onImageModeChange,
  prompt,
  onPromptChange,
  prefixPrompt,
  onPrefixChange,
  suffixPrompt,
  onSuffixChange,
  model,
  modelOptions,
  normalizedModels,
  onModelChange,
  size,
  sizeOptions,
  onSizeChange,
  count,
  onCountChange,
  referenceImages,
  maxReferenceImages,
  onAddReference,
  onRemoveReference,
  referenceFields,
  cost,
  loading,
  hideExtraPrompts = false,
  mentionDisabled = false,
  onSubmit,
}: PromptInputProps) {
  const t = useTranslations("storyboard");
  const canSubmit = prompt.trim().length > 0 && !loading;

  return (
    <div className="mx-4 mb-4 p-4 flex gap-2 min-h-0 flex-1 flex-col overflow-visible rounded-xl border border-border/40 bg-muted transition-colors focus-within:border-primary/30">
      {/* Top row: reference group (rendered externally) + edit mode toggle */}
      <div className="flex items-start justify-between">
        {/* Reference group rendered by parent via -mt offset */}
        <div className="relative z-10 -mt-10 min-w-0 max-w-full overflow-hidden">
          <ReferenceGroup
            label={t("referenceImageUpload")}
            items={referenceImages}
            maxCount={maxReferenceImages ?? 5}
            onAdd={onAddReference}
            onRemove={onRemoveReference}
            resolveUrl={(p) => ossUrl(p) || ""}
          />
        </div>
      </div>

      {/* Prefix prompt */}
      {!hideExtraPrompts ? (
        <div className="p-0">
          <div className="flex items-center">
            <div className="mr-2 h-4 w-0.5 rounded-full bg-primary/40" />
            <input
              type="text"
              value={prefixPrompt}
              onChange={(e) => onPrefixChange(e.target.value)}
              placeholder={t("prefixPromptPlaceholder")}
              className="flex-1 bg-transparent text-xs text-foreground/80 outline-none placeholder:text-muted-foreground/40"
            />
          </div>
        </div>
      ) : null}

      {/* Reference field tags */}
      {referenceFields && referenceFields.length > 0 && (
        <div className="flex gap-1 pt-1">
          {referenceFields.map((name) => (
            <span
              key={name}
              className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"
            >
              {name}
            </span>
          ))}
        </div>
      )}

      {/* Main prompt editor */}
      <div className="min-h-0 flex-1 overflow-auto">
        <RichMentionEditor
          value={prompt}
          onChange={onPromptChange}
          placeholder={t("promptEditorPlaceholder")}
          mentionTypes={["character", "scene", "prop"]}
          minHeight={48}
          className="[&_[contenteditable]]:text-sm [&_[contenteditable]]:leading-relaxed [&_[contenteditable]]:text-foreground [&_[contenteditable]]:outline-none"
          onSubmitShortcut={onSubmit}
          submitMode="mod"
          referenceMedia={referenceImages.map((r, i) => ({
            url: r.url || ossUrl(r.path) || "",
            path: r.path,
            label: r.label || `${t("referenceImage")} ${i + 1}`,
          }))}
          mentionDisabled={mentionDisabled}
        />
      </div>

      {/* Suffix prompt */}
      {!hideExtraPrompts ? (
        <div>
          <div className="flex items-center">
            <div className="mr-2 h-4 w-0.5 rounded-full bg-primary/40" />
            <input
              type="text"
              value={suffixPrompt}
              onChange={(e) => onSuffixChange(e.target.value)}
              placeholder={t("suffixPromptPlaceholder")}
              className="flex-1 bg-transparent text-xs text-foreground/80 outline-none placeholder:text-muted-foreground/40"
            />
          </div>
        </div>
      ) : null}

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        {/* Left: mode + model + size */}
        <div className="flex items-center gap-2">
          {imageMode && onImageModeChange && (
            <ToolbarSelect
              options={IMAGE_MODE_OPTIONS}
              value={imageMode}
              onChange={onImageModeChange}
            />
          )}
          {normalizedModels ? (
            <ModelPicker models={normalizedModels} value={model} onChange={onModelChange} compact />
          ) : (
            <ToolbarSelect options={modelOptions} value={model} onChange={onModelChange} />
          )}
          <ToolbarSelect
            options={sizeOptions.map((s) => ({ label: s.label, value: s.value }))}
            value={size}
            onChange={onSizeChange}
          />
        </div>

        {/* Right: count + cost + submit */}
        <div className="flex items-center gap-2.5">
          <ToolbarSelect
            options={[
              { label: "1x", value: "1" },
              { label: "2x", value: "2" },
              { label: "4x", value: "4" },
            ]}
            value={String(count)}
            onChange={(v) => onCountChange(Number(v))}
          />

          <GenerateButton onClick={onSubmit} loading={loading} cost={cost} />
        </div>
      </div>
    </div>
  );
}
