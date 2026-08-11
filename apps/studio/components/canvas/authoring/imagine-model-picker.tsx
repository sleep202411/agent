"use client";

/**
 * ImagineModelPicker — 1:1 structural replica of imagine.art's model selector.
 *
 * Built from the live imagine.art DOM (classes captured via locator
 * getAttribute on the real elements): outer `group/model-row` row, filled
 * surface (`bg-fill-primary-variant`), 40px icon tile with border, name +
 * brand-coloured PRO pill, truncated tagline, and a wrap row of PILL chips
 * (each = icon + text, `rounded-full`, not square tags) covering credits,
 * frame mode, resolution, audio, and duration.
 *
 * Evaluation artifact: real catalog data, imagine.art's layout logic. It does
 * NOT follow the studio DESIGN.md — that comparison is the point. Field map:
 *   icon      ← family/provider brand glyph
 *   name      ← model.name
 *   PRO       ← ui_policy.recommended  (brand-coloured pill)
 *   tagline   ← model.description ?? ui_policy.group
 *   credits   ← cheapestSellPoints(model)
 *   chips     ← Start | Start/End (capabilities), resolution (size enum),
 *               Audio (schema audio flag), duration (duration enum)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  IconBolt,
  IconBrandGoogle,
  IconBrandOpenai,
  IconBrandTiktok,
  IconCheck,
  IconClock,
  IconCoin,
  IconCube,
  IconFrame,
  IconLock,
  IconPin,
  IconPlayerPlay,
  IconSearch,
  IconSparkles,
  IconVolume,
  IconX,
  type Icon,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import {
  cheapestSellPoints,
  enumOptions,
  fizzAiModelLock,
  fizzAiPlanLabel,
  isOperationOnlyModel,
  type FizzAiCatalog,
  type FizzAiModel,
} from "@/lib/canvas-authoring/generation-api";
import { useAiCatalog, visibleModelsByModality } from "@/lib/canvas-authoring/use-ai-catalog";

/* ------------------------------------------------------------------ *
 * Brand glyph for the icon tile.
 * ------------------------------------------------------------------ */
function brandIcon(model: FizzAiModel): Icon {
  const s = `${model.id} ${model.name} ${model.family ?? ""}`.toLowerCase();
  if (s.includes("gpt") || s.includes("openai") || s.includes("dall")) return IconBrandOpenai;
  if (
    s.includes("nano-banana") ||
    s.includes("gemini") ||
    s.includes("imagen") ||
    s.includes("google")
  )
    return IconBrandGoogle;
  if (s.includes("seedance") || s.includes("seedream") || s.includes("byte"))
    return IconBrandTiktok;
  if (s.includes("flux")) return IconBolt;
  if (s.includes("wan") || s.includes("qwen") || s.includes("alibaba") || s.includes("bailian"))
    return IconCube;
  return IconSparkles;
}

/* ------------------------------------------------------------------ *
 * Meta-chip derivation.
 * ------------------------------------------------------------------ */
function frameMode(model: FizzAiModel): string | null {
  const c = model.capabilities;
  if (!c) return null;
  const t2 = c.textToImage || c.textToVideo;
  const i2 = c.imageToImage || c.imageToVideo;
  if (t2 && i2) return "Start/End";
  if (t2) return "Start";
  if (i2) return "End";
  return null;
}

function resolutionChip(model: FizzAiModel): string | null {
  const opts =
    enumOptions(model, "size") ??
    enumOptions(model, "resolution") ??
    enumOptions(model, "aspect_ratio");
  if (!opts || opts.length === 0) return null;
  const short = opts
    .map((o) => o.replace(/.*x/g, "").replace("p", "p"))
    .filter(Boolean)
    .slice(0, 2);
  return short.length ? short.join("-") : null;
}

function durationChip(model: FizzAiModel): string | null {
  const opts = enumOptions(model, "duration") ?? enumOptions(model, "seconds");
  if (!opts || opts.length === 0) return null;
  const min = opts[0];
  const max = opts[opts.length - 1];
  return min === max ? `${min}` : `${min}-${max}`;
}

