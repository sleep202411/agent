import { IconMinus, IconPlus } from "@tabler/icons-react";

interface CounterControlProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
}

export function CounterControl({ value, onChange, min, max, disabled }: CounterControlProps) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        disabled={disabled || (min != null && value <= min)}
        onClick={() => onChange(value - 1)}
        className="flex size-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40"
      >
        <IconMinus className="size-3" />
      </button>
      <span className="min-w-[2rem] text-center text-xs font-medium">{value}</span>
      <button
        type="button"
        disabled={disabled || (max != null && value >= max)}
        onClick={() => onChange(value + 1)}
        className="flex size-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40"
      >
        <IconPlus className="size-3" />
      </button>
    </div>
  );
}
