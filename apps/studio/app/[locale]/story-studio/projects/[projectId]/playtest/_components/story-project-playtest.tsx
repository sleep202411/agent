"use client";

import { IconAlertTriangle, IconArrowLeft, IconLoader2, IconRefresh } from "@tabler/icons-react";
import { ExperienceRuntimeManifestSchema } from "@repo/shared/experience-runtime";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useWorkspace } from "@/app/_components/workspace-context";
import { ExperienceRuntimePlayer } from "@/components/experience-runtime/experience-runtime-player";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import {
  getFilmBuild,
  getStoryWorkingPreview,
  storyApiErrorMessage,
  type FilmBuild,
  type FilmBuildDiagnostic,
  type StoryWorkingPreview,
} from "@/lib/story-projects-api";
import type { StoryProjectPlaytestSource } from "../_lib/story-playtest-source";

type LoadedPlaytestRuntime =
  | { kind: "draft"; preview: StoryWorkingPreview }
  | { kind: "build"; build: FilmBuild };

export function StoryProjectPlaytest({
  projectId,
  source,
}: {
  projectId: string;
  source: StoryProjectPlaytestSource;
}) {
  const t = useTranslations("storyStudio.canvas.workingPreview");
  const locale = useLocale();
  const { activeWorkspace, loading: workspaceLoading } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? null;
  const runtimeQuery = useQuery<LoadedPlaytestRuntime>({
    queryKey: [
      "story-studio",
      "playtest-runtime",
      workspaceId,
      projectId,
      source.kind,
      source.kind === "build" ? source.buildId : "current-draft",
    ],
    queryFn: async () => {
      if (!workspaceId) throw new Error(t("errorFallback"));
      return source.kind === "draft"
        ? {
            kind: "draft" as const,
            preview: await getStoryWorkingPreview(workspaceId, projectId),
          }
        : {
            kind: "build" as const,
            build: await getFilmBuild(workspaceId, projectId, source.buildId),
          };
    },
    enabled: Boolean(workspaceId),
    retry: false,
  });

  const loading = workspaceLoading || runtimeQuery.isLoading;
  const loadError = runtimeQuery.error;

  if (loading) return <PlaytestLoading />;
  if (!workspaceId) {
    return (
      <PlaytestFailure
        projectId={projectId}
        message={storyApiErrorMessage(loadError, t("errorFallback"))}
      />
    );
  }
  if (loadError || !runtimeQuery.data) {
    return (
      <PlaytestFailure
        projectId={projectId}
        message={storyApiErrorMessage(loadError, t("errorFallback"))}
        onRetry={() => void runtimeQuery.refetch()}
      />
    );
  }

  const loadedRuntime = runtimeQuery.data;
  const runtime =
    loadedRuntime.kind === "draft"
      ? loadedRuntime.preview.runtime
      : loadedRuntime.build.runtimeJson;
  const diagnostics =
    loadedRuntime.kind === "draft"
      ? loadedRuntime.preview.diagnostics
      : loadedRuntime.build.diagnostics;
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
  const sourceLabel =
    loadedRuntime.kind === "draft"
      ? t("draftRevision", { revision: loadedRuntime.preview.draftRevision })
      : t("buildNumber", { number: loadedRuntime.build.number });

  if (!runtime || errors.length > 0) {
    return (
      <PlaytestFailure
        projectId={projectId}
        message={t("unavailableDescription", {
          errors: errors.length,
          warnings: warnings.length,
        })}
        diagnostics={diagnostics}
        onRetry={() => void runtimeQuery.refetch()}
      />
    );
  }

  const parsedRuntime = ExperienceRuntimeManifestSchema.safeParse(runtime);
  const runtimeTitle = parsedRuntime.success
    ? localizedText(
        parsedRuntime.data.metadata.title,
        locale,
        parsedRuntime.data.localization.defaultLocale
      )
    : t("pageTitle");

  return (
    <main className="relative isolate min-h-dvh overflow-hidden bg-black text-white">
      <div className="absolute inset-0">
        <ExperienceRuntimePlayer runtime={runtime} locale={locale} />
      </div>

      <header className="pointer-events-none absolute inset-x-0 top-0 z-50 flex items-start justify-between gap-3 p-3 sm:p-4">
        <div className="pointer-events-auto flex min-w-0 items-center gap-2 rounded-2xl bg-black/58 p-1.5 shadow-[0_14px_50px_rgb(0_0_0/0.38)] backdrop-blur-2xl">
          <Link
            href={`/story-studio/projects/${projectId}/canvas`}
            aria-label={t("editStory")}
            className="grid size-10 shrink-0 place-items-center rounded-xl text-white/68 transition hover:bg-white/10 hover:text-white"
          >
            <IconArrowLeft className="size-4" />
          </Link>
          <div className="min-w-0 pr-3">
            <p className="truncate text-xs font-semibold text-white/88">{runtimeTitle}</p>
            <p className="mt-0.5 text-[10px] text-white/42">{sourceLabel}</p>
          </div>
        </div>

        <div className="pointer-events-auto flex items-start gap-2">
          {warnings.length > 0 ? <PlaytestWarnings diagnostics={warnings} /> : null}
          <Button
            type="button"
            size="icon"
            variant="secondary"
            aria-label={t("refresh")}
            title={t("refresh")}
            onClick={() => void runtimeQuery.refetch()}
          >
            <IconRefresh className="size-4" />
          </Button>
        </div>
      </header>
    </main>
  );
}

