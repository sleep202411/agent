"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { IconArrowRight, IconChevronRight, IconPlus, IconVideo } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import type { Locale } from "@/src/i18n/config";
import { useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import {
  ENTERPRISE_GUIDE_CARDS,
  ENTERPRISE_HERO_ASSETS,
  ENTERPRISE_NEWS_ITEMS,
  ENTERPRISE_TEMPLATE_CARDS,
  ENTERPRISE_TEMPLATE_CATEGORIES,
  type EnterpriseTemplateCategory,
} from "../_data/preview-data";
import { useProjects } from "../../_hooks/use-project";
import { CreateProjectDialog } from "./create-project-dialog";
import { FizzStudioShell, useFizzStudioWorkspace } from "./fizzstudio-shell";
import { RecentProjectsSection } from "./project-sections";

type TemplateFilter = EnterpriseTemplateCategory | "all";

export function FizzStudioPreview() {
  const [createOpen, setCreateOpen] = useState(false);
  const [templateFilter, setTemplateFilter] = useState<TemplateFilter>("all");
  const workspaceState = useFizzStudioWorkspace();
  const { currentLocale, isWorkspaceLoading, workspaceId } = workspaceState;
  const { data: projects = [], isLoading: loadingProjects } = useProjects(workspaceId);

  const templateCards = useMemo(() => {
    if (templateFilter === "all") return ENTERPRISE_TEMPLATE_CARDS;
    return ENTERPRISE_TEMPLATE_CARDS.filter((item) => item.category === templateFilter);
  }, [templateFilter]);

  return (
    <FizzStudioShell
      className="overflow-x-hidden bg-[#0d0d0e] pb-20"
      headerVariant="enterprise"
      mainClassName="max-w-none px-0 pt-0"
      sidebarVariant="enterprise"
      workspaceState={workspaceState}
    >
      <EnterpriseHero onCreateProject={() => setCreateOpen(true)} />

      <section>
        <WhatsNewSection />

        <RecentProjectsSection
          currentLocale={currentLocale}
          isLoading={isWorkspaceLoading || loadingProjects}
          onCreateProject={() => setCreateOpen(true)}
          projects={projects}
          workspaceReady={Boolean(workspaceId)}
        />

        <TemplateSection
          activeFilter={templateFilter}
          cards={templateCards}
          currentLocale={currentLocale}
          onFilterChange={setTemplateFilter}
        />

        <GuidesSection />
      </section>

      {workspaceId && (
        <CreateProjectDialog
          workspaceId={workspaceId}
          open={createOpen}
          onOpenChange={setCreateOpen}
        />
      )}
    </FizzStudioShell>
  );
}

function EnterpriseHero({ onCreateProject }: { onCreateProject: () => void }) {
  const t = useTranslations("fizzStudio");

  return (
    <section className="relative min-h-[640px] overflow-hidden pt-[72px]">
      <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[56%] lg:block">
        <div className="absolute inset-y-8 right-8 w-[78%] opacity-35 [background-image:radial-gradient(circle,rgba(255,255,255,.16)_1px,transparent_1px)] [background-size:9px_9px]" />
        {ENTERPRISE_HERO_ASSETS.map((asset) => (
          <div
            key={asset.imageUrl}
            className={cn(
              "absolute overflow-hidden rounded-[18px] bg-[#1a1a1c] shadow-[0_24px_70px_rgba(0,0,0,.42)] ring-1 ring-white/[0.08]",
              asset.className
            )}
            style={{
              backgroundImage: `linear-gradient(180deg,rgba(0,0,0,0.04),rgba(0,0,0,0.28)),url(${asset.imageUrl})`,
              backgroundPosition: "center",
              backgroundSize: "cover",
            }}
          />
        ))}
      </div>

      <div className="relative z-10 max-w-[680px]">
        <h1 className="max-w-[620px] text-[34px] font-semibold leading-tight tracking-[-0.02em] text-white sm:text-[40px] lg:text-[42px]">
          {t("enterpriseHome.heroTitle")}
        </h1>
        <p className="mt-4 max-w-[620px] text-lg leading-8 text-white/58">
          {t("enterpriseHome.heroSubtitle")}
        </p>
        <button
          type="button"
          onClick={onCreateProject}
          className="mt-5 inline-flex h-11 items-center gap-2 rounded-[16px] bg-white px-5 text-base font-semibold text-[#111] shadow-[0_18px_45px_rgba(0,0,0,.25)] transition hover:scale-[1.015]"
        >
          <IconPlus className="size-5" stroke={1.8} />
          {t("enterpriseHome.createNewProject")}
        </button>
      </div>
    </section>
  );
}

function WhatsNewSection() {
  const t = useTranslations("fizzStudio");

  return (
    <section className="-mt-[320px]" aria-labelledby="whats-new">
      <h2 id="whats-new" className="text-xl font-semibold tracking-[-0.01em] text-white">
        {t("enterpriseHome.whatsNew")}
      </h2>
      <div className="mt-4 overflow-x-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex gap-4">
          {ENTERPRISE_NEWS_ITEMS.map((item) => (
            <article key={item.key} className="w-[min(400px,78vw)] shrink-0">
              <div
                className={cn(
                  "relative aspect-[1.72] overflow-hidden rounded-2xl bg-[#1b1b1d] shadow-[0_18px_55px_rgba(0,0,0,.35)] ring-1 ring-white/[0.08]",
                  item.mode === "light" && "bg-white",
                  item.mode === "panel" && "bg-[#232326]"
                )}
              >
                {item.mode === "light" ? (
                  <div className="absolute left-7 top-1/2 -translate-y-1/2 whitespace-nowrap text-[88px] font-light italic leading-none tracking-[-0.08em] text-black md:text-[96px]">
                    {t("enterpriseHome.simpleModeWord")}
                  </div>
                ) : item.mode === "panel" ? (
                  <div className="relative size-full overflow-hidden bg-[#242426] text-white/56">
                    <div className="absolute inset-x-0 top-0 h-[36%] bg-[#151517]" />
                    <div className="absolute inset-x-0 bottom-0 h-[22%] border-t border-white/[0.05] bg-[#1b1b1d] px-5 py-3 text-[10px] text-white/44">
                      <div>{t("enterpriseHome.panelLabels.writePrompt")}</div>
                      <div className="mt-2 flex items-center gap-2">
                        <span>{t("enterpriseHome.panelLabels.multiPrompts")}</span>
                        <span className="size-2 rounded-full border border-white/30" />
                        <span className="size-2 rounded-full border border-white/18" />
                      </div>
                    </div>
                    <div className="absolute left-5 top-4 space-y-2 text-[10px]">
                      {(["negativePrompt", "firstFrame", "lastFrame"] as const).map((key) => (
                        <div key={key} className="flex items-center gap-2">
                          <span>{t(`enterpriseHome.panelLabels.${key}`)}</span>
                          <span className="size-2 rounded-full border border-[#f6a43a]" />
                        </div>
                      ))}
                    </div>
                    <div className="absolute bottom-[39%] left-[44%] flex items-center gap-2 text-xs">
                      <IconVideo className="size-4" />
                      {t("enterpriseHome.panelLabels.result")}
                      <IconChevronRight className="size-4" />
                    </div>
                  </div>
                ) : (
                  <div
                    className="absolute inset-0 bg-cover bg-center"
                    style={{
                      backgroundImage: `url(${item.imageUrl})`,
                      backgroundPosition: item.objectPosition ?? "center",
                    }}
                  />
                )}
              </div>
              <h3 className="mt-3 text-base font-semibold uppercase leading-tight text-white">
                {t(`enterpriseHome.news.${item.key}`)}
              </h3>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function TemplateSection({
  activeFilter,
  cards,
  currentLocale,
  onFilterChange,
}: {
  activeFilter: TemplateFilter;
  cards: typeof ENTERPRISE_TEMPLATE_CARDS;
  currentLocale: Locale;
  onFilterChange: (filter: TemplateFilter) => void;
}) {
  const t = useTranslations("fizzStudio");

  return (
    <section id="templates" className="mt-16 space-y-4" aria-labelledby="template-title">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <h2 id="template-title" className="text-xl font-semibold tracking-[-0.01em] text-white">
          {t("enterpriseHome.startWithTemplate")}
        </h2>
        <div className="flex flex-wrap gap-2">
          {(["all", ...ENTERPRISE_TEMPLATE_CATEGORIES] as TemplateFilter[]).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={activeFilter === item}
              onClick={() => onFilterChange(item)}
              className={cn(
                "h-8 rounded-full border px-3.5 text-sm transition-colors",
                activeFilter === item
                  ? "border-white/20 bg-white/12 text-white"
                  : "border-white/10 bg-white/[0.025] text-white/64 hover:border-white/18 hover:text-white"
              )}
            >
              {item === "all"
                ? t("enterpriseHome.showAll")
                : t(`enterpriseHome.templateCategories.${item}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <TemplateCard key={card.key} card={card} currentLocale={currentLocale} />
        ))}
      </div>
    </section>
  );
}

function TemplateCard({
  card,
  currentLocale,
}: {
  card: (typeof ENTERPRISE_TEMPLATE_CARDS)[number];
  currentLocale: Locale;
}) {
  const t = useTranslations("fizzStudio");
  const href = localizePath("/fizzstudio/projects", currentLocale);

  return (
    <article className="group relative flex h-[184px] cursor-pointer items-end justify-between gap-3 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#171719] p-3 shadow-sm shadow-black/25 transition duration-200 hover:border-white/[0.18] hover:bg-[#202023]">
      <Link
        href={href}
        aria-label={t("enterpriseHome.useTemplate", {
          title: t(`enterpriseHome.templates.${card.key}`),
        })}
        className="absolute inset-0 z-10 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      />
      <h3 className="pointer-events-none relative z-20 max-w-[38%] pb-1 text-base font-semibold leading-tight text-white">
        {t(`enterpriseHome.templates.${card.key}`)}
      </h3>
      <div className="pointer-events-none relative z-20 h-full w-[60%] overflow-hidden rounded-xl bg-[#252527] ring-1 ring-white/[0.06]">
        <div
          className="absolute inset-0 bg-cover bg-center transition duration-300 group-hover:scale-[1.035] group-hover:brightness-105"
          style={{
            backgroundImage: `url(${card.imageUrl})`,
            backgroundPosition: card.objectPosition ?? "center",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-br from-black/10 via-transparent to-black/36" />
      </div>
      <Link
        href={href}
        className="absolute bottom-4 right-4 z-30 inline-flex h-8 translate-y-1 items-center gap-1.5 rounded-full bg-white px-3 text-xs font-semibold text-[#111] opacity-0 shadow-lg shadow-black/35 transition duration-200 hover:scale-[1.03] group-hover:translate-y-0 group-hover:opacity-100 focus-visible:translate-y-0 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      >
        {t("projects.use")}
        <IconArrowRight className="size-3.5" />
      </Link>
    </article>
  );
}

function GuidesSection() {
  const t = useTranslations("fizzStudio");

  return (
    <section className="mt-16 pb-16" aria-labelledby="guides-title">
      <h2 id="guides-title" className="text-xl font-semibold tracking-[-0.01em] text-white">
        {t("enterpriseHome.guides")}
      </h2>
      <div className="mt-4 overflow-x-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex gap-4">
          {ENTERPRISE_GUIDE_CARDS.map((card) => (
            <article key={card.key} className="w-[320px] shrink-0 cursor-pointer space-y-2">
              <div
                className="h-[180px] rounded-2xl bg-[#202023] bg-cover bg-center shadow-[0_18px_55px_rgba(0,0,0,.35)] ring-1 ring-white/[0.08] transition duration-200 hover:-translate-y-0.5 hover:ring-white/[0.18]"
                style={{
                  backgroundImage: `linear-gradient(180deg,rgba(0,0,0,0.04),rgba(0,0,0,0.32)),url(${card.imageUrl})`,
                  backgroundPosition: card.objectPosition ?? "center",
                }}
              />
              <h3 className="text-sm font-semibold text-white/82">
                {t(`enterpriseHome.guidesItems.${card.key}`)}
              </h3>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
