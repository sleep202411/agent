"use client";

import { useMemo, useState } from "react";
import {
  IconAdjustmentsHorizontal,
  IconChevronDown,
  IconPhotoPlus,
  IconPlus,
  IconSend,
  IconSparkles,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";
import { FizzStudioShell, useFizzStudioWorkspace } from "./fizzstudio-shell";
import {
  DEFAULT_IMAGE_GENERATION_SETTINGS,
  getImageModelLabel,
  ImageSettingsPanel,
  type ImageGenerationSettings,
} from "./image-settings-panel";

type ImageStudioTab = "default" | "assist" | "apps";
type FeedTab = "inspirations" | "community" | "tutorial";

const IMAGE_STUDIO_TABS: ImageStudioTab[] = ["default", "assist", "apps"];
const FEED_TABS: FeedTab[] = ["inspirations", "community", "tutorial"];

const IMAGE_FEED = [
  {
    key: "dogPortrait",
    imageUrl:
      "https://images.unsplash.com/photo-1548199973-03cce0bbc87b?q=85&w=900&auto=format&fit=crop",
    className: "aspect-[1.02]",
    objectPosition: "center",
  },
  {
    key: "catInterior",
    imageUrl:
      "https://images.unsplash.com/photo-1574158622682-e40e69881006?q=85&w=1000&auto=format&fit=crop",
    className: "aspect-[1.42]",
    objectPosition: "center 42%",
  },
  {
    key: "sunlitCat",
    imageUrl:
      "https://images.unsplash.com/photo-1518791841217-8f162f1e1131?q=85&w=900&auto=format&fit=crop",
    className: "aspect-[1.12]",
    objectPosition: "center",
  },
  {
    key: "botanical",
    imageUrl:
      "https://images.unsplash.com/photo-1463320726281-696a485928c7?q=85&w=900&auto=format&fit=crop",
    className: "aspect-[0.8]",
    objectPosition: "center",
  },
  {
    key: "glassOrb",
    imageUrl:
      "https://images.unsplash.com/photo-1519681393784-d120267933ba?q=85&w=1100&auto=format&fit=crop",
    className: "aspect-[1.35]",
    objectPosition: "center",
  },
  {
    key: "productLight",
    imageUrl:
      "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?q=85&w=1000&auto=format&fit=crop",
    className: "aspect-[1.15]",
    objectPosition: "center",
  },
  {
    key: "portraitFashion",
    imageUrl:
      "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?q=85&w=900&auto=format&fit=crop",
    className: "aspect-[0.72]",
    objectPosition: "center 36%",
  },
  {
    key: "warmRoom",
    imageUrl:
      "https://images.unsplash.com/photo-1513694203232-719a280e022f?q=85&w=1000&auto=format&fit=crop",
    className: "aspect-[1.48]",
    objectPosition: "center",
  },
  {
    key: "neonAbstract",
    imageUrl:
      "https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=85&w=1000&auto=format&fit=crop",
    className: "aspect-[1.08]",
    objectPosition: "center",
  },
  {
    key: "mountain",
    imageUrl:
      "https://images.unsplash.com/photo-1549880338-65ddcdfd017b?q=85&w=1100&auto=format&fit=crop",
    className: "aspect-[1.62]",
    objectPosition: "center",
  },
  {
    key: "studioFood",
    imageUrl:
      "https://images.unsplash.com/photo-1504674900247-0877df9cc836?q=85&w=1000&auto=format&fit=crop",
    className: "aspect-[1.2]",
    objectPosition: "center",
  },
  {
    key: "cinematicRoad",
    imageUrl:
      "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?q=85&w=1000&auto=format&fit=crop",
    className: "aspect-[1.35]",
    objectPosition: "center 42%",
  },
];

export function ImageStudioPage() {
  const workspaceState = useFizzStudioWorkspace();

  return (
    <FizzStudioShell
      className="overflow-x-hidden bg-[#09090a]"
      headerVariant="enterprise"
      mainClassName="max-w-none px-0 pt-0"
      sidebarVariant="enterprise"
      workspaceState={workspaceState}
    >
      <ImageStudioSurface />
    </FizzStudioShell>
  );
}

function ImageStudioSurface() {
  const t = useTranslations("fizzStudio.imageStudio");
  const [activeTab, setActiveTab] = useState<ImageStudioTab>("default");
  const [feedTab, setFeedTab] = useState<FeedTab>("inspirations");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<ImageGenerationSettings>(
    DEFAULT_IMAGE_GENERATION_SETTINGS
  );

  const feedItems = useMemo(() => {
    if (feedTab === "community") return IMAGE_FEED.slice(2).concat(IMAGE_FEED.slice(0, 2));
    if (feedTab === "tutorial") return IMAGE_FEED.slice(5).concat(IMAGE_FEED.slice(0, 5));
    return IMAGE_FEED;
  }, [feedTab]);

  return (
    <div className="relative min-h-[calc(100svh-64px)] pb-56 text-white">
      <ImageStudioTopBar activeTab={activeTab} onTabChange={setActiveTab} />

      <section className="px-4 pb-10 pt-5 sm:px-6 xl:px-8">
        <div className="mx-auto max-w-none">
          <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.08em] text-[#a88cff]">
                <IconSparkles className="size-4" stroke={1.8} />
                {t("eyebrow")}
              </div>
              <h1 className="mt-2 text-[30px] font-semibold leading-tight tracking-[-0.015em] text-white">
                {t("feedTitle")}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/48">{t("feedSubtitle")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {FEED_TABS.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  aria-pressed={feedTab === tab}
                  onClick={() => setFeedTab(tab)}
                  className={cn(
                    "h-8 rounded-full border px-3.5 text-sm font-semibold transition-colors",
                    feedTab === tab
                      ? "border-white/18 bg-white/12 text-white"
                      : "border-white/10 bg-white/[0.03] text-white/58 hover:border-white/18 hover:text-white"
                  )}
                >
                  {t(`feedTabs.${tab}`)}
                </button>
              ))}
            </div>
          </div>

          <ImageMasonry items={feedItems} />
        </div>
      </section>

      <ImagePromptComposer
        settings={settings}
        settingsOpen={settingsOpen}
        onOpenSettingsChange={setSettingsOpen}
        onSettingsChange={setSettings}
      />
    </div>
  );
}

