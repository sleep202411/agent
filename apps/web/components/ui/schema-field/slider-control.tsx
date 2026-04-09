interface SliderControlProps {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  disabled?: boolean;
}

export function SliderControl({ value, onChange, min, max, disabled }: SliderControlProps) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-primary"
      />
      <span className="min-w-[2rem] text-center text-xs text-muted-foreground">{value}</span>
    </div>
  );
}
