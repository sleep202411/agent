"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  IconBolt,
  IconBrandGoogle,
  IconBrandOpenai,
  IconBrandTiktok,
  IconCheck,
  IconChevronDown,
  IconCube,
  IconLock,
  IconSearch,
  IconSparkles,
  type Icon,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import {
  cheapestSellPoints,
  fizzAiModelLock,
  fizzAiPlanLabel,
  isOperationOnlyModel,
  type FizzAiCatalog,
  type FizzAiModel,
} from "@/lib/canvas-authoring/generation-api";
import {
  visibleModelsByModality,
  type StudioModality,
} from "@/lib/canvas-authoring/use-ai-catalog";

/** Vendor is user-facing; runtime providers (fal-ai / google-vertex / …) are not. */
function VendorGlyph({ vendor, className }: { vendor: string | undefined; className?: string }) {
  const value = vendor?.trim().toLowerCase() ?? "";
  if (value.includes("openai")) return <IconBrandOpenai className={className} stroke={1.8} />;
  if (value.includes("google")) return <IconBrandGoogle className={className} stroke={1.8} />;
  if (value.includes("bytedance") || value.includes("byteplus")) {
    return <IconBrandTiktok className={className} stroke={1.8} />;
  }
  if (value.includes("black forest")) return <IconBolt className={className} stroke={1.8} />;
  if (value.includes("alibaba")) return <IconCube className={className} stroke={1.8} />;
  return <IconSparkles className={className} stroke={1.8} />;
}

function modelVendor(model: FizzAiModel, otherLabel: string): string {
  return model.vendor?.trim() || otherLabel;
}

function isFeaturedModel(model: FizzAiModel, selectedId: string | undefined): boolean {
  return model.id === selectedId || model.ui_policy?.recommended === true;
}

type ModelTaglineKey =
  | "fastLowCostImage"
  | "fastBalancedImage"
  | "fastDraftImage"
  | "flagshipImage"
  | "highQualityImage"
  | "photorealImage"
  | "textClearImage"
  | "balancedImage"
  | "creativeImage"
  | "fastLowCostVideo"
  | "fastBalancedVideo"
  | "cinematicVideo"
  | "stableMotionVideo"
  | "creativeVideo"
  | "expressiveAudio";

const MODEL_TAGLINES: Record<string, ModelTaglineKey> = {
  "gpt-image-2": "textClearImage",
  "flux-2-pro": "photorealImage",
  "flux-2-flex": "textClearImage",
  "flux-2-max": "flagshipImage",
  "flux-2-dev": "fastLowCostImage",
  "wan-image-2.7-pro": "highQualityImage",
  "wan-image-2.7": "balancedImage",
  "qwen-image-2.0-pro": "textClearImage",
  "qwen-image-2.0": "balancedImage",
  "nano-banana": "fastLowCostImage",
  "quick-image-1-0": "fastLowCostImage",
  "nano-banana-2": "fastBalancedImage",
  "nano-banana-pro": "flagshipImage",
  "seedream-4": "creativeImage",
  "seedream-4.5": "highQualityImage",
  "seedream-5-lite": "fastBalancedImage",
  "quick-video-1-0": "fastLowCostVideo",
  "seedance-2-5": "cinematicVideo",
  "seedance-2-0": "cinematicVideo",
  "seedance-2-0-fast": "fastBalancedVideo",
  "wan-3-0": "cinematicVideo",
  "wan-2-7": "stableMotionVideo",
  "happyhorse-1-0": "creativeVideo",
  "kling-motion": "stableMotionVideo",
};

function modelTaglineKey(model: FizzAiModel): ModelTaglineKey {
  if (model.type === "audio") return "expressiveAudio";
  return (
    MODEL_TAGLINES[model.id] ?? (model.type === "video" ? "stableMotionVideo" : "fastDraftImage")
  );
}

function modelSearchRank(model: FizzAiModel, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const name = model.name.toLowerCase();
  const words = name.split(/[^a-z0-9]+/).filter(Boolean);
  const vendor = model.vendor?.trim().toLowerCase() ?? "";
  const vendorWords = vendor.split(/[^a-z0-9]+/).filter(Boolean);
  const family = model.family?.trim().toLowerCase() ?? "";

  if (name.startsWith(q)) return 0;
  if (words.some((word) => word.startsWith(q))) return 1;
  if (name.includes(q)) return 2;
  if (vendor.startsWith(q)) return 3;
  if (vendorWords.some((word) => word.startsWith(q))) return 4;
  if (vendor.includes(q)) return 5;
  if (family.includes(q)) return 6;
  return Number.POSITIVE_INFINITY;
}

type ModelSection = {
  id: string;
  title: string;
  icon: Icon;
  models: FizzAiModel[];
};

