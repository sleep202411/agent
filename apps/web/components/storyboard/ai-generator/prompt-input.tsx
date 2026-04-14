import { useTranslations } from "@/src/i18n/i18n";
import { IconX, IconPencil, IconPlus } from "@tabler/icons-react";
import { RichMentionEditor } from "@/components/storyboard/editor/rich-mention-editor";
import { cn } from "@/lib/utils";
import { GenerateButton } from "@/components/ui/generate-button";
import { SelectControl } from "@/components/ui/schema-field/select-control";
import { ModelPicker } from "@/components/ui/schema-field/model-picker";
import type { AiModel } from "@/src/lib/ai-model-schema";
import type { AiSizeOption } from "@/src/store/slices/projectSlice";
import { env } from "@/src/env";

const OSS_BASE = env.OSS_BASE_URL;

function ossUrl(path?: string): string | null {
  if (!path) return null;
  if (path.startsWith("http") || path.startsWith("blob:")) return path;
  return `${OSS_BASE}/${path}`;
}

interface PromptInputProps {
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
  onAddReference: () => void;
  onRemoveReference: (idx: number) => void;
  referenceFields?: string[];
  cost?: number;
  loading?: boolean;
  editMode?: boolean;
  showEditToggle?: boolean;
  hideExtraPrompts?: boolean;
  onToggleEditMode?: () => void;
  onSubmit: () => void;
}

export function PromptInput({
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
  onAddReference,
  onRemoveReference,
  referenceFields,
  cost,
  loading,
  editMode = false,
  showEditToggle = false,
  hideExtraPrompts = false,
  onToggleEditMode,
  onSubmit,
}: PromptInputProps) {
  const t = useTranslations("storyboard");
  const canSubmit = prompt.trim().length > 0 && !loading;

  return (
    <div className="mx-4 mb-4 p-4 flex gap-2 min-h-0 flex-1 flex-col rounded-xl border border-border/40 bg-muted transition-colors focus-within:border-primary/30">
      {/* Top row: reference images + edit mode toggle */}
      <div className="flex items-start justify-between">
        {/* Reference images */}
        <div className="flex items-center gap-2">
          {referenceImages.map((img, idx) => {
            const src = ossUrl(img.url || img.path);
            return (
              <div key={idx} className="group relative size-20 overflow-hidden rounded-lg bg-muted">
                {src && <img src={src} alt="" className="h-full w-full object-cover" />}
                <button
                  type="button"
                  onClick={() => onRemoveReference(idx)}
                  className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100"
                >
                  <IconX className="size-2.5" />
                </button>
              </div>
            );
          })}
          {referenceImages.length < 5 && (
            <button
              type="button"
              onClick={onAddReference}
              className="flex size-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary"
            >
              <IconPlus className="size-4" />
              <span className="text-[10px]">{t("referenceImageUpload")}</span>
            </button>
          )}
        </div>

        {showEditToggle ? (
          <button
            type="button"
            onClick={onToggleEditMode}
            className={cn(
              "flex items-center gap-1 text-xs transition-colors",
              editMode
                ? "text-primary hover:text-primary/90"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <IconPencil className="size-3" />
            <span>{editMode ? t("exitEditMode") : t("enterEditModeLabel")}</span>
          </button>
        ) : null}
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
          submitMode="enter"
          referenceMedia={referenceImages.map((r) => ({
            url: r.url || ossUrl(r.path) || "",
            path: r.path,
            label: r.label || r.path.split("/").pop() || "media",
          }))}
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
        {/* Left: model + size */}
        <div className="flex items-center gap-2">
          {normalizedModels ? (
            <ModelPicker models={normalizedModels} value={model} onChange={onModelChange} compact />
          ) : (
            <SelectControl
              options={modelOptions}
              value={model}
              onChange={(v) => onModelChange(String(v))}
            />
          )}
          <SelectControl
            options={sizeOptions.map((s) => ({ label: s.label, value: s.value }))}
            value={size}
            onChange={(v) => onSizeChange(String(v))}
          />
        </div>

        {/* Right: count + cost + submit */}
        <div className="flex items-center gap-2.5">
          <SelectControl
            options={[
              { label: "1x", value: 1 },
              { label: "2x", value: 2 },
              { label: "4x", value: 4 },
            ]}
            value={count}
            onChange={(v) => onCountChange(Number(v))}
            groupLabel={t("generateCountLabel")}
          />

          <GenerateButton onClick={onSubmit} loading={loading} cost={cost} />
        </div>
      </div>
    </div>
  );
}
