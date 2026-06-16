"use client";

import { useMemo, useState } from "react";
import { IconBolt, IconChevronDown, IconMinus, IconPlus } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import {
  estimateModelSellPoints,
  schemaFields,
  type FizzAiModel,
  type ModelSettings,
  type SchemaFieldDescriptor,
} from "@/app/canvas/_lib/generation-api";

const SIZE_FIELDS = new Set(["imageSize", "size", "aspectRatio", "aspect_ratio"]);

function isSizeField(field: SchemaFieldDescriptor) {
  return SIZE_FIELDS.has(field.name) && (field.enum?.length ?? 0) > 0;
}

/** fal "ImageSize" preset tokens → a human label + aspect proportion (w:h).
 *  Without this the raw provider tokens ("square_hd", "portrait_4_3") leak into
 *  the UI and every glyph collapses to a generic square. */
const SIZE_PRESETS: Record<string, { label: string; w: number; h: number }> = {
  square_hd: { label: "Square HD", w: 1, h: 1 },
  square: { label: "Square", w: 1, h: 1 },
  portrait_4_3: { label: "Portrait 4:3", w: 3, h: 4 },
  portrait_16_9: { label: "Portrait 16:9", w: 9, h: 16 },
  landscape_4_3: { label: "Landscape 4:3", w: 4, h: 3 },
  landscape_16_9: { label: "Landscape 16:9", w: 16, h: 9 },
};

/** Resolve a size token to its display label + aspect. Ratio tokens ("16:9",
 *  "3x4") are parsed directly; unknown tokens are shown verbatim as a square. */
function sizeTokenInfo(token: string): { label: string; w: number; h: number } {
  const preset = SIZE_PRESETS[token];
  if (preset) return preset;
  const m = token.match(/(\d+)\s*[:x]\s*(\d+)/);
  if (m) return { label: token.replace(/\s*x\s*/i, ":"), w: Number(m[1]), h: Number(m[2]) };
  return { label: token, w: 1, h: 1 };
}

/** Outlined rounded rect drawn in the given aspect proportion. */
function AspectGlyph({ w, h }: { w: number; h: number }) {
  const max = 18;
  const width = w >= h ? max : Math.round(max * (w / h));
  const height = h >= w ? max : Math.round(max * (h / w));
  return (
    <span
      className="rounded-[4px] border-2 border-white/55"
      style={{ width, height }}
      aria-hidden
    />
  );
}

