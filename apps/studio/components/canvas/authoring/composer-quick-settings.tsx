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
import { IconClock } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { GlassRim } from "@/components/ui/glass-rim";
import {
  schemaFields,
  type FizzAiModel,
  type ModelSettings,
  type SchemaFieldDescriptor,
} from "@/lib/canvas-authoring/generation-api";
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
  onOpenChange,
  className,
}: {
  model: FizzAiModel | undefined;
  settings: ModelSettings;
  onChange: (next: ModelSettings) => void;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const t = useTranslations("canvasControls");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const scalar = useCallback(
    (name: string): string | number | boolean | undefined => {
      const v = settings[name];
      return Array.isArray(v) ? undefined : v;
    },
    [settings]
  );
  const set = (name: string, v: string | number | boolean) => onChange({ ...settings, [name]: v });

  const fields = model ? schemaFields(model) : [];
  // Order matches pollo: duration / resolution / quality / outputs first, then
  // the size (aspect-ratio) grid last.
  const sizeField = fields.find(isSizeField);
  const quick = [
    ...fields.filter((f) => !isSizeField(f) && isQuickSettingField(f)),
    sizeField,
  ].filter((f): f is SchemaFieldDescriptor => Boolean(f));
  const effectiveOpen = open && Boolean(model) && quick.length > 0;

  // Close the popover on an outside click.
  useEffect(() => {
    if (!effectiveOpen) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [effectiveOpen]);

  useEffect(() => {
    onOpenChange?.(effectiveOpen);
    return () => {
      if (effectiveOpen) onOpenChange?.(false);
    };
  }, [effectiveOpen, onOpenChange]);

  if (!model) return null;
  if (quick.length === 0) return null;

  const chipLabel = (field: SchemaFieldDescriptor) => {
    if (isSizeField(field)) {
      const token = String(scalar(field.name) ?? field.default ?? field.enum?.[0] ?? "");
      const info = sizeTokenInfo(token);
      const fromOptions = field.options?.find((o) => String(o.value) === token);
      let label: string;
      if (fromOptions?.labelKey) {
        try {
          label = t(fromOptions.labelKey as "sizePresets.auto");
        } catch {
          label = fromOptions.label ?? token;
        }
      } else if (fromOptions?.label) {
        label = fromOptions.label;
      } else {
        label = "labelKey" in info ? t(`sizePresets.${info.labelKey}`) : info.label;
      }
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
    const isDuration = /duration/i.test(field.name);
    return (
      <span className="flex items-center gap-1 whitespace-nowrap">
        {isDuration ? <IconClock className="size-3.5 opacity-70" stroke={1.8} /> : null}
        {String(v ?? "")}
      </span>
    );
  };

  // pollo-style: ONE summary pill (params split by hairline dividers) that opens
  // ONE combined popover with every quick setting as a labeled section — not a
  // separate popover per chip.
  return (
    <div ref={ref} className={cn("relative shrink-0", className)}>
      <button
        type="button"
        aria-label={t("generationSettings")}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex h-10 items-center rounded-xl px-2.5 text-sm font-medium text-foreground transition-colors",
          effectiveOpen ? "bg-white/[0.14]" : "bg-white/[0.08] hover:bg-white/[0.12]"
        )}
      >
        {quick.map((field, i) => (
          <span key={field.name} className="flex items-center">
            {i > 0 ? <span aria-hidden className="mx-1.5 h-3.5 w-px bg-white/15" /> : null}
            {chipLabel(field)}
          </span>
        ))}
      </button>

      {effectiveOpen && (
        <div className="liquid-rim nodrag nowheel absolute bottom-full left-0 z-50 mb-2 w-[320px] origin-bottom-left overflow-hidden rounded-2xl bg-[oklch(0.19_0_0_/_0.97)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),inset_0_-24px_48px_rgba(0,0,0,0.28),0_30px_90px_rgba(0,0,0,0.72)] backdrop-blur-[56px] backdrop-saturate-[1.25] duration-150 animate-in fade-in-0 zoom-in-95">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[linear-gradient(180deg,rgba(255,255,255,0.11)_0%,rgba(255,255,255,0.035)_38%,rgba(0,0,0,0.22)_100%)]"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-3 top-0 h-px bg-white/30"
          />
          <GlassRim className="opacity-80" />
          <div className="relative z-10">
            {quick.map((field, i) => (
              <div key={field.name} className={i > 0 ? "mt-4" : ""}>
                {isSizeField(field) ? (
                  <>
                    {/* SizeGrid has no built-in label; the others self-label. */}
                    <div className="mb-2 text-sm text-muted-foreground">{fieldLabel(field)}</div>
                    <SizeGrid
                      field={field}
                      value={String(scalar(field.name) ?? field.default ?? field.enum?.[0] ?? "")}
                      onChange={(v) => set(field.name, v)}
                    />
                  </>
                ) : (
                  <Field
                    field={field}
                    value={scalar(field.name) ?? field.default}
                    set={(v) => set(field.name, v)}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
