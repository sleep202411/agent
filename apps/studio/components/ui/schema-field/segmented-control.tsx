"use client";

import { cn } from "@/lib/utils";

interface SegmentedControlProps {
  options: { value: string | number; label: string }[];
  value: unknown;
  onChange: (v: string | number) => void;
  disabled?: boolean;
  compact?: boolean;
}

export function SegmentedControl({
  options,
  value,
  onChange,
  disabled,
  compact,
}: SegmentedControlProps) {
  return (
    <div className="flex items-center rounded-lg bg-muted/50 p-0.5">
      {options.map((opt) => (
        <button
          key={String(opt.value)}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-md px-3 text-xs font-medium transition-colors",
            compact ? "py-1" : "py-1.5",
            String(value) === String(opt.value)
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