function SizeGrid({
  field,
  value,
  onChange,
}: {
  field: SchemaFieldDescriptor;
  value: string;
  onChange: (v: string) => void;
}) {
  const items = (field.enum ?? []).map((raw) => {
    const token = String(raw);
    return { token, ...sizeTokenInfo(token) };
  });
  // Long labels (preset names like "Landscape 16:9") need wider cells than the
  // short ratio tokens ("16:9"), so drop to 3 columns when any label is long.
  const wide = items.some((it) => it.label.length > 6);
  return (
    <div className={cn("grid gap-2", wide ? "grid-cols-3" : "grid-cols-5")}>
      {items.map(({ token, label, w, h }) => {
        const selected = value === token;
        return (
          <button
            key={token}
            type="button"
            onClick={() => onChange(token)}
            className={cn(
              "flex flex-col items-center justify-center gap-1.5 rounded-xl py-2.5 transition-colors",
              selected
                ? "bg-white/[0.08] ring-2 ring-white/80"
                : "bg-white/[0.04] hover:bg-white/[0.08]"
            )}
          >
            <span className="flex h-5 items-center">
              <AspectGlyph w={w} h={h} />
            </span>
            <span className="whitespace-nowrap text-[11px] text-muted-foreground">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: (string | number)[];
  value: string | number | undefined;
  onChange: (v: string | number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => (
        <button
          key={String(opt)}
          type="button"
          onClick={() => onChange(opt)}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-medium transition-colors",
            String(value) === String(opt)
              ? "bg-white/[0.12] text-foreground"
              : "bg-white/[0.05] text-muted-foreground hover:text-foreground"
          )}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function fieldLabel(field: SchemaFieldDescriptor) {
  return (
    field.title ??
    field.name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase())
  );
}

/** Renders one schema field by its `x-ui` control type. */
function Field({
  field,
  value,
  set,
}: {
  field: SchemaFieldDescriptor;
  value: string | number | boolean | undefined;
  set: (v: string | number | boolean) => void;
}) {
  const showInline = field.control === "slider";
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{fieldLabel(field)}</span>
        {showInline && (
          <span className="text-xs text-white/70 tabular-nums">
            {`${value ?? field.min ?? 0}${field.unit ?? ""}`}
          </span>
        )}
      </div>

      {(field.control === "segmented" || field.control === "radio" || field.control === "select") &&
        field.enum && (
          <Segmented
            options={field.enum}
            value={typeof value === "boolean" ? undefined : value}
            onChange={(v) => set(v)}
          />
        )}

      {field.control === "slider" && (
        <input
          type="range"
          min={field.min ?? 0}
          max={field.max ?? 100}
          step={field.type === "integer" ? 1 : "any"}
          value={Number(value ?? field.min ?? 0)}
          onChange={(e) => set(Number(e.target.value))}
          className="w-full accent-white"
        />
      )}

      {field.control === "stepper" && (
        <div className="flex h-9 w-full items-center gap-2 rounded-lg bg-input/20 px-2">
          <button
            type="button"
            aria-label="Decrease"
            onClick={() => set(Math.max(field.min ?? 0, Number(value ?? field.min ?? 0) - 1))}
            className="flex size-6 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/[0.1] hover:text-white"
          >
            <IconMinus className="size-3.5" stroke={2} />
          </button>
          <input
            type="number"
            value={Number(value ?? field.default ?? field.min ?? 0)}
            min={field.min}
            max={field.max}
            onChange={(e) => set(Number(e.target.value))}
            className="min-w-0 flex-1 bg-transparent text-center text-sm tabular-nums outline-none"
          />
          <button
            type="button"
            aria-label="Increase"
            onClick={() => set(Number(value ?? field.min ?? 0) + 1)}
            className="flex size-6 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/[0.1] hover:text-white"
          >
            <IconPlus className="size-3.5" stroke={2} />
          </button>
        </div>
      )}

      {field.control === "switch" && (
        <button
          type="button"
          role="switch"
          aria-checked={Boolean(value)}
          onClick={() => set(!value)}
          className={cn(
            "flex h-6 w-10 items-center rounded-full p-0.5 transition-colors",
            value ? "bg-white/80" : "bg-white/[0.12]"
          )}
        >
          <span
            className={cn(
              "size-5 rounded-full transition-transform",
              value ? "translate-x-4 bg-background" : "translate-x-0 bg-white/70"
            )}
          />
        </button>
      )}

      {field.control === "textarea" && (
        <textarea
          value={String(value ?? "")}
          onChange={(e) => set(e.target.value)}
          rows={2}
          className="block w-full resize-none rounded-lg bg-input/20 p-2 text-sm outline-none placeholder:text-muted-foreground"
        />
      )}

      {/* Fallback for any unrecognized control: plain number/text input. */}
      {!["segmented", "radio", "select", "slider", "stepper", "switch", "textarea"].includes(
        field.control
      ) && (
        <input
          type={field.type === "integer" || field.type === "number" ? "number" : "text"}
          value={String(value ?? field.default ?? "")}
          onChange={(e) =>
            set(
              field.type === "integer" || field.type === "number"
                ? Number(e.target.value)
                : e.target.value
            )
          }
          className="block h-9 w-full rounded-lg bg-input/20 px-3 text-sm outline-none"
        />
      )}
    </div>
  );
}

/**
 * Schema-driven model settings (fizzstudio pattern): every control is rendered
 * from the selected model's `input_schema` (via `schemaFields`) by its `x-ui`
 * control + group hints — nothing hardcoded. `advanced`-group fields collapse
 * under "Advanced Settings". Shows the live points cost from `billing_policy`.
 */
export function ModelSettings({
  model,
  settings,
  onChange,
}: {
  model: FizzAiModel | undefined;
  settings: ModelSettings;
  onChange: (next: ModelSettings) => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const fields = useMemo(() => schemaFields(model), [model]);
  const sizeField = fields.find(isSizeField);
  const rest = fields.filter((f) => !isSizeField(f));
  const basicFields = rest.filter((f) => f.group !== "advanced");
  const advancedFields = rest.filter((f) => f.group === "advanced");

  const cost = useMemo(() => {
    if (!model) return null;
    const numOutputs = Number(settings.numOutputs ?? settings.n ?? 1) || 1;
    return (
      estimateModelSellPoints(model, {
        numOutputs,
        resolution: settings.resolution != null ? String(settings.resolution) : undefined,
        quality: settings.quality != null ? String(settings.quality) : undefined,
        duration: settings.duration != null ? String(settings.duration) : undefined,
        durationSeconds:
          typeof settings.durationSeconds === "number" ? settings.durationSeconds : undefined,
      })?.sellPoints ?? null
    );
  }, [model, settings]);

  const set = (name: string, value: string | number | boolean) =>
    onChange({ ...settings, [name]: value });

  return (
    <div className="nodrag nowheel absolute bottom-full left-0 z-50 mb-2 max-h-[460px] w-[440px] origin-bottom overflow-y-auto rounded-2xl bg-[oklch(0.24_0_0)] p-4 shadow-2xl shadow-black/60 backdrop-blur-xl duration-150 animate-in fade-in-0 zoom-in-95">
      <div className="flex items-center justify-between">
        <span className="text-base font-semibold">{model?.name ?? "Settings"}</span>
        {cost != null && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <IconBolt className="size-3.5" stroke={1.8} />
            {cost}
          </span>
        )}
      </div>

      {!model && <p className="mt-3 text-sm text-muted-foreground">Select a model to configure.</p>}

      {sizeField && (
        <div className="mt-3">
          <div className="mb-2 text-sm text-muted-foreground">{fieldLabel(sizeField)}</div>
          <SizeGrid
            field={sizeField}
            value={String(
              settings[sizeField.name] ?? sizeField.default ?? sizeField.enum?.[0] ?? ""
            )}
            onChange={(v) => set(sizeField.name, v)}
          />
        </div>
      )}

      {basicFields.map((field) => (
        <div key={field.name} className="mt-4">
          <Field
            field={field}
            value={settings[field.name] ?? field.default}
            set={(v) => set(field.name, v)}
          />
        </div>
      ))}

      {advancedFields.length > 0 && (
        <>
          <div className="my-4 h-px bg-border" />
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="flex w-full items-center justify-between"
          >
            <span className="text-base font-semibold">Advanced Settings</span>
            <IconChevronDown
              className={cn(
                "size-5 text-muted-foreground transition-transform",
                advancedOpen && "rotate-180"
              )}
              stroke={1.8}
            />
          </button>
          {advancedOpen && (
            <div className="mt-3 space-y-4">
              {advancedFields.map((field) => (
                <Field
                  key={field.name}
                  field={field}
                  value={settings[field.name] ?? field.default}
                  set={(v) => set(field.name, v)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
