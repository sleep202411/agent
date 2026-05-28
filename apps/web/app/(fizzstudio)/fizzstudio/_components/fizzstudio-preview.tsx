"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  IconArrowRight,
  IconBell,
  IconChartBar,
  IconChevronDown,
  IconDatabase,
  IconFolders,
  IconHome,
  IconMicrophone,
  IconPaperclip,
  IconPlus,
  IconPhotoSpark,
  IconSearch,
  IconSend,
  IconSettings,
  IconSparkles,
  IconVideo,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import type { Locale } from "@/src/i18n/config";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import { PROJECT_CARDS, SHOW_CATEGORIES, SHOW_WORKS, type ShowWork } from "../_data/preview-data";
import { FizzStudioHeroCarousel } from "./fizzstudio-hero-carousel";

export function FizzStudioPreview() {
  const t = useTranslations("fizzStudio");
  const locale = useLocale();
  const currentLocale = locale as Locale;

  return (
    <div className="min-h-screen bg-[#0f0f10] pb-36 text-white lg:grid lg:grid-cols-[260px_minmax(0,1fr)]">
      <Sidebar currentLocale={currentLocale} />

      <div className="min-w-0">
        <header className="sticky top-0 z-40 border-b border-white/8 bg-[#0f0f10]/88 backdrop-blur-xl">
          <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6 xl:px-8">
            <Link
              href={localizePath("/fizzstudio", currentLocale)}
              className="flex items-center gap-3 lg:hidden"
            >
              <span className="flex size-9 items-center justify-center rounded-full bg-white text-[#111]">
                <IconSparkles className="size-5" />
              </span>
              <span className="text-lg font-semibold">{t("brand")}</span>
            </Link>

            <div className="hidden min-w-0 items-center gap-2 lg:flex">
              <button
                type="button"
                className="inline-flex h-10 items-center gap-2 rounded-full border border-white/10 bg-white/7 px-4 text-sm font-semibold text-white/82"
              >
                {t("workspace.allCreations")}
                <IconChevronDown className="size-4 text-white/46" />
              </button>
              <div className="inline-flex h-10 items-center rounded-full border border-white/10 bg-white/6 p-1 text-sm text-white/50">
                {["default", "assist", "apps"].map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={cn(
                      "h-8 rounded-full px-4",
                      key === "default" ? "bg-white/12 text-white" : "hover:text-white"
                    )}
                  >
                    {t(`workspace.tabs.${key}`)}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
              <button
                type="button"
                aria-label={t("shell.search")}
                className="hidden h-10 min-w-72 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 text-sm text-white/46 md:flex"
              >
                <IconSearch className="size-4" />
                <span className="truncate">{t("shell.search")}</span>
              </button>
              <button
                type="button"
                aria-label={t("shell.notifications")}
                className="flex size-10 items-center justify-center rounded-full border border-white/10 bg-white/5"
              >
                <IconBell className="size-4" />
              </button>
              <Link
                href={localizePath("/ai-lab", currentLocale)}
                className="inline-flex h-10 items-center gap-2 rounded-full bg-[#e52227] px-4 text-sm font-semibold text-white"
              >
                <IconPlus className="size-4" />
                {t("actions.create")}
              </Link>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1480px] px-4 pt-8 sm:px-6 xl:px-8">
          <FizzStudioHeroCarousel />

          <section aria-labelledby="my-projects" className="mt-10">
            <SectionHeader
              title={t("projects.title")}
              subtitle={t("projects.subtitle")}
              action={t("projects.viewAll")}
            />
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {PROJECT_CARDS.map((project) => (
                <Link
                  key={project.key}
                  href={localizePath("/art-studio/projects", currentLocale)}
                  className="group overflow-hidden rounded-[14px] border border-white/10 bg-white/[0.04] transition-transform hover:-translate-y-0.5"
                >
                  <div className={cn("h-24 bg-linear-to-br", project.tone)}>
                    <div className="flex h-full items-end bg-linear-to-t from-black/72 via-black/10 to-transparent p-3">
                      <span className="rounded-full bg-black/44 px-2.5 py-1 text-[11px] font-semibold text-white/80">
                        {t(`projects.status.${project.status}`)}
                      </span>
                    </div>
                  </div>
                  <div className="p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">
                          {t(`projects.items.${project.key}.title`)}
                        </div>
                        <p className="mt-1 line-clamp-1 text-xs text-white/48">
                          {t(`projects.items.${project.key}.body`)}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-white/42">{project.updatedAt}</span>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-[#e52227]"
                          style={{ width: `${project.progress}%` }}
                        />
                      </div>
                      <span className="text-[11px] font-semibold text-white/62">
                        {project.progress}%
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>

          <section aria-labelledby="works-show" className="mt-14">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 id="works-show" className="text-2xl font-semibold">
                  {t("show.title")}
                </h2>
                <p className="mt-2 text-sm text-white/48">{t("show.subtitle")}</p>
              </div>
              <div className="flex h-11 min-w-0 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 text-sm text-white/42 lg:w-80">
                <IconSearch className="size-4 shrink-0" />
                <span className="truncate">{t("show.search")}</span>
              </div>
            </div>
            <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
              {SHOW_CATEGORIES.map((category) => (
                <button
                  key={category}
                  type="button"
                  className={cn(
                    "h-9 shrink-0 rounded-full border px-4 text-sm transition-colors",
                    category === "all"
                      ? "border-white/16 bg-white/12 text-white"
                      : "border-white/10 bg-white/[0.03] text-white/50 hover:text-white"
                  )}
                >
                  {t(`show.categories.${category}`)}
                </button>
              ))}
            </div>
            <div className="mt-5 grid gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
              {SHOW_WORKS.map((work) => (
                <WorkCard key={work.key} work={work} />
              ))}
            </div>
          </section>
        </main>
      </div>

      <Composer currentLocale={currentLocale} />
    </div>
  );
}

function Sidebar({ currentLocale }: { currentLocale: Locale }) {
  const t = useTranslations("fizzStudio");
  const groups = [
    {
      key: "main",
      items: [
        { key: "home", href: "/fizzstudio", icon: IconHome, active: true },
        { key: "projects", href: "/art-studio/projects", icon: IconFolders },
        { key: "assets", href: "/fizzstudio", icon: IconDatabase },
        { key: "show", href: "/fizzstudio", icon: IconVideo },
      ],
    },
    {
      key: "tools",
      items: [
        { key: "image", href: "/ai-lab", icon: IconPhotoSpark },
        { key: "video", href: "/ai-lab", icon: IconVideo },
        { key: "models", href: "/ai-lab", icon: IconSparkles },
        { key: "usage", href: "/fizzstudio", icon: IconChartBar },
      ],
    },
  ];

  return (
    <aside className="sticky top-0 hidden h-screen border-r border-white/8 bg-[#101011] px-3 py-4 lg:flex lg:flex-col">
      <Link
        href={localizePath("/fizzstudio", currentLocale)}
        className="flex h-12 items-center gap-3 px-2"
      >
        <span className="flex size-9 items-center justify-center rounded-full bg-white text-[#111]">
          <IconSparkles className="size-5" />
        </span>
        <span className="text-lg font-semibold">{t("brand")}</span>
      </Link>

      <button
        type="button"
        className="mt-6 flex h-11 w-full items-center justify-between rounded-[12px] border border-white/10 bg-white/8 px-3 text-left"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{t("workspace.personal")}</span>
          <span className="mt-0.5 block truncate text-xs text-white/42">
            {t("workspace.current")}
          </span>
        </span>
        <IconChevronDown className="size-4 shrink-0 text-white/48" />
      </button>

      <div className="mt-6 space-y-6">
        {groups.map((group) => (
          <div key={group.key}>
            <div className="mb-2 px-2 text-xs font-semibold text-white/34">
              {t(`sidebar.groups.${group.key}`)}
            </div>
            <div className="space-y-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.key}
                    href={localizePath(item.href, currentLocale)}
                    className={cn(
                      "flex h-10 items-center gap-3 rounded-[12px] px-3 text-sm font-semibold text-white/66 transition-colors",
                      item.active ? "bg-white/12 text-white" : "hover:bg-white/7 hover:text-white"
                    )}
                  >
                    <Icon className="size-4" />
                    {t(`sidebar.items.${item.key}`)}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-auto space-y-2">
        <div className="rounded-[14px] border border-white/10 bg-white/[0.04] p-3">
          <div className="text-xs font-semibold text-white/82">{t("workspace.credits")}</div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-[68%] rounded-full bg-[#e52227]" />
          </div>
          <div className="mt-2 text-xs text-white/42">{t("workspace.creditsHint")}</div>
        </div>
        <Link
          href={localizePath("/fizzstudio", currentLocale)}
          className="flex h-10 items-center gap-3 rounded-[12px] px-3 text-sm font-semibold text-white/56 hover:bg-white/7 hover:text-white"
        >
          <IconSettings className="size-4" />
          {t("sidebar.items.settings")}
        </Link>
      </div>
    </aside>
  );
}

function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action: string;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h2 id="my-projects" className="text-2xl font-semibold">
          {title}
        </h2>
        <p className="mt-2 text-sm text-white/48">{subtitle}</p>
      </div>
      <button
        type="button"
        className="hidden items-center gap-1 text-sm font-semibold text-white/62 sm:flex"
      >
        {action}
        <IconArrowRight className="size-4" />
      </button>
    </div>
  );
}

function WorkCard({ work }: { work: ShowWork }) {
  const t = useTranslations("fizzStudio");

  return (
    <article className="group">
      <div
        className={cn(
          "relative aspect-[16/9] overflow-hidden rounded-[14px] bg-linear-to-br",
          work.tone
        )}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_22%_18%,rgba(255,255,255,0.34),transparent_24%),linear-gradient(180deg,transparent,rgba(0,0,0,0.72))]" />
        <div className="absolute bottom-4 left-4 right-4">
          <div className="text-2xl font-semibold leading-tight drop-shadow-lg">
            {t(`show.items.${work.key}.title`)}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="size-5 rounded-full bg-white/18" />
            <span className="truncate text-sm font-semibold text-white/82">{work.author}</span>
            {work.badge ? (
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/58">
                {t(`show.badges.${work.badge}`)}
              </span>
            ) : null}
          </div>
          <p className="mt-1 line-clamp-1 text-sm text-white/42">
            {t(`show.items.${work.key}.body`)}
          </p>
        </div>
      </div>
    </article>
  );
}

function Composer({ currentLocale }: { currentLocale: Locale }) {
  const t = useTranslations("fizzStudio");

  return (
    <div className="fixed inset-x-0 bottom-4 z-50 px-4">
      <div className="mx-auto max-w-3xl rounded-[28px] border border-white/12 bg-[#19191b]/92 p-2 shadow-2xl shadow-black/50 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={t("composer.attach")}
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/6 text-white/62"
          >
            <IconPaperclip className="size-5" />
          </button>
          <div className="min-w-0 flex-1 px-1 text-sm text-white/42">
            {t("composer.placeholder")}
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <ComposerChip icon={<IconSparkles className="size-4" />} label={t("composer.image")} />
            <ComposerChip icon={<IconVideo className="size-4" />} label={t("composer.video")} />
            <ComposerChip
              icon={<IconMicrophone className="size-4" />}
              label={t("composer.voice")}
            />
          </div>
          <Link
            href={localizePath("/ai-lab", currentLocale)}
            aria-label={t("composer.send")}
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#e52227] text-white"
          >
            <IconSend className="size-5" />
          </Link>
        </div>
      </div>
    </div>
  );
}

function ComposerChip({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <button
      type="button"
      className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/6 px-3 text-xs font-semibold text-white/58"
    >
      {icon}
      {label}
    </button>
  );
}
