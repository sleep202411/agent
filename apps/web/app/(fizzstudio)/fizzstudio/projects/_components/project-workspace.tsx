"use client";

import Link from "next/link";
import { IconArrowLeft, IconSparkles } from "@tabler/icons-react";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import { localizePath } from "@/src/i18n/locale-url";
import type { Locale } from "@/src/i18n/config";
import { useProject } from "../../../_hooks/use-project";
import { useFirstSectionCanvas } from "../../../_hooks/use-document";
import { ApiRequestError } from "@/src/lib/api";
import { StoryboardCanvas } from "./canvas/storyboard-canvas";

export function ProjectWorkspace({ projectId }: { projectId: string }) {
  const t = useTranslations("fizzStudio");
  const locale = useLocale() as Locale;
  const common = useTranslations("common");
  const project = useProject(projectId);
  const document = useFirstSectionCanvas(projectId);
  const storyboard = document.data;
  const error = project.error ?? document.error;
  const unavailable = [project.error, document.error].some(
    (error) => error instanceof ApiRequestError && [401, 403, 404, 410].includes(error.status)
  );
  const failed = project.isError || document.isError;
  const retrying = project.isFetching || document.isFetching;
  const retry = () => {
    if (project.isError) void project.refetch();
    if (document.isError) void document.refetch();
  };

  if (unavailable || (failed && (!storyboard || !project.data))) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#0f0f10] px-6 text-center text-white">
        <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-white/[0.04]">
          <IconSparkles className="size-6 text-white/30" />
        </div>
        <p role="alert" className="max-w-md text-sm font-medium text-white/60">
          {unavailable
            ? t("projectNotFound")
            : error instanceof Error
              ? error.message
              : common("loadFailed")}
        </p>
        {unavailable ? (
          <p className="mt-1 text-xs text-white/40">{t("projectNotFoundHint")}</p>
        ) : null}
        <button
          type="button"
          disabled={retrying}
          onClick={retry}
          className="mt-5 h-8 rounded-full bg-white/10 px-4 text-sm font-medium text-white/80 transition-colors hover:bg-white/15 disabled:opacity-50"
        >
          {common("retry")}
        </button>
        <Link
          href={localizePath("/fizzstudio", locale)}
          className="mt-5 inline-flex h-8 items-center gap-1.5 rounded-full bg-white/8 px-4 text-sm font-medium text-white/70 transition-colors hover:bg-white/12 hover:text-white"
        >
          <IconArrowLeft className="size-3.5" />
          {t("backToStudio")}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#0f0f10] text-white">
      {/* Editor header — back only, transparent (no bg / border); view switcher,
          account + settings will be reintroduced elsewhere in the UI/UX rework. */}
      <header className="sticky top-0 z-40">
        <div className="flex h-14 items-center px-4 sm:px-6">
          <Link
            href={localizePath("/fizzstudio", locale)}
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-white/50 transition-colors hover:bg-white/8 hover:text-white"
            aria-label={t("backToStudio")}
          >
            <IconArrowLeft className="size-[18px]" />
          </Link>
        </div>
      </header>

      {/* Editor body — the active view renders the same storyboard data */}
      <main className="flex flex-1 flex-col">
        {failed ? (
          <div className="flex items-center justify-between gap-4 px-6 py-3 text-sm">
            <p role="alert" className="text-white/60">
              {error instanceof Error ? error.message : common("loadFailed")}
            </p>
            <button
              type="button"
              disabled={retrying}
              onClick={retry}
              className="shrink-0 rounded-full bg-white/10 px-4 py-2 disabled:opacity-50"
            >
              {common("retry")}
            </button>
          </div>
        ) : null}
        {document.isLoading || project.isLoading || !storyboard || !project.data ? (
          <div className="flex flex-1 items-center justify-center text-sm text-white/40">
            {t("loading")}
          </div>
        ) : (
          <StoryboardCanvas key={storyboard.id} doc={storyboard} />
        )}
      </main>
    </div>
  );
}
