"use client";

import { useMemo } from "react";
import { IconLoader2 } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { getFieldLabel, getEnumLabel, type AiModelInputSchema } from "./schema";
import { SegmentedControl } from "./segmented-control";
import { SelectControl } from "./select-control";
import { CounterControl } from "./counter-control";
import { SliderControl } from "./slider-control";
import { SwitchControl } from "./switch-control";

interface SchemaFieldProps {
  schema: AiModelInputSchema;
  field: string;
  value: unknown;
  onChange: (value: unknown) => void;
  showLabel?: boolean;
  compact?: boolean;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}

export function SchemaField({
  schema,
  field,
  value,
  onChange,
  showLabel = false,
  compact = false,
  disabled = false,
  loading = false,
  className,
}: SchemaFieldProps) {
  const fieldSchema = schema.properties[field];

  const options = useMemo(() => {
    if (!fieldSchema?.enum) return [];
    return fieldSchema.enum.map((v) => ({
      value: v,
      label: getEnumLabel(fieldSchema, v),
    }));
  }, [fieldSchema]);

  if (!fieldSchema) return null;

  const label = getFieldLabel(fieldSchema);
  const isDisabled = disabled || loading;

  let control: React.ReactNode;

  if (loading) {
    control = <IconLoader2 className="size-4 animate-spin text-muted-foreground" />;
  } else if (fieldSchema.type === "boolean") {
    control = <SwitchControl value={Boolean(value)} onChange={onChange} disabled={isDisabled} />;
  } else if (fieldSchema.enum && fieldSchema.enum.length > 0) {
    if (fieldSchema.enum.length <= 5) {
      control = (
        <SegmentedControl
          options={options}
          value={value}
          onChange={onChange}
          disabled={isDisabled}
          compact={compact}
        />
      );
    } else {
      control = (
        <SelectControl
          options={options}
          value={value}
          onChange={onChange}
          disabled={isDisabled}
          placeholder={label}
        />
      );
    }
  } else if (
    (fieldSchema.type === "integer" || fieldSchema.type === "number") &&
    fieldSchema.minimum != null &&
    fieldSchema.maximum != null
  ) {
    const range = fieldSchema.maximum - fieldSchema.minimum;
    if (range <= 20) {
      control = (
        <CounterControl
          value={Number(value ?? fieldSchema.default ?? fieldSchema.minimum)}
          onChange={onChange}
          min={fieldSchema.minimum}
          max={fieldSchema.maximum}
          disabled={isDisabled}
        />
      );
    } else {
      control = (
        <SliderControl
          value={Number(value ?? fieldSchema.default ?? fieldSchema.minimum)}
          onChange={onChange}
          min={fieldSchema.minimum}
          max={fieldSchema.maximum}
          disabled={isDisabled}
        />
      );
    }
  } else {
    control = (
      <input
        type={fieldSchema.type === "integer" || fieldSchema.type === "number" ? "number" : "text"}
        value={String(value ?? "")}
        onChange={(e) =>
          onChange(
            fieldSchema.type === "integer"
              ? parseInt(e.target.value, 10)
              : fieldSchema.type === "number"
                ? parseFloat(e.target.value)
                : e.target.value
          )
        }
        disabled={isDisabled}
        placeholder={label}
        className={cn(
          "rounded-lg border border-border bg-background text-xs outline-none transition-colors focus:border-primary",
          compact ? "px-2 py-1" : "px-3 py-1.5"
        )}
      />
    );
  }

  if (!showLabel) {
    return <div className={className}>{control}</div>;
  }

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {control}
    </div>
  );
}