/** Floating model selector opened from the composer's model pill. */
export function ModelPicker({
  catalog,
  modality,
  selectedId,
  placement = "top",
  align = "left",
  onSelect,
  onClose,
}: {
  catalog: FizzAiCatalog | undefined;
  modality: StudioModality;
  selectedId?: string;
  placement?: "top" | "bottom";
  align?: "left" | "right";
  onSelect: (model: FizzAiModel) => void;
  onClose: () => void;
}) {
  const t = useTranslations("canvasControls");
  const [query, setQuery] = useState("");
  const [vendorFilter, setVendorFilter] = useState<string | null>(null);
  const [vendorMenuOpen, setVendorMenuOpen] = useState(false);
  const vendorMenuRef = useRef<HTMLDivElement>(null);

  const models = useMemo(
    () =>
      (catalog ? visibleModelsByModality(catalog, modality) : []).filter(
        (model) => !isOperationOnlyModel(model) && !/hunyuan|panorama/i.test(model.id)
      ),
    [catalog, modality]
  );

  const vendors = useMemo(() => {
    const values = new Set(models.map((model) => modelVendor(model, t("modelPicker.otherVendor"))));
    return Array.from(values).sort((left, right) => left.localeCompare(right));
  }, [models, t]);

  const activeVendor = vendorFilter && vendors.includes(vendorFilter) ? vendorFilter : null;

  useEffect(() => {
    if (!vendorMenuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!vendorMenuRef.current?.contains(event.target as Node)) setVendorMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setVendorMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [vendorMenuOpen]);

  const sections = useMemo<ModelSection[]>(() => {
    const q = query.trim().toLowerCase();
    const vendorModels = activeVendor
      ? models.filter((model) => modelVendor(model, t("modelPicker.otherVendor")) === activeVendor)
      : models;
    const filtered = q
      ? vendorModels
          .map((model, index) => ({
            model,
            index,
            rank: modelSearchRank(model, q),
          }))
          .filter((item) => Number.isFinite(item.rank))
          .sort((a, b) => a.rank - b.rank || a.index - b.index)
          .map((item) => item.model)
      : vendorModels;
    // Locked models stay in the list but sink below the ones this plan can
    // run, so gating never pushes a usable model off the first screen.
    const ordered = [
      ...filtered.filter((m) => !fizzAiModelLock(m)),
      ...filtered.filter((m) => fizzAiModelLock(m)),
    ];
    if (q) {
      return [
        {
          id: "search",
          title: t("modelPicker.searchResults"),
          icon: IconSearch,
          models: ordered,
        },
      ];
    }

    const featured = ordered.filter((model) => isFeaturedModel(model, selectedId));
    const featuredIds = new Set(featured.map((model) => model.id));
    const remaining = ordered.filter((model) => !featuredIds.has(model.id));
    return [
      ...(featured.length > 0
        ? [
            {
              id: "featured",
              title: t("modelPicker.featuredModels"),
              icon: IconSparkles,
              models: featured,
            },
          ]
        : []),
      ...(remaining.length > 0
        ? [
            {
              id: "all",
              title: t("modelPicker.allModels"),
              icon: IconSparkles,
              models: remaining,
            },
          ]
        : []),
    ];
  }, [activeVendor, models, query, selectedId, t]);

  const hasModels = sections.some((section) => section.models.length > 0);

  return (
    <div
      role="dialog"
      aria-label={t("modelPicker.allModels")}
      className={cn(
        "nodrag absolute z-50 flex max-h-[460px] w-[380px] flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-[oklch(0.235_0_0_/_0.95)] shadow-2xl shadow-black/60 backdrop-blur-2xl",
        "duration-150 animate-in fade-in-0 zoom-in-95",
        placement === "top" ? "bottom-full mb-2 origin-bottom" : "top-full mt-2 origin-top",
        align === "left" ? "left-0" : "right-0"
      )}
    >
      <div className="flex items-center gap-2 px-3 pt-3 pb-3">
        <div className="flex min-w-0 flex-1 items-center gap-2.5 px-1">
          <IconSearch className="size-4.5 shrink-0 text-muted-foreground" stroke={1.8} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("modelPicker.searchPlaceholder")}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        {vendors.length > 0 && (
          <div ref={vendorMenuRef} className="relative shrink-0">
            <button
              type="button"
              aria-label={t("modelPicker.filterByVendor")}
              aria-haspopup="menu"
              aria-expanded={vendorMenuOpen}
              onClick={() => setVendorMenuOpen((open) => !open)}
              className={cn(
                "flex h-8 max-w-[132px] items-center gap-1.5 rounded-lg bg-white/[0.05] px-2.5 text-xs text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground",
                activeVendor && "bg-white/[0.08] text-foreground"
              )}
            >
              <VendorGlyph vendor={activeVendor ?? undefined} className="size-4 shrink-0" />
              <span className="truncate">{activeVendor ?? t("modelPicker.vendor")}</span>
              <IconChevronDown
                className={cn(
                  "size-3.5 shrink-0 transition-transform",
                  vendorMenuOpen && "rotate-180"
                )}
                stroke={1.8}
              />
            </button>
            {vendorMenuOpen && (
              <div
                role="menu"
                aria-label={t("modelPicker.filterByVendor")}
                data-vendor-menu
                className="absolute top-full right-0 z-60 mt-1.5 w-52 rounded-xl bg-[oklch(0.255_0_0_/_0.98)] p-1.5 shadow-2xl shadow-black/60 backdrop-blur-2xl"
              >
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={!activeVendor}
                  onClick={() => {
                    setVendorFilter(null);
                    setVendorMenuOpen(false);
                  }}
                  className={cn(
                    "flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm transition-colors hover:bg-white/[0.06]",
                    !activeVendor && "bg-white/[0.07]"
                  )}
                >
                  <IconSparkles className="size-4 shrink-0 text-muted-foreground" stroke={1.8} />
                  <span className="min-w-0 flex-1 truncate">{t("modelPicker.allVendors")}</span>
                  {!activeVendor && <IconCheck className="size-4 shrink-0" stroke={2} />}
                </button>
                {vendors.map((vendor) => {
                  const selected = activeVendor === vendor;
                  return (
                    <button
                      key={vendor}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      onClick={() => {
                        setVendorFilter(vendor);
                        setVendorMenuOpen(false);
                      }}
                      className={cn(
                        "flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm transition-colors hover:bg-white/[0.06]",
                        selected && "bg-white/[0.07]"
                      )}
                    >
                      <VendorGlyph
                        vendor={vendor}
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                      <span className="min-w-0 flex-1 truncate">{vendor}</span>
                      {selected && <IconCheck className="size-4 shrink-0" stroke={2} />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mx-1 h-px bg-border" />

      <div
        data-canvas-scroll-owner="y"
        className="nowheel min-h-0 flex-1 space-y-3 overflow-y-auto p-2"
      >
        {!hasModels && (
          <p className="p-3 text-sm text-muted-foreground">
            {catalog ? t("modelPicker.noModels") : t("modelPicker.signInToLoad")}
          </p>
        )}
        {sections.map((section) => {
          if (section.models.length === 0) return null;
          const SectionIcon = section.icon;
          return (
            <section key={section.id} className="space-y-1">
              <div className="flex items-center gap-2 px-2 pt-1 text-xs font-medium text-muted-foreground">
                <SectionIcon className="size-4" stroke={1.8} />
                <span>{section.title}</span>
              </div>
              {section.models.map((model) => {
                const cost = cheapestSellPoints(model);
                const vendor = modelVendor(model, t("modelPicker.otherVendor"));
                const selected = model.id === selectedId;
                const lock = fizzAiModelLock(model);
                const tagline = !lock
                  ? t(`modelPicker.taglines.${modelTaglineKey(model)}`)
                  : lock.expired
                    ? t("modelPicker.membershipExpired")
                    : lock.requiredPlan
                      ? t("modelPicker.requiresPlan", {
                          plan: fizzAiPlanLabel(lock.requiredPlan),
                        })
                      : t("modelPicker.locked");
                return (
                  <button
                    key={model.id}
                    type="button"
                    disabled={Boolean(lock)}
                    aria-disabled={Boolean(lock)}
                    onClick={() => {
                      if (lock) return;
                      onSelect(model);
                      onClose();
                    }}
                    className={cn(
                      "group block w-full rounded-xl p-2.5 text-left transition-colors",
                      lock ? "opacity-45" : "hover:bg-white/[0.06]",
                      selected && "bg-white/[0.07]"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">
                        <VendorGlyph vendor={vendor} className="size-5 text-white/80" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="min-w-0 truncate text-sm font-medium">{model.name}</span>
                          <span className="shrink-0 text-xs text-muted-foreground/70">
                            {vendor}
                          </span>
                        </span>
                        <span className="mt-0.5 block truncate text-xs leading-5 text-muted-foreground">
                          {tagline}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {lock ? (
                          <IconLock className="size-4 text-muted-foreground" stroke={1.8} />
                        ) : (
                          <>
                            {cost != null && (
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <IconBolt className="size-3.5" stroke={1.8} />
                                {cost}
                              </span>
                            )}
                            {selected && <IconCheck className="size-4 text-white" stroke={2} />}
                          </>
                        )}
                      </span>
                    </div>
                  </button>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
