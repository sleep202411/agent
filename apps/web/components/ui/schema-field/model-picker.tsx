"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { IconCheck, IconChevronDown } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { AiModel } from "./schema";
import { getModelDescription } from "./descriptions";

// ─── Model Card ─────────────────────────────────────────

function ModelCard({
  model,
  selected,
  onClick,
  t,
  locale,
}: {
  model: AiModel;
  selected: boolean;
  onClick: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  locale: string;
}) {
  const description = getModelDescription(model.id, model.name, locale) ?? model.description;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full cursor-pointer items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors",
        selected ? "bg-primary/10" : "hover:bg-white/10"
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{model.name}</span>
        </div>
        {description && <p className="mt-0.5 text-[10px] text-muted-foreground">{description}</p>}
        <p className="mt-0.5 text-[10px] text-muted-foreground/70">
          {t("costPerUse", { cost: model.cost })}
        </p>
      </div>
      {selected && <IconCheck className="mt-1 size-4 shrink-0 text-primary" />}
    </button>
  );
}

// ─── ModelPicker ─────────────────────────────────────────

interface ModelPickerProps {
  models: AiModel[];
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
  /** Extra classes merged onto the popover content. Use to override the
   * default translucent glass background when the picker is opening over
   * a bright/busy surface (e.g., character portrait dialog). */
  contentClassName?: string;
}

export function ModelPicker({
  models,
  value,
  onChange,
  disabled,
  compact,
  className,
  contentClassName,
}: ModelPickerProps) {
  const t = useTranslations("model");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const selectedModel = models.find((m) => m.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          color="muted"
          size="default"
          disabled={disabled}
          className={className}
        >
          <span className="truncate">{selectedModel?.name ?? t("selectModel")}</span>
          <IconChevronDown className="size-3 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className={cn(
          "w-82 border-white/8 bg-white/6 p-0 shadow-2xl backdrop-blur-2xl backdrop-saturate-150",
          contentClassName
        )}
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="max-h-[50vh] overflow-y-auto overscroll-contain p-2 space-y-1">
          {models.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              {t("noModelsAvailable")}
            </div>
          ) : (
            models.map((model) => (
              <ModelCard
                key={model.id}
                model={model}
                selected={model.id === value}
                t={t}
                locale={locale}
                onClick={() => {
                  onChange(model.id);
                  setOpen(false);
                }}
              />
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