function localizedText(
  value: Readonly<Record<string, string>>,
  locale: string,
  defaultLocale: string
): string {
  if (value[locale]) return value[locale];
  const language = locale.split("-")[0]?.toLowerCase();
  const sameLanguage = Object.entries(value).find(
    ([candidate]) => candidate.split("-")[0]?.toLowerCase() === language
  )?.[1];
  return sameLanguage ?? value[defaultLocale] ?? Object.values(value)[0] ?? "";
}

function PlaytestLoading() {
  const t = useTranslations("storyStudio.canvas.workingPreview");
  return (
    <main className="grid min-h-dvh place-items-center bg-black text-white">
      <div className="text-center">
        <IconLoader2 className="mx-auto size-6 animate-spin text-white/58" />
        <p className="mt-3 text-xs text-white/46">{t("loading")}</p>
      </div>
    </main>
  );
}

function PlaytestFailure({
  projectId,
  message,
  diagnostics = [],
  onRetry,
}: {
  projectId: string;
  message: string;
  diagnostics?: FilmBuildDiagnostic[];
  onRetry?: () => void;
}) {
  const t = useTranslations("storyStudio.canvas.workingPreview");
  return (
    <main className="grid min-h-dvh place-items-center bg-black px-5 py-16 text-white">
      <section className="w-full max-w-3xl rounded-[28px] bg-white/[0.055] p-6 shadow-[0_30px_100px_rgb(0_0_0/0.6)] sm:p-8">
        <IconAlertTriangle className="size-6 text-[#ff9b9e]" />
        <h1 className="mt-4 text-base font-semibold">{t("unavailableTitle")}</h1>
        <p className="mt-2 text-sm leading-6 text-white/54">{message}</p>
        {diagnostics.length > 0 ? (
          <ul className="mt-6 max-h-[48vh] space-y-2 overflow-y-auto">
            {diagnostics.map((diagnostic, index) => (
              <li
                key={`${diagnostic.code}:${diagnostic.entityId ?? "project"}:${index}`}
                className="rounded-2xl bg-black/28 px-4 py-3"
              >
                <p className="text-[10px] font-semibold text-white/42">{diagnostic.code}</p>
                <p className="mt-1 text-xs leading-5 text-white/68">{diagnostic.message}</p>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-7 flex flex-wrap gap-2">
          <Button variant="secondary" asChild>
            <Link href={`/story-studio/projects/${projectId}/canvas`}>
              <IconArrowLeft className="size-4" />
              {t("editStory")}
            </Link>
          </Button>
          {onRetry ? (
            <Button type="button" onClick={onRetry}>
              <IconRefresh className="size-4" />
              {t("retry")}
            </Button>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function PlaytestWarnings({ diagnostics }: { diagnostics: FilmBuildDiagnostic[] }) {
  const t = useTranslations("storyStudio.canvas.workingPreview");
  return (
    <details className="group max-w-sm rounded-2xl bg-black/58 text-white shadow-[0_14px_50px_rgb(0_0_0/0.38)] backdrop-blur-2xl">
      <summary className="flex h-10 cursor-pointer list-none items-center gap-2 px-3 text-[11px] font-semibold text-white/66">
        <IconAlertTriangle className="size-3.5" />
        {t("previewWarnings", { count: diagnostics.length })}
      </summary>
      <ul className="max-h-72 space-y-2 overflow-y-auto border-t border-white/8 p-3">
        {diagnostics.map((diagnostic, index) => (
          <li
            key={`${diagnostic.code}:${diagnostic.entityId ?? "project"}:${index}`}
            className="rounded-xl bg-white/[0.055] px-3 py-2 text-[10px] leading-4 text-white/54"
          >
            {diagnostic.message}
          </li>
        ))}
      </ul>
    </details>
  );
}
