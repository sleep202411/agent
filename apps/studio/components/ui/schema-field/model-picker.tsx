"use client";

import { useMemo, useState } from "react";
import { IconCheck, IconChevronDown, IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { AiModel } from "@/src/lib/ai-model-schema";

// ─── Model Card ─────────────────────────────────────────

function ModelCard({
  model,
  selected,
  onClick,
}: {
  model: AiModel;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
        selected ? "bg-primary/10" : "hover:bg-white/10"
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{model.name}</span>
          {model.isDefault && (
            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              推荐
            </span>
          )}
        </div>
        {model.description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{model.description}</p>
        )}
        <p className="mt-0.5 text-[11px] text-muted-foreground/70">约 {model.cost} 积分/次</p>
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
}

export function ModelPicker({
  models,
  value,
  onChange,
  disabled,
  compact,
  className,
}: ModelPickerProps) {
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
          <span className="truncate">{selectedModel?.name ?? "选择模型"}</span>
          <IconChevronDown className="size-3 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-[360px] p-0"
        onWheel={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-medium">模型</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted"
          >
            <IconX className="size-3.5" />
          </button>
        </div>

        {/* Model list */}
        <div className="max-h-[50vh] overflow-y-auto overscroll-contain p-1.5">
          {models.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">暂无可用模型</div>
          ) : (
            models.map((model) => (
              <ModelCard
                key={model.id}
                model={model}
                selected={model.id === value}
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
