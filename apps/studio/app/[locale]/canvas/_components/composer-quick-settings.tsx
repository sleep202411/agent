"use client";

/**
 * Inline quick-setting chips for the composer — surfaces the common model
 * settings (image size / resolution / quality / outputs) right on the composer
 * bar so they don't all live behind the `⊟` panel. Schema-driven: a chip shows
 * only for a field the model actually has. Each chip opens a mini-popover that
 * reuses the EXACT controls from model-settings.tsx (SizeGrid / Field) — zero
 * duplicated logic, same value binding. The full `⊟` panel keeps the long tail
 * (pass `hideQuickFields` there so it doesn't duplicate these).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { IconChevronDown } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import {
  schemaFields,
  type FizzAiModel,
  type ModelSettings,
  type SchemaFieldDescriptor,
} from "@/app/[locale]/canvas/_lib/generation-api";
import {
  AspectGlyph,
  Field,
  SizeGrid,
  fieldLabel,
  isOutputField,
  isQuickSettingField,
  isSizeField,
  sizeTokenInfo,
} from "./model-settings";

export function ComposerQuickSettings({
  model,
  settings,
  onChange,
  className,
}: {
  model: FizzAiModel | undefined;
  settings: ModelSettings;
  onChange: (next: ModelSettings) => void;
  className?: string;
}) {
  const t = useTranslations("canvasControls");
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Close the open popover on an outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const scalar = useCallback(
    (name: string): string | number | boolean | undefined => {
      const v = settings[name];
      return Array.isArray(v) ? undefined : v;
    },
    [settings]
  );
  const set = (name: string, v: string | number | boolean) => onChange({ ...settings, [name]: v });

  if (!model) return null;
  const fields = schemaFields(model);
  // Order: size first, then the rest in schema order (resolution / quality / outputs).
  const sizeField = fields.find(isSizeField);
  const quick = [
    sizeField,
    ...fields.filter((f) => !isSizeField(f) && isQuickSettingField(f)),
  ].filter((f): f is SchemaFieldDescriptor => Boolean(f));
  if (quick.length === 0) return null;

  const chipLabel = (field: SchemaFieldDescriptor) => {
    if (isSizeField(field)) {
      const token = String(scalar(field.name) ?? field.default ?? field.enum?.[0] ?? "");
      const info = sizeTokenInfo(token);
      const label = "labelKey" in info ? t(`sizePresets.${info.labelKey}`) : info.label;
      return (
        <span className="flex items-center gap-1.5">
          <AspectGlyph w={info.w} h={info.h} />
          <span className="whitespace-nowrap">{label}</span>
        </span>
      );
    }
    if (isOutputField(field)) {
      const n = Number(scalar(field.name) ?? field.default ?? field.min ?? 1) || 1;
      return <span>×{n}</span>;
    }
    const v = scalar(field.name) ?? field.default ?? field.enum?.[0];
    return <span className="whitespace-nowrap">{String(v ?? "")}</span>;
  };

  return (
    <div ref={ref} className={cn("flex items-center gap-1.5", className)}>
      {quick.map((field) => {
        const isOpen = open === field.name;
        return (
          <div key={field.name} className="relative shrink-0">
            <button
              type="button"
              aria-label={fieldLabel(field)}
              onClick={() => setOpen(isOpen ? null : field.name)}
              className={cn(
                "flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-foreground transition-colors",
                isOpen ? "bg-white/[0.14]" : "bg-white/[0.08] hover:bg-white/[0.12]"
              )}
            >
              {chipLabel(field)}
              <IconChevronDown className="size-3.5 opacity-70" stroke={2} />
            </button>
            {isOpen && (
              <div className="nodrag nowheel absolute bottom-full left-0 z-50 mb-2 w-[300px] origin-bottom-left rounded-2xl border border-white/[0.06] bg-[oklch(0.235_0_0_/_0.95)] p-3 shadow-2xl shadow-black/60 backdrop-blur-2xl duration-150 animate-in fade-in-0 zoom-in-95">
                {isSizeField(field) ? (
                  <>
                    <div className="mb-2 text-sm text-muted-foreground">{fieldLabel(field)}</div>
                    <SizeGrid
                      field={field}
                      value={String(scalar(field.name) ?? field.default ?? field.enum?.[0] ?? "")}
                      onChange={(v) => {
                        set(field.name, v);
                        setOpen(null);
                      }}
                    />
                  </>
                ) : (
                  <Field
                    field={field}
                    value={scalar(field.name) ?? field.default}
                    set={(v) => {
                      set(field.name, v);
                      // Enum picks are one-shot → close; the stepper stays open.
                      if (!isOutputField(field)) setOpen(null);
                    }}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