function ImageStudioTopBar({
  activeTab,
  onTabChange,
}: {
  activeTab: ImageStudioTab;
  onTabChange: (tab: ImageStudioTab) => void;
}) {
  const t = useTranslations("fizzStudio.imageStudio");

  return (
    <div className="sticky top-16 z-30 border-b border-white/[0.06] bg-[#09090a]/88 backdrop-blur-xl">
      <div className="flex h-14 items-center gap-4 px-4 sm:px-6 xl:px-8">
        <div className="shrink-0 text-base font-semibold text-white">{t("title")}</div>
        <div
          role="tablist"
          aria-label={t("modeTabsLabel")}
          className="flex h-8 rounded-[14px] bg-white/[0.04] p-1"
        >
          {IMAGE_STUDIO_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => onTabChange(tab)}
              className={cn(
                "h-6 min-w-[78px] rounded-[10px] px-3 text-sm font-semibold transition-colors",
                activeTab === tab ? "bg-white/12 text-white" : "text-white/42 hover:text-white"
              )}
            >
              {t(`modeTabs.${tab}`)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ImageMasonry({ items }: { items: typeof IMAGE_FEED }) {
  const t = useTranslations("fizzStudio.imageStudio");

  return (
    <div className="columns-1 gap-3 sm:columns-2 xl:columns-3 2xl:columns-4">
      {items.map((item, index) => (
        <article
          key={`${item.key}-${index}`}
          className={cn(
            "group relative mb-3 break-inside-avoid overflow-hidden rounded-[16px] bg-[#171719] shadow-[0_18px_55px_rgba(0,0,0,.32)] ring-1 ring-white/[0.08]",
            item.className
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.imageUrl}
            alt={t(`galleryAlt.${item.key}`)}
            className="size-full object-cover transition duration-500 group-hover:scale-[1.035]"
            style={{ objectPosition: item.objectPosition }}
          />
          <div className="pointer-events-none absolute inset-0 bg-linear-to-b from-black/0 via-black/0 to-black/32 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
          <div className="absolute inset-x-3 bottom-3 flex translate-y-2 items-center justify-between gap-2 opacity-0 transition duration-300 group-hover:translate-y-0 group-hover:opacity-100">
            <span className="rounded-full bg-black/48 px-3 py-1 text-xs font-semibold text-white backdrop-blur-md">
              {t("recreate")}
            </span>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#111]">
              {t("edit")}
            </span>
          </div>
        </article>
      ))}
    </div>
  );
}

function ImagePromptComposer({
  settings,
  settingsOpen,
  onOpenSettingsChange,
  onSettingsChange,
}: {
  settings: ImageGenerationSettings;
  settingsOpen: boolean;
  onOpenSettingsChange: (open: boolean) => void;
  onSettingsChange: (settings: ImageGenerationSettings) => void;
}) {
  const t = useTranslations("fizzStudio.imageStudio");
  const modelLabel = getImageModelLabel(t, settings.model);

  return (
    <div className="fixed inset-x-4 bottom-4 z-40 lg:left-[312px] lg:right-6">
      <ImageSettingsPanel
        open={settingsOpen}
        settings={settings}
        onOpenChange={onOpenSettingsChange}
        onSettingsChange={onSettingsChange}
      />
      <div className="w-full overflow-hidden rounded-[26px] border border-white/[0.08] bg-[#151516]/96 text-white shadow-[0_24px_90px_rgba(0,0,0,.58)] backdrop-blur-2xl">
        <div className="grid gap-0 md:grid-cols-[168px_1fr]">
          <div className="hidden border-r border-white/[0.07] p-4 md:block">
            <button
              type="button"
              className="flex h-[86px] w-full items-center justify-center rounded-[18px] border border-white/[0.10] bg-[#111112] text-white/70 transition-colors hover:border-white/20 hover:bg-white/[0.04] hover:text-white"
              aria-label={t("addImage")}
            >
              <IconPlus className="size-5" stroke={1.9} />
            </button>
            <button
              type="button"
              className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-full border border-white/[0.12] bg-transparent px-3 text-sm font-semibold text-white/86 transition-colors hover:border-white/24 hover:bg-white/[0.05] hover:text-white"
            >
              <IconPlus className="size-4" stroke={1.9} />
              {t("addImage")}
            </button>
          </div>

          <div className="min-w-0 p-4">
            <label className="sr-only" htmlFor="image-prompt">
              {t("promptLabel")}
            </label>
            <textarea
              id="image-prompt"
              maxLength={800}
              placeholder={t("promptPlaceholder")}
              className="h-20 w-full resize-none bg-transparent text-[17px] leading-7 text-white outline-none placeholder:text-white/34 md:h-[76px]"
            />
            <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  aria-expanded={settingsOpen}
                  onClick={() => onOpenSettingsChange(!settingsOpen)}
                  className="inline-flex h-10 items-center gap-2 rounded-[14px] border border-white/[0.10] bg-white/[0.035] px-4 text-sm font-semibold text-white transition-colors hover:border-white/22 hover:bg-white/[0.07]"
                >
                  <IconAdjustmentsHorizontal className="size-4" stroke={1.8} />
                  {modelLabel} / {settings.aspectRatio}
                  <IconChevronDown className="size-4 text-white/48" stroke={1.9} />
                </button>
                <button
                  type="button"
                  className="inline-flex h-10 items-center gap-2 rounded-[14px] border border-white/[0.10] bg-white/[0.035] px-4 text-sm font-semibold text-white transition-colors hover:border-white/22 hover:bg-white/[0.07]"
                >
                  {t("generateFree")}
                  <span className="flex h-5 w-9 items-center rounded-full bg-white/[0.16] p-0.5">
                    <span className="size-4 rounded-full bg-white" />
                  </span>
                </button>
                <button
                  type="button"
                  className="inline-flex h-10 items-center gap-2 rounded-[14px] border border-white/[0.10] bg-white/[0.035] px-4 text-sm font-semibold text-white transition-colors hover:border-white/22 hover:bg-white/[0.07]"
                >
                  <IconPhotoPlus className="size-4" stroke={1.8} />
                  {t("addReferences")}
                </button>
              </div>
              <button
                type="button"
                className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-[18px] bg-[radial-gradient(120%_120%_at_50%_0%,#a955ff_0%,#8b3ffc_52%,#6d25d7_100%)] px-9 text-lg font-semibold text-white shadow-[0_18px_38px_rgba(138,63,252,.32),inset_0_-4px_0_#491d8b] transition hover:scale-[1.01] active:translate-y-px"
              >
                {t("create")}
                <IconSend className="size-5" stroke={1.9} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