function hasAudio(model: FizzAiModel): boolean {
  const props = model.input_schema?.properties ?? {};
  return Boolean(
    (props as Record<string, unknown>).audio || (props as Record<string, unknown>).with_audio
  );
}

function searchRank(model: FizzAiModel, q: string): number {
  if (!q) return 0;
  const name = model.name.toLowerCase();
  const words = name.split(/[^a-z0-9]+/).filter(Boolean);
  if (name.startsWith(q)) return 0;
  if (words.some((w) => w.startsWith(q))) return 1;
  if (name.includes(q)) return 2;
  return Number.POSITIVE_INFINITY;
}

/* ------------------------------------------------------------------ *
 * A pill chip: rounded-full, surface fill, icon + label. Mirrors imagine's
 *   `bg-fill-secondary text-content-secondary text-label-sm py-0.5 px-1.5
 *    rounded-full gap-1 [svg]:size-3`
 * ------------------------------------------------------------------ */
function Chip({ icon: Icon, children }: { icon?: Icon; children: React.ReactNode }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-secondary px-1.5 py-0.5 text-xs font-medium text-muted-foreground [&_svg]:size-3">
      {Icon && <Icon />}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * The panel.
 * ------------------------------------------------------------------ */
export function ImagineModelPicker({
  catalog,
  modality,
  selectedId,
  onSelect,
  onClose,
}: {
  catalog: FizzAiCatalog | undefined;
  modality: "image" | "video";
  selectedId?: string;
  onSelect?: (model: FizzAiModel) => void;
  onClose?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [vendorFilter, setVendorFilter] = useState<string | null>(null);
  const [providersOpen, setProvidersOpen] = useState(false);
  const [pinned, setPinned] = useState<Set<string>>(new Set());

  /**
   * "Providers" = the company that makes each model (`model.vendor`: ByteDance
   * / Google / Black Forest Labs / Alibaba / OpenAI / …). This is the
   * user-facing axis imagine.art filters on — NOT the routing `provider`
   * (fal-ai / byteplus-modelark / …) and NOT `ui_policy.group` (a product
   * tier). vendor is seeded per canonical model.
   */
  const vendors = useMemo(() => {
    // Visible, not usable — see `groupedRows`. A vendor whose models are all
    // plan-gated must still appear, or the filter silently loses a company.
    const all = catalog ? visibleModelsByModality(catalog, modality) : [];
    const usable = all.filter((m) => !isOperationOnlyModel(m) && !/hunyuan|panorama/i.test(m.id));
    const seen = new Set<string>();
    for (const m of usable) {
      const v = m.vendor?.trim();
      if (v) seen.add(v);
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [catalog, modality]);

  // Rows grouped by vendor, alphabetised, so the list renders in stable
  // per-company sections (like imagine's provider sections).
  const groupedRows = useMemo(() => {
    // Visible, not usable: models this plan can't run stay listed and render
    // locked, sorted to the bottom of their vendor bucket.
    const all = catalog ? visibleModelsByModality(catalog, modality) : [];
    const usable = all.filter((m) => !isOperationOnlyModel(m) && !/hunyuan|panorama/i.test(m.id));
    const q = query.trim().toLowerCase();
    const filtered = usable.filter((m) => {
      if (vendorFilter && (m.vendor ?? "Other") !== vendorFilter) return false;
      if (!q) return true;
      return Number.isFinite(searchRank(m, q));
    });
    // Bucket by vendor.
    const buckets = new Map<string, FizzAiModel[]>();
    for (const m of filtered) {
      const key = m.vendor?.trim() || "Other";
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(m);
    }
    // Sort within each bucket: usable → pinned → recommended → name.
    for (const list of buckets.values()) {
      list.sort((a, b) => {
        const la = fizzAiModelLock(a) ? 1 : 0;
        const lb = fizzAiModelLock(b) ? 1 : 0;
        if (la !== lb) return la - lb;
        const pa = pinned.has(a.id) ? 0 : 1;
        const pb = pinned.has(b.id) ? 0 : 1;
        if (pa !== pb) return pa - pb;
        const ra = a.ui_policy?.recommended ? 0 : 1;
        const rb = b.ui_policy?.recommended ? 0 : 1;
        if (ra !== rb) return ra - rb;
        return a.name.localeCompare(b.name);
      });
    }
    return Array.from(buckets.keys())
      .sort((a, b) => a.localeCompare(b))
      .map((key) => ({ key, label: key, models: buckets.get(key)! }));
  }, [catalog, modality, query, vendorFilter, pinned]);

  const togglePin = (id: string) =>
    setPinned((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Close the group dropdown on outside click (the panel is inside a Radix
  // Dialog, so Escape is already handled by the dialog — this covers clicks on
  // the model rows / search box / overlay).
  const providersRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!providersOpen) return;
    const onDown = (e: MouseEvent) => {
      if (providersRef.current && !providersRef.current.contains(e.target as Node)) {
        setProvidersOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [providersOpen]);

  return (
    <div
      aria-label="Select model"
      className={cn(
        // imagine: modal = bg-surface-primary-variant = #171717 (neutral-100).
        // studio's closest neutral is --background (oklch 0.17 ≈ #141414). Rows
        // use the SAME tone (see below) — imagine's fill-primary-variant also
        // resolves to neutral-100, so the row sits flush on the modal, no seam.
        // No role="dialog" here: when embedded, a Radix DialogContent supplies that
        // role + label; nested dialogs are an a11y anti-pattern.
        "flex h-[630px] w-[600px] flex-col overflow-hidden rounded-2xl border border-border bg-background p-2 text-foreground shadow-2xl",
        "animate-in fade-in-0 zoom-in-95 duration-150"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-2 pb-0">
        <p className="text-sm font-semibold text-foreground">Select model</p>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <IconX className="size-4.5" />
          </button>
        )}
      </div>

      {/* Providers + search row */}
      <div className="flex gap-2 p-2">
        {/* Vendor filter dropdown — button and menu share one relative anchor so
            the menu positions against THIS button, not the outer panel. */}
        <div className="relative" ref={providersRef}>
          <button
            type="button"
            onClick={() => setProvidersOpen((open) => !open)}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors",
              "ring-1 ring-inset ring-border hover:ring-foreground/20",
              (vendorFilter || providersOpen) && "bg-muted text-foreground"
            )}
          >
            <span className="whitespace-nowrap">{vendorFilter ?? "Providers"}</span>
            <IconSparkles
              className={cn(
                "ml-auto size-4 shrink-0 transition-transform",
                providersOpen && "rotate-180"
              )}
            />
          </button>
          {providersOpen && (
            <div className="absolute left-0 top-full z-20 mt-1 min-w-[160px] rounded-lg border border-border bg-popover p-1 shadow-xl">
              <button
                type="button"
                onClick={() => {
                  setVendorFilter(null);
                  setProvidersOpen(false);
                }}
                className={cn(
                  "block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
                  !vendorFilter && "bg-muted"
                )}
              >
                All
              </button>
              {vendors.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => {
                    setVendorFilter(v);
                    setProvidersOpen(false);
                  }}
                  className={cn(
                    "block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
                    vendorFilter === v && "bg-muted"
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="relative ml-auto w-[200px]">
          <IconSearch className="absolute inset-y-0 my-auto inline-flex size-4 items-center justify-center left-2.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search models"
            className={cn(
              "h-8 w-full rounded-lg bg-transparent pl-8 pr-2.5 text-sm outline-none",
              "ring-1 ring-inset ring-border placeholder:text-muted-foreground",
              "focus-visible:ring-foreground"
            )}
          />
        </div>
      </div>

      {/* Scroll list — grouped into sections (Recommended / Premium / Tools …) */}
      <div className="nowheel min-h-0 flex-1 space-y-3 overflow-y-auto p-1">
        {groupedRows.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">
            {catalog ? "No models match." : "Loading models…"}
          </p>
        )}
        {groupedRows.map((section) => (
          <section key={section.key} className="space-y-1">
            <div className="flex items-center gap-2 px-2 pt-1 text-xs font-medium text-muted-foreground">
              <span>{section.label}</span>
            </div>
            {section.models.map((model) => {
              const Brand = brandIcon(model);
              const cost = cheapestSellPoints(model);
              const selected = model.id === selectedId;
              const isPinned = pinned.has(model.id);
              const badge = model.ui_policy?.recommended ? "PRO" : null;
              const fm = frameMode(model);
              const res = resolutionChip(model);
              const dur = durationChip(model);
              const audio = hasAudio(model);
              const lock = fizzAiModelLock(model);
              const tagline = model.description ?? model.ui_policy?.group ?? "—";
              return (
                <div key={model.id} className="group/model-row relative" data-state="closed">
                  <button
                    type="button"
                    disabled={Boolean(lock)}
                    aria-disabled={Boolean(lock)}
                    onClick={() => {
                      if (lock) return;
                      onSelect?.(model);
                    }}
                    className={cn(
                      // imagine: row resting bg = fill-primary-variant = neutral-100 (#171717),
                      // IDENTICAL to the modal's surface-primary-variant. So the row is
                      // flush with the panel — no seam, no separate card. Hover lifts one
                      // tier to neutral-90 (#212121) = studio's --card (oklch 0.215 ≈ #1F1F1F).
                      "flex w-full cursor-pointer items-start gap-3 rounded-xl bg-background p-2 pr-4 text-left transition-colors",
                      lock ? "opacity-45" : "hover:bg-card"
                    )}
                  >
                    {/* Icon tile: imagine bg-fill-primary-variant + border-border-secondary.
                    Same flush tone as the row (neutral-100); only the hairline border sets it off. */}
                    <div className="relative shrink-0">
                      <span className="flex size-10 items-center justify-center overflow-hidden rounded-lg border border-border bg-background [&_svg]:size-6">
                        <Brand className="size-6 text-foreground/80" />
                      </span>
                    </div>

                    {/* Text body */}
                    <div className="flex min-w-0 flex-1 flex-col">
                      {/* Name + PRO pill */}
                      <div className="flex items-center gap-1.5">
                        <span className="min-w-0 truncate text-sm font-medium text-foreground">
                          {model.name}
                        </span>
                        {badge && (
                          <span className="inline-flex w-fit shrink-0 items-center rounded-full bg-primary/15 px-1 text-[0.625rem] font-medium text-primary">
                            {badge}
                          </span>
                        )}
                      </div>
                      {/* Tagline */}
                      <span className="truncate text-xs text-muted-foreground/70">{tagline}</span>
                      {/* Chips row: flex flex-wrap gap-1 */}
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {lock && (
                          <Chip icon={IconLock}>
                            {lock.expired
                              ? "Membership expired"
                              : lock.requiredPlan
                                ? `${fizzAiPlanLabel(lock.requiredPlan)} plan`
                                : "Unavailable on your plan"}
                          </Chip>
                        )}
                        {cost != null && <Chip icon={IconCoin}>{cost} credits</Chip>}
                        {fm && <Chip icon={IconPlayerPlay}>{fm}</Chip>}
                        {res && <Chip icon={IconFrame}>{res}</Chip>}
                        {audio && <Chip icon={IconVolume}>Audio</Chip>}
                        {dur && <Chip icon={IconClock}>{dur}</Chip>}
                      </div>
                    </div>

                    {selected && !lock && (
                      <IconCheck className="mt-1 size-4 shrink-0 text-foreground" />
                    )}
                  </button>

                  {/* Pin (top-right, hover) */}
                  <button
                    type="button"
                    onClick={() => togglePin(model.id)}
                    aria-label="Pin model"
                    className={cn(
                      "absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-foreground/10 hover:text-foreground",
                      "group-hover/model-row:opacity-100",
                      isPinned && "opacity-100 text-foreground"
                    )}
                  >
                    <IconPin className={cn("size-3.5", isPinned && "fill-current")} />
                  </button>
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}

/* Live-catalog wrapper. */
export function ImagineModelPickerConnected({
  modality,
  selectedId,
  onSelect,
  onClose,
}: {
  modality: "image" | "video";
  selectedId?: string;
  onSelect?: (model: FizzAiModel) => void;
  onClose?: () => void;
}) {
  const { data: catalog } = useAiCatalog();
  return (
    <ImagineModelPicker
      catalog={catalog}
      modality={modality}
      selectedId={selectedId}
      onSelect={onSelect}
      onClose={onClose}
    />
  );
}
