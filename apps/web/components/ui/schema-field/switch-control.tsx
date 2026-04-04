"use client";

import { cn } from "@/lib/utils";

interface SwitchControlProps {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}

export function SwitchControl({ value, onChange, disabled }: SwitchControlProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      disabled={disabled}
      onClick={() => onChange(!value)}
      className={cn(
        "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
        value ? "bg-primary" : "bg-muted"
      )}
    >
      <span
        className={cn(
          "inline-block size-3.5 rounded-full bg-white transition-transform",
          value ? "translate-x-4.5" : "translate-x-0.5"
        )}
      />
    </button>
  );
}
