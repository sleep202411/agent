"use client";

/**
 * QuickParamChips — imagine.art-style parameter chips.
 *
 * Renders ONE chip per "quick" model setting (aspect ratio / duration /
 * resolution / quality / outputs), each opening its OWN popover with just that
 * parameter's options. This mirrors imagine.art's composer row (`[16:9] [5s]
 * [720p]`), replacing the old single 440px `ModelSettings` floating panel in
 * the storyboard drawer.
 *
 * Field detection, value binding, and the SizeGrid are all reused from
 * model-settings.tsx / generation-api.ts — zero duplicated parameter logic.
 * `size` gets the visual aspect-ratio grid (better than imagine's plain text
 * list); every other enum field gets a plain menuitem list like imagine.
 */
import { useMemo, useState } from "react";
import { IconClock } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  schemaFields,
  type FizzAiModel,
  type ModelSettings,
  type SchemaFieldDescriptor,
} from "@/lib/canvas-authoring/generation-api";
import {
  AspectGlyph,
  SizeGrid,
  fieldLabel,
  isOutputField,
  isQuickSettingField,
  isSizeField,
  sizeTokenInfo,
} from "./model-settings";

/** One chip + its popover. Self-contained so each param opens independently. */
function ParamChip({
  field,
  value,
  onValueChange,
}: {
  field: SchemaFieldDescriptor;
  value: string | number | boolean | undefined;
  onValueChange: (v: string | number | boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const isSize = isSizeField(field);
  const isDuration = /duration/i.test(field.name);
  const isOutput = isOutputField(field);

  // The chip label: aspect glyph + ratio for size, ×N for outputs, raw value
  // (with a clock icon for duration) for the rest.
  let label: React.ReactNode;
  if (isSize) {
    const token = String(value ?? field.default ?? field.enum?.[0] ?? "");
    const info = sizeTokenInfo(token);
    const text = "labelKey" in info ? info.labelKey : info.label;
    label = (
      <span className="flex items-center gap-1.5">
        <AspectGlyph w={info.w} h={info.h} />
        <span className="whitespace-nowrap">{text}</span>
      </span>
    );
  } else if (isOutput) {
    const n = Number(value ?? field.default ?? field.min ?? 1) || 1;
    label = <span>×{n}</span>;
  } else {
    const v = value ?? field.default ?? field.enum?.[0] ?? "";
    label = (
      <span className="flex items-center gap-1 whitespace-nowrap">
        {isDuration ? <IconClock className="size-3.5 opacity-70" stroke={1.8} /> : null}
        {String(v)}
      </span>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-9 items-center rounded-lg px-3 text-sm font-medium transition-colors",
            "ring-1 ring-inset ring-border hover:ring-foreground/20",
            open ? "bg-muted text-foreground" : "bg-card text-foreground/90"
          )}
        >
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[260px] gap-0 p-2">
        {/* Field title (imagine shows "Aspect Ratio" / "Duration" above the list). */}
        <p className="px-2 pb-1.5 pt-0.5 text-xs font-medium text-muted-foreground">
          {fieldLabel(field)}
        </p>
        {isSize ? (
          // Size keeps the visual aspect-ratio grid — clearer than a text list.
          <SizeGrid field={field} value={String(value ?? "")} onChange={onValueChange} />
        ) : (
          <div role="menu" className="flex flex-col">
            {(field.enum ?? []).map((opt) => {
              const selected = String(value ?? field.default) === String(opt);
              return (
                <button
                  key={String(opt)}
                  role="menuitemradio"
                  aria-checked={selected}
                  type="button"
                  onClick={() => {
                    onValueChange(opt);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-muted",
                    selected && "bg-muted text-foreground"
                  )}
                >
                  <span>{String(opt)}</span>
                  {selected && <span className="text-xs text-muted-foreground">✓</span>}
                </button>
              );
            })}
            {/* Non-enum quick fields (rare) fall back to the raw value display. */}
            {(!field.enum || field.enum.length === 0) && (
              <p className="px-2.5 py-1.5 text-sm text-muted-foreground">
                {String(value ?? field.default ?? "—")}
              </p>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function QuickParamChips({
  model,
  settings,
  onChange,
}: {
  model: FizzAiModel | undefined;
  settings: ModelSettings;
  onChange: (next: ModelSettings) => void;
}) {
  const fields = useMemo(() => schemaFields(model), [model]);

  // Same quick-field set as ComposerQuickSettings: duration/resolution/quality/
  // outputs + the size (aspect) field. Order: non-size quick fields first, size
  // last (matches the pollo/composer convention).
  const sizeField = fields.find(isSizeField);
  const quick = useMemo(
    () =>
      [...fields.filter((f) => !isSizeField(f) && isQuickSettingField(f)), sizeField].filter(
        (f): f is SchemaFieldDescriptor => Boolean(f)
      ),
    [fields, sizeField]
  );

  if (!model || quick.length === 0) return null;

  const scalar = (name: string): string | number | boolean | undefined => {
    const v = settings[name];
    return Array.isArray(v) ? undefined : v;
  };
  const set = (name: string, v: string | number | boolean) => onChange({ ...settings, [name]: v });

  return (
    <div className="flex flex-wrap gap-2">
      {quick.map((field) => (
        <ParamChip
          key={field.name}
          field={field}
          value={scalar(field.name) ?? field.default}
          onValueChange={(v) => set(field.name, v)}
        />
      ))}
    </div>
  );
}
