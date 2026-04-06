"use client";

import { useMemo } from "react";
import { IconLoader2, IconPlayerPlay, IconPlus, IconX } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { buildOssUrl } from "@/src/lib/uploads/workspace-upload";
import type { RawAiModel } from "@/src/types/workspace";
import type { PropOption } from "./prop-picker-dialog";

interface FusionControlBarProps {
  characterName: string;
  characterImage: string;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  model: string;
  onModelChange: (model: string) => void;
  count: number;
  onCountChange: (count: number) => void;
  models: RawAiModel[];
  selectedProps: PropOption[];
  onRemoveProp: (id: string) => void;
  onOpenPropPicker: () => void;
  onGenerate: () => void;
  isGenerating: boolean;
}

export function FusionControlBar({
  characterName,
  characterImage,
  prompt,
  onPromptChange,
  model,
  onModelChange,
  count,
  onCountChange,
  models,
  selectedProps,
  onRemoveProp,
  onOpenPropPicker,
  onGenerate,
  isGenerating,
}: FusionControlBarProps) {
  const t = useTranslations("character");

  const modelOptions = useMemo(
    () =>
      models.map((item) => ({
        label: String(item.serviceName ?? item.serviceCode ?? ""),
        value: String(item.serviceCode ?? ""),
      })),
    [models]
  );

  const totalCost = useMemo(() => {
    const currentModel = models.find((item) => item.serviceCode === model);
    return Math.abs(Number(currentModel?.integralCost ?? 0)) * count;
  }, [count, model, models]);

  return (
    <div className="border-t border-border bg-[hsl(var(--card))] p-3">
      <div className="rounded-xl border border-border/40 bg-[hsl(var(--card))]">
        {/* Character + Props tags */}
        <div className="flex items-start justify-between gap-3 border-b border-border/10 px-4 py-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {characterImage ? (
              <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/10 px-2 py-2">
                <img src={characterImage} alt="" className="size-12 rounded-md object-cover" />
                <span className="max-w-[140px] truncate text-xs text-foreground/85">
                  {characterName || t("baseImage")}
                </span>
              </div>
            ) : null}

            {selectedProps.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 rounded-full border border-border bg-muted/10 px-2 py-1"
              >
                {item.image ? (
                  <img
                    src={buildOssUrl(item.image)}
                    alt=""
                    className="size-6 rounded-full object-cover"
                  />
                ) : null}
                <span className="max-w-[100px] truncate text-xs">{item.name}</span>
                <button
                  type="button"
                  onClick={() => onRemoveProp(item.id)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <IconX className="size-3.5" />
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={onOpenPropPicker}
              className="flex h-12 items-center gap-1 rounded-lg border border-dashed border-border px-3 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary"
            >
              <IconPlus className="size-4" />
              {t("selectProp")}
            </button>
          </div>
        </div>

        {/* Prompt input */}
        <div className="px-4 py-3">
          <Textarea
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder={t("fusionPromptPlaceholder")}
            rows={4}
            className="min-h-[120px] resize-none border-0 bg-transparent px-0 text-sm leading-relaxed shadow-none outline-none focus-visible:ring-0"
          />
        </div>

        {/* Toolbar: model / count / cost / generate */}
        <div className="flex items-center justify-between rounded-b-xl bg-muted/5 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Select value={model} onValueChange={onModelChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {modelOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={String(count)} onValueChange={(v) => onCountChange(Number(v))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1x</SelectItem>
                <SelectItem value="2">2x</SelectItem>
                <SelectItem value="4">4x</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2.5">
            {totalCost > 0 ? (
              <span className="flex h-7 min-w-[48px] items-center justify-center rounded-full text-xs font-medium text-foreground/80">
                {totalCost}
              </span>
            ) : null}

            <button
              type="button"
              onClick={onGenerate}
              disabled={!prompt.trim()}
              className={`flex size-9 items-center justify-center rounded-full transition-all ${
                prompt.trim()
                  ? "bg-primary text-white shadow-lg shadow-primary/30 hover:brightness-110"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {isGenerating ? (
                <IconLoader2 className="size-4 animate-spin" />
              ) : (
                <IconPlayerPlay className="size-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
