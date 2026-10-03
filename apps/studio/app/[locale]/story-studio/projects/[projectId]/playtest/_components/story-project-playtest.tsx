"use client";

import { createNoopPlaySessionReporter } from "../_lib/play-session-reporter.noop";
import { IconAlertTriangle, IconArrowLeft, IconLoader2, IconRefresh } from "@tabler/icons-react";
import { ExperienceRuntimeManifestSchema } from "@repo/shared/experience-runtime";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState, type CSSProperties } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ExperienceRuntimePlayer } from "@/components/experience-runtime/experience-runtime-player";
import { StoryPlaytestStateHud } from "./story-playtest-state-hud";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import {
  getStoryBuild,
  getStoryWorkingPreview,
  storyApiErrorMessage,
  type StoryBuild,
  type StoryBuildDiagnostic,
  type StoryWorkingPreview,
} from "@/lib/story-projects-api";
import { playtestDiagnosticText } from "../_lib/playtest-diagnostic-text";
import type { StoryProjectPlaytestSource } from "../_lib/story-playtest-source";

type LoadedPlaytestRuntime =
  | { kind: "draft"; preview: StoryWorkingPreview }
  | { kind: "build"; build: StoryBuild };

export function StoryProjectPlaytest({
  projectId,
  source,
}: {
  projectId: string;
  source: StoryProjectPlaytestSource;
}) {
  const t = useTranslations("storyStudio.canvas.workingPreview");
  const locale = useLocale();
  const [sessionValues, setSessionValues] = useState<Record<string, unknown>>({});
  const [completedEndingIds, setCompletedEndingIds] = useState<string[]>([]);
  const runtimeQuery = useQuery<LoadedPlaytestRuntime>({
    queryKey: [
      "story-studio",
      "playtest-runtime",
      projectId,
      source.kind,
      source.kind === "build"
        ? source.buildId
        : `${source.chapterId ?? "current-draft"}:${source.sceneId ?? "chapter"}`,
    ],
    queryFn: async () => {
      return source.kind === "draft"
        ? {
            kind: "draft" as const,
            preview: await getStoryWorkingPreview(projectId, source.chapterId, source.sceneId),
          }
        : {
            kind: "build" as const,
            build: await getStoryBuild(projectId, source.buildId),
          };
    },
    retry: false,
  });
  const playSessionReporter = useMemo(() => createNoopPlaySessionReporter(), []);
  // The player keeps its frame controls clear of this header through
  // `--experience-chrome-inset-top`: how far down the header's chrome reaches.
  // The frame's top-right corner, where the controls sit, can fall under any of
  // it — the refresh button when the picture spans the page, the state HUD
  // when it is pillarboxed, the title on a narrow page — so the controls drop
  // below all of it, measured again as the page or the HUD changes size. The
  // header's own boxes take no taps: only its chrome stands over the film.
  const [chromeInsetTop, setChromeInsetTop] = useState<number | null>(null);
  const measureChromeInset = useCallback((header: HTMLElement | null) => {
    const main = header?.closest("main");
    if (!header || !main) return;
    const update = () => {
      const bottom = Math.max(
        ...Array.from(header.children, (chrome) => chrome.getBoundingClientRect().bottom)
      );
      setChromeInsetTop(Math.ceil(bottom - main.getBoundingClientRect().top));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(main);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  const loading = runtimeQuery.isLoading;
  const loadError = runtimeQuery.error;
  if (loading) return <PlaytestLoading />;
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

  // Only a runtime the server could not build at all stops a playtest. Clip-level
  // errors — a scene with no video picked yet, media still in moderation — are
  // reported alongside the running story instead of replacing it: the point of a
  // playtest is to walk the story you have, and a half-finished story is exactly
  // the one worth walking.
  if (!runtime) {
    return (
      <PlaytestFailure
        projectId={projectId}
        chapterId={source.kind === "draft" ? source.chapterId : undefined}
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
  const stateRows = parsedRuntime.success
    ? parsedRuntime.data.stateDefinitions.map((definition) => {
        const label = definition.name
          ? localizedText(definition.name, locale, parsedRuntime.data.localization.defaultLocale)
          : "";
        return {
          key: definition.key,
          label: label || definition.key,
        };
      })
    : [];
  const runtimeTitle = parsedRuntime.success
    ? localizedText(
        parsedRuntime.data.metadata.title,
        locale,
        parsedRuntime.data.localization.defaultLocale
      )
    : t("pageTitle");

  return (
    <main
      className="relative isolate min-h-dvh min-w-0 flex-1 overflow-hidden bg-black text-white"
      style={
        chromeInsetTop === null
          ? undefined
          : ({ "--experience-chrome-inset-top": `${chromeInsetTop}px` } as CSSProperties)
      }
    >
      <div className="absolute inset-0">
        <ExperienceRuntimePlayer
          key={`${parsedRuntime.success ? parsedRuntime.data.buildId : "invalid-runtime"}:${source.kind === "draft" ? (source.sceneId ?? "entry") : "entry"}`}
          runtime={runtime}
          locale={locale}
          startSceneId={source.kind === "draft" ? (source.sceneId ?? null) : null}
          coverUrl={loadedRuntime.kind === "draft" ? loadedRuntime.preview.coverUrl : undefined}
          onStateChange={(state) => {
            setSessionValues(state.values.session);
            setCompletedEndingIds(state.completedEndingIds);
          }}
          playSessionReporter={playSessionReporter}
        />
      </div>

      <header
        ref={measureChromeInset}
        className="pointer-events-none absolute inset-x-0 top-0 z-50 flex items-start justify-between gap-3 p-3 sm:p-4"
      >
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

        <div className="pointer-events-none flex items-start gap-5">
          {stateRows.length > 0 ? (
            <StoryPlaytestStateHud
              values={sessionValues}
              rows={stateRows}
              completedEndingIds={completedEndingIds}
            />
          ) : null}
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="pointer-events-auto"
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
  chapterId,
  message,
  diagnostics = [],
  onRetry,
}: {
  projectId: string;
  chapterId?: string;
  message: string;
  diagnostics?: StoryBuildDiagnostic[];
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
            {diagnostics.map((diagnostic, index) => {
              const description = playtestDiagnosticText(diagnostic, (key, values) =>
                t(key as never, values as never)
              );
              const content = (
                <>
                  <p className="text-xs leading-5 text-white/78">{description}</p>
                  {diagnostic.entityType === "node" && diagnostic.entityId ? (
                    <p className="mt-2 text-xs font-semibold text-brand-blue">
                      {t("locateNode")} →
                    </p>
                  ) : null}
                </>
              );
              const key = `${diagnostic.code}:${diagnostic.entityId ?? "project"}:${index}`;
              if (diagnostic.entityType === "node" && diagnostic.entityId) {
                const params = new URLSearchParams();
                const targetChapterId = diagnostic.chapterId ?? chapterId;
                if (targetChapterId) params.set("chapter", targetChapterId);
                params.set("focus", diagnostic.entityId);
                return (
                  <li key={key}>
                    <Link
                      href={`/story-studio/projects/${encodeURIComponent(projectId)}/canvas?${params}`}
                      className="block rounded-2xl bg-black/28 px-4 py-3 transition hover:bg-white/[0.09] focus-visible:outline-2 focus-visible:outline-brand-blue"
                    >
                      {content}
                    </Link>
                  </li>
                );
              }
              return (
                <li key={key} className="rounded-2xl bg-black/28 px-4 py-3">
                  {content}
                </li>
              );
            })}
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
