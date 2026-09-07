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
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { IconChevronDown, IconClock } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  schemaFields,
  normalizeSchemaFieldNumber,
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
  placement = "above",
  align = "left",
  appearance = "pill",
  lockedFields,
}: {
  model: FizzAiModel | undefined;
  settings: ModelSettings;
  onChange: (next: ModelSettings) => void;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  /** Which side of the anchored trigger the popover opens toward. Composers
   *  sit at the bottom of the screen and open above; page headers open below. */
  placement?: "above" | "below";
  align?: "left" | "right";
  /** Asset workbench rows use Onsolo-style unboxed values instead of a pill. */
  appearance?: "pill" | "plain";
  /** Fields taken over by the active omni task type (edit/extend locks) —
   *  their chips hide entirely; the value is forced to auto by the composer. */
  lockedFields?: ReadonlySet<string>;
}) {
  const t = useTranslations("canvasControls");
  const [open, setOpen] = useState(false);

  const scalar = useCallback(
    (name: string): string | number | boolean | undefined => {
      const v = settings[name];
      return Array.isArray(v) ? undefined : v;
    },
    [settings]
  );
  const set = (name: string, v: string | number | boolean) => onChange({ ...settings, [name]: v });

  const fields = model ? schemaFields(model) : [];
  // Composer pills keep the established order. Compact asset rows lead with
  // aspect ratio so their plain-text summary reads like the generation spec.
  const sizeField = fields.find(isSizeField);
  const nonSizeQuick = fields.filter((f) => !isSizeField(f) && isQuickSettingField(f));
  const quick = (
    appearance === "plain" ? [sizeField, ...nonSizeQuick] : [...nonSizeQuick, sizeField]
  )
    .filter((f): f is SchemaFieldDescriptor => Boolean(f))
    .filter((f) => !lockedFields?.has(f.name));
  const effectiveOpen = open && Boolean(model) && quick.length > 0;

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
      return appearance === "plain" ? (
        <span className="whitespace-nowrap">{label}</span>
      ) : (
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
    const raw = scalar(field.name) ?? field.default ?? field.enum?.[0];
    const v =
      typeof raw === "number" && (field.type === "number" || field.type === "integer")
        ? normalizeSchemaFieldNumber(raw, field)
        : raw;
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
    <Popover open={effectiveOpen} onOpenChange={setOpen}>
      <div className={cn("shrink-0", className)}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t("generationSettings")}
            className={cn(
              "flex h-10 items-center text-sm transition-colors focus-visible:outline-none",
              appearance === "plain"
                ? "rounded-lg px-0 font-normal text-white/72 hover:text-white focus-visible:ring-2 focus-visible:ring-white/35"
                : "rounded-xl px-2.5 font-medium text-foreground",
              appearance === "pill"
                ? effectiveOpen
                  ? "bg-white/[0.14]"
                  : "bg-white/[0.08] hover:bg-white/[0.12]"
                : null
            )}
          >
            {quick.map((field, i) => (
              <span key={field.name} className="flex items-center">
                {i > 0 ? (
                  appearance === "plain" ? (
                    <span aria-hidden className="mx-1 text-white/24">
                      ·
                    </span>
                  ) : (
                    <span aria-hidden className="mx-1.5 h-3.5 w-px bg-white/15" />
                  )
                ) : null}
                {chipLabel(field)}
              </span>
            ))}
            {appearance === "plain" ? (
              <IconChevronDown className="ml-0.5 size-3.5 shrink-0 text-white/42" stroke={1.8} />
            ) : null}
          </button>
        </PopoverTrigger>

        <PopoverContent
          aria-label={t("generationSettings")}
          side={placement === "above" ? "top" : "bottom"}
          align={align === "left" ? "start" : "end"}
          sideOffset={8}
          collisionPadding={8}
          sticky="always"
          className="nodrag nowheel max-h-[var(--radix-popover-content-available-height)] w-[320px] max-w-[calc(100vw-1rem)] gap-0 overflow-y-auto overscroll-contain rounded-2xl bg-popover p-3 shadow-2xl shadow-black/50"
        >
          <div>
            {quick.map((field, i) => (
              <div key={field.name} className={i > 0 ? "mt-3" : ""}>
                {isSizeField(field) ? (
                  <>
                    {/* SizeGrid has no built-in label; the others self-label. */}
                    <div className="mb-2 text-xs font-medium text-muted-foreground">
                      {fieldLabel(field)}
                    </div>
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
        </PopoverContent>
      </div>
    </Popover>
  );
}
