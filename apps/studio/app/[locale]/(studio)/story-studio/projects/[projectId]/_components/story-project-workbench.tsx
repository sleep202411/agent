"use client";

import {
  IconAlertTriangle,
  IconArrowLeft,
  IconBook2,
  IconCheck,
  IconChevronDown,
  IconDeviceGamepad2,
  IconGitBranch,
  IconMovie,
  IconPhoto,
  IconRefresh,
  IconRoute,
  IconSparkles,
  IconUser,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useWorkspace } from "@/app/_components/workspace-context";
import { Button } from "@/components/ui/button";
import { FrostedPanel } from "@/components/ui/frosted-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  STORY_FRAME_PROFILE_CONTRACTS,
  getStoryWorkbench,
  storyApiErrorMessage,
  type FilmEffect,
  type InteractiveFilmDraftContent,
  type StoryProjectProductionSummary,
  type StoryWorkbench,
} from "@/lib/story-projects-api";
import { StoryReferencePack } from "./story-reference-pack";
import { StoryBuildStage } from "./story-build-stage";

type WorkbenchStage = "overview" | "story" | "references" | "production" | "build";

const STAGES: Array<{ id: WorkbenchStage; icon: typeof IconBook2 }> = [
  { id: "overview", icon: IconSparkles },
  { id: "story", icon: IconBook2 },
  { id: "references", icon: IconPhoto },
  { id: "production", icon: IconMovie },
  { id: "build", icon: IconDeviceGamepad2 },
];
const STORY_REFERENCE_API_CONNECTED = true;

export function StoryProjectWorkbench({
  projectId,
  stage,
}: {
  projectId: string;
  stage: WorkbenchStage;
}) {
  const t = useTranslations("storyStudio");
  const { activeWorkspace, loading: workspaceLoading } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? null;
  const workbenchQuery = useQuery({
    queryKey: ["story-studio", "workbench", workspaceId, projectId],
    queryFn: () => getStoryWorkbench(workspaceId as string, projectId),
    enabled: Boolean(workspaceId),
    retry: false,
  });

  if (workspaceLoading || (workspaceId && workbenchQuery.isLoading)) {
    return <WorkbenchSkeleton />;
  }

  if (workbenchQuery.isError || !workbenchQuery.data) {
    return (
      <main className="grid min-h-[calc(100vh-64px)] place-items-center px-6 py-12">
        <FrostedPanel className="flex max-w-lg flex-col items-center px-8 py-10 text-center">
          <IconAlertTriangle className="size-6 text-white/54" stroke={1.6} />
          <h1 className="mt-4 text-base font-semibold text-white">
            {t("workbench.errors.loadTitle")}
          </h1>
          <p className="mt-2 text-sm leading-6 text-white/46">
            {storyApiErrorMessage(workbenchQuery.error, t("errors.generic"))}
          </p>
          <div className="mt-6 flex items-center gap-2">
            <Button variant="ghost" asChild>
              <Link href="/story-studio">
                <IconArrowLeft className="size-4" />
                {t("workbench.back")}
              </Link>
            </Button>
            <Button variant="secondary" onClick={() => void workbenchQuery.refetch()}>
              <IconRefresh className="size-4" />
              {t("actions.retry")}
            </Button>
          </div>
        </FrostedPanel>
      </main>
    );
  }

  const workbench = workbenchQuery.data;
  const authoringWorkbench: StoryWorkbench =
    workbench.selectedRevision?.sourceDraftRevision === workbench.draft.revision
      ? workbench
      : { ...workbench, selectedRevision: null, film: null };
  return (
    <main className="min-h-[calc(100vh-64px)] w-full px-6 py-6 lg:px-8">
      <div className="mx-auto w-full max-w-[1680px]">
        <WorkbenchHeader workbench={authoringWorkbench} />
        <StageNavigation projectId={projectId} activeStage={stage} />
        <div className="mt-6">
          {stage === "overview" ? <OverviewStage workbench={authoringWorkbench} /> : null}
          {stage === "story" ? <StoryStage content={authoringWorkbench.draft.content} /> : null}
          {stage === "references" ? (
            <ReferencesStage
              projectId={projectId}
              workspaceId={workspaceId as string}
              workbench={authoringWorkbench}
              onRefresh={() => workbenchQuery.refetch()}
            />
          ) : null}
          {stage === "production" ? <ProductionStage workbench={authoringWorkbench} /> : null}
          {stage === "build" ? (
            <StoryBuildStage
              projectId={projectId}
              workspaceId={workspaceId as string}
              workbench={authoringWorkbench}
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}

function WorkbenchHeader({ workbench }: { workbench: StoryWorkbench }) {
  const t = useTranslations("storyStudio");
  return (
    <header className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
      <div className="min-w-0">
        <Link
          href="/story-studio"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-white/38 transition hover:text-white/72"
        >
          <IconArrowLeft className="size-3.5" />
          {t("workbench.back")}
        </Link>
        <div className="mt-4 flex items-center gap-3">
          <div className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-white/[0.055] text-white/72">
            <IconMovie className="size-5" stroke={1.7} />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-[-0.025em] text-white">
              {workbench.project.title}
            </h1>
            <p className="mt-1 text-xs text-white/38">
              {t("workbench.draftHead", { revision: workbench.draft.revision })}
            </p>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/46">
        <span className="rounded-full bg-white/[0.05] px-3 py-1.5">
          {t(`visibility.${workbench.project.visibility}`)}
        </span>
        <span className="rounded-full bg-white/[0.05] px-3 py-1.5">
          {t("workbench.formatInteractiveFilm")}
        </span>
        <span className="rounded-full bg-white/[0.05] px-3 py-1.5 tabular-nums">
          {t(`frameProfiles.${workbench.project.frameProfile}.label`)} ·{" "}
          {t(`frameProfiles.${workbench.project.frameProfile}.dimensions`)}
        </span>
      </div>
    </header>
  );
}

function StageNavigation({
  projectId,
  activeStage,
}: {
  projectId: string;
  activeStage: WorkbenchStage;
}) {
  const t = useTranslations("storyStudio");
  return (
    <nav
      className="mt-7 flex gap-1 overflow-x-auto rounded-2xl bg-white/[0.025] p-1.5"
      aria-label={t("workbench.stageNav")}
    >
      {STAGES.map(({ id, icon: Icon }) => (
        <Link
          key={id}
          href={`/story-studio/projects/${projectId}/${id}`}
          aria-current={activeStage === id ? "page" : undefined}
          className={cn(
            "inline-flex h-9 shrink-0 items-center gap-2 rounded-xl px-3.5 text-xs font-semibold transition",
            activeStage === id
              ? "bg-white/[0.09] text-white shadow-sm"
              : "text-white/40 hover:bg-white/[0.04] hover:text-white/72"
          )}
        >
          <Icon className="size-4" stroke={1.7} />
          {t(`workbench.stages.${id}`)}
        </Link>
      ))}
    </nav>
  );
}

function OverviewStage({ workbench }: { workbench: StoryWorkbench }) {
  const t = useTranslations("storyStudio");
  const film = workbench.film;
  const production = workbench.project.production;
  const choices = countChoices(workbench.draft.content);
  const endings = workbench.draft.content.storyBible.endings.length;
  const clipNodes = workbench.draft.content.graph.nodes.filter(
    (node) => node.kind === "clip"
  ).length;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
      <div className="space-y-5">
        <FrostedPanel className="p-5 lg:p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-white">
                {t("overview.productionTitle")}
              </h2>
              <p className="mt-1 text-xs text-white/40">{t("overview.productionSubtitle")}</p>
            </div>
            <span className="text-xs font-semibold tabular-nums text-white/54">
              {t("overview.draftRevisionStatus", { revision: workbench.draft.revision })}
            </span>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <OverviewMetric
              icon={IconPhoto}
              label={t("metrics.references")}
              value={`${production.approvedReferenceCount}/${production.referenceSlotCount}`}
            />
            <OverviewMetric
              icon={IconMovie}
              label={t("metrics.clips")}
              value={String(production.clipCount)}
            />
            <OverviewMetric
              icon={IconCheck}
              label={t("metrics.videos")}
              value={`${production.currentVideoCount}/${production.clipCount}`}
            />
            <OverviewMetric
              icon={IconAlertTriangle}
              label={t("metrics.generating")}
              value={String(production.generatingClipCount)}
            />
          </div>
        </FrostedPanel>

        <FrostedPanel className="p-5 lg:p-6">
          <h2 className="text-base font-semibold text-white">
            {t("overview.storyStructureTitle")}
          </h2>
          <p className="mt-1 text-xs text-white/40">{t("overview.storyStructureSubtitle")}</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <OverviewMetric
              icon={IconGitBranch}
              label={t("metrics.choices")}
              value={String(choices)}
            />
            <OverviewMetric icon={IconRoute} label={t("metrics.endings")} value={String(endings)} />
            <OverviewMetric
              icon={IconMovie}
              label={t("metrics.graphClips")}
              value={String(clipNodes)}
            />
          </div>
          {film?.spec ? (
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 rounded-xl bg-black/20 px-4 py-3 text-[11px] text-white/45">
              <span>
                {t("overview.targetRuntime", { seconds: film.spec.duration.targetMs / 1000 })}
              </span>
              <span>
                {t("overview.maxContinuous", {
                  seconds: film.spec.duration.maxContinuousMs / 1000,
                })}
              </span>
              <span>
                {film.spec.frame.width} × {film.spec.frame.height} ·{" "}
                {film.spec.frame.framesPerSecond.numerator /
                  film.spec.frame.framesPerSecond.denominator}{" "}
                fps
              </span>
            </div>
          ) : null}
        </FrostedPanel>
      </div>

      <aside className="space-y-5">
        <CurrentVideoState production={production} />
        <FrostedPanel className="p-5">
          <h2 className="text-sm font-semibold text-white">{t("overview.revisionTitle")}</h2>
          <dl className="mt-4 space-y-3 text-xs">
            <InfoRow label={t("overview.draftRevision")} value={String(workbench.draft.revision)} />
            <InfoRow label={t("overview.schemaVersion")} value={workbench.draft.schemaVersion} />
            <InfoRow
              label={t("overview.contentHash")}
              value={workbench.draft.contentHash.slice(0, 12)}
              mono
            />
          </dl>
        </FrostedPanel>
      </aside>
    </div>
  );
}

function CurrentVideoState({ production }: { production: StoryProjectProductionSummary }) {
  const t = useTranslations("storyStudio");
  const generating = production.generatingClipCount > 0;
  return (
    <FrostedPanel className="p-5">
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.055] text-white/62">
          {generating ? <IconSparkles className="size-4" /> : <IconCheck className="size-4" />}
        </div>
        <div>
          <h2 className="text-sm font-semibold text-white">{t("overview.videoState")}</h2>
          <p className="mt-1.5 text-xs leading-5 text-white/46">
            {generating
              ? t("overview.videoStateGenerating", { count: production.generatingClipCount })
              : t("overview.videoStateReady", {
                  current: production.currentVideoCount,
                  total: production.clipCount,
                })}
          </p>
        </div>
      </div>
    </FrostedPanel>
  );
}

function StoryStage({ content }: { content: InteractiveFilmDraftContent }) {
  const t = useTranslations("storyStudio");
  const locale = useLocale();
  const bible = content.storyBible;
  const choices = countChoices(content);
  const decisions = collectDecisions(content);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
      <div className="space-y-5">
        <FrostedPanel className="p-5 lg:p-6">
          <p className="text-[10px] font-semibold tracking-[0.15em] text-white/32 uppercase">
            {t("story.logline")}
          </p>
          <p className="mt-3 text-lg leading-8 font-medium tracking-[-0.01em] text-white/86">
            {bible.logline || t("story.empty")}
          </p>
          {bible.synopsis ? (
            <p className="mt-5 text-sm leading-7 text-white/50">{bible.synopsis}</p>
          ) : null}
        </FrostedPanel>

        <FrostedPanel className="p-5 lg:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-white">{t("story.characters")}</h2>
            <span className="text-xs text-white/36">{bible.characters.length}</span>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {bible.characters.map((character) => (
              <div key={character.id} className="rounded-2xl bg-white/[0.035] p-4">
                <div className="flex items-start gap-3">
                  <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.05] text-white/48">
                    <IconUser className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-white/82">
                      {localizedText(character.name, locale)}
                    </p>
                    <p className="mt-1 text-[11px] text-white/34">{character.role}</p>
                  </div>
                </div>
                <p className="mt-3 text-xs leading-5 text-white/46">{character.summary}</p>
                {character.continuityRules.length > 0 ? (
                  <p className="mt-3 line-clamp-2 text-[11px] leading-5 text-white/32">
                    {character.continuityRules.join(" · ")}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </FrostedPanel>

        <FrostedPanel className="p-5 lg:p-6">
          <h2 className="text-base font-semibold text-white">{t("story.rules")}</h2>
          <ol className="mt-4 space-y-3">
            {bible.storyRules.map((rule, index) => (
              <li key={`${index}:${rule}`} className="flex gap-3 text-xs leading-6 text-white/48">
                <span className="shrink-0 font-mono text-white/24">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span>{rule}</span>
              </li>
            ))}
          </ol>
        </FrostedPanel>

        <FrostedPanel className="p-5 lg:p-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-white">{t("story.decisions")}</h2>
              <p className="mt-1 text-xs text-white/40">{t("story.decisionsSubtitle")}</p>
            </div>
            <span className="text-xs tabular-nums text-white/36">{decisions.length}</span>
          </div>
          <div className="mt-5 space-y-3">
            {decisions.map((decision) => (
              <div key={decision.id} className="rounded-2xl bg-white/[0.035] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-mono text-xs font-semibold text-white/68">{decision.id}</p>
                  <p className="text-[10px] text-white/30">
                    {t("story.decisionSources", { clips: decision.sourceClipKeys.join(" / ") })}
                  </p>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {decision.options.map((option) => (
                    <div key={option.id} className="rounded-xl bg-black/20 px-3 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-xs font-semibold leading-5 text-white/72">
                          {localizedText(option.label, locale)}
                        </p>
                        <span className="shrink-0 font-mono text-[10px] text-white/26">
                          → {option.nextNodeId}
                        </span>
                      </div>
                      {option.effects.length > 0 ? (
                        <p className="mt-2 font-mono text-[10px] leading-5 text-white/32">
                          {option.effects.map(formatEffect).join(" · ")}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </FrostedPanel>
      </div>

      <aside className="space-y-5">
        <FrostedPanel className="p-5">
          <h2 className="text-sm font-semibold text-white">{t("story.storyGraph")}</h2>
          <dl className="mt-4 space-y-3 text-xs">
            <InfoRow label={t("metrics.choices")} value={String(choices)} />
            <InfoRow label={t("metrics.endings")} value={String(bible.endings.length)} />
            <InfoRow label={t("story.graphNodes")} value={String(content.graph.nodes.length)} />
            <InfoRow
              label={t("story.stateVariables")}
              value={String(bible.stateVariables.length)}
            />
          </dl>
        </FrostedPanel>
        <FrostedPanel className="p-5">
          <h2 className="text-sm font-semibold text-white">{t("story.endings")}</h2>
          <div className="mt-4 space-y-3">
            {bible.endings.map((ending) => {
              const summary = localizedText(ending.summary, locale);
              return (
                <div key={ending.id} className="rounded-xl bg-white/[0.035] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold text-white/76">
                      {localizedText(ending.title, locale)}
                    </p>
                    <span className="text-[10px] font-semibold text-white/28 uppercase">
                      {ending.kind}
                    </span>
                  </div>
                  {summary !== "—" ? (
                    <p className="mt-2 text-[11px] leading-5 text-white/40">{summary}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </FrostedPanel>
      </aside>
    </div>
  );
}

function ReferencesStage({
  projectId,
  workspaceId,
  workbench,
  onRefresh,
}: {
  projectId: string;
  workspaceId: string;
  workbench: StoryWorkbench;
  onRefresh: () => Promise<unknown>;
}) {
  if (!workbench.selectedRevision || !workbench.film) {
    return <NoProductionData />;
  }
  return (
    <StoryReferencePack
      projectId={projectId}
      workspaceId={workspaceId}
      workbench={workbench}
      onRefresh={onRefresh}
      apiConnected={STORY_REFERENCE_API_CONNECTED}
    />
  );
}

function ProductionStage({ workbench }: { workbench: StoryWorkbench }) {
  const t = useTranslations("storyStudio");
  const prompts = workbench.draft.content.clipPrompts;
  const materializedClips = new Map(
    (workbench.film?.clips ?? []).map((clip) => [clip.graphNodeId, clip])
  );
  const frame = STORY_FRAME_PROFILE_CONTRACTS[workbench.project.frameProfile];
  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-white">{t("production.title")}</h2>
          <p className="mt-1 text-xs text-white/40">{t("production.subtitle")}</p>
        </div>
        <p className="text-xs tabular-nums text-white/40">
          {t("production.clipCount", { count: prompts.length })}
        </p>
      </div>
      {prompts.length === 0 ? <NoProductionData /> : null}
      {prompts.length > 0 ? (
        <FrostedPanel className="mt-5 overflow-hidden">
          <div className="hidden grid-cols-[80px_minmax(220px,1fr)_160px_100px_120px_minmax(180px,0.8fr)] gap-4 px-5 py-3 text-[10px] font-semibold tracking-wide text-white/28 uppercase lg:grid">
            <span>{t("production.columns.key")}</span>
            <span>{t("production.columns.clip")}</span>
            <span>{t("production.columns.mode")}</span>
            <span>{t("production.columns.duration")}</span>
            <span>{t("production.columns.status")}</span>
            <span>{t("production.columns.blocker")}</span>
          </div>
          <div className="divide-y divide-white/[0.045]">
            {prompts.map((prompt) => {
              const clip = materializedClips.get(prompt.graphNodeId);
              const generationStatus = clip?.generation?.status;
              const generationActive =
                generationStatus === "queued" ||
                generationStatus === "running" ||
                generationStatus === "processing";
              const generationError = clip?.generation?.error?.message;
              const status = generationActive
                ? generationStatus
                : generationStatus === "failed"
                  ? "failed"
                  : clip?.currentVideo?.outdated
                    ? "outdated"
                    : clip?.currentVideo
                      ? "ready"
                      : "draft";
              const statusDetail = generationActive
                ? t("production.generationInProgress")
                : generationStatus === "failed"
                  ? typeof generationError === "string" && generationError.trim()
                    ? generationError
                    : t("production.generationFailed")
                  : clip?.currentVideo?.outdated
                    ? t("production.currentVideoOutdated")
                    : clip?.currentVideo
                      ? t("production.currentVideoReady")
                      : prompt.masterDirection.trim()
                        ? t("production.currentDraftReady")
                        : t("production.currentDraftPromptRequired");
              return (
                <details key={prompt.graphNodeId} className="group open:bg-white/[0.018]">
                  <summary className="grid cursor-pointer list-none gap-3 px-5 py-4 transition hover:bg-white/[0.025] [&::-webkit-details-marker]:hidden lg:grid-cols-[80px_minmax(220px,1fr)_160px_100px_120px_minmax(180px,0.8fr)] lg:items-center lg:gap-4">
                    <span className="flex items-center gap-2 font-mono text-[11px] text-white/34">
                      <IconChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
                      {prompt.clipKey}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white/76">{prompt.title}</p>
                      <p className="mt-1 truncate text-[10px] text-white/26">
                        {prompt.graphNodeId}
                      </p>
                    </div>
                    <span className="text-xs text-white/46">
                      {prompt.generationControl.mode === "omni_reference"
                        ? t("production.modes.omni")
                        : prompt.generationControl.frameMode === "first_last_frame"
                          ? t("production.modes.firstLast")
                          : t("production.modes.first")}
                    </span>
                    <span className="text-xs tabular-nums text-white/46">
                      {t("production.seconds", { seconds: prompt.targetDurationMs / 1000 })}
                    </span>
                    <StatusPill label={t(`production.status.${status}`)} status={status} />
                    <p className="truncate text-[11px] text-white/36">{statusDetail}</p>
                  </summary>
                  <div className="border-t border-white/[0.04] px-5 pt-5 pb-6">
                    <div className="grid gap-5 xl:grid-cols-2">
                      <ProductionContractBlock title={t("production.detail.visualIntent")}>
                        {prompt.description || "—"}
                      </ProductionContractBlock>
                      <ProductionContractBlock title={t("production.detail.masterPrompt")} mono>
                        {prompt.masterDirection || "—"}
                      </ProductionContractBlock>
                    </div>

                    <div className="mt-5">
                      <p className="text-[10px] font-semibold tracking-[0.13em] text-white/32 uppercase">
                        {t("production.detail.timeline")}
                      </p>
                      <div className="mt-3 grid gap-2 lg:grid-cols-2 2xl:grid-cols-3">
                        {prompt.beats.map((entry) => (
                          <div
                            key={`${entry.startMs}:${entry.endMs}`}
                            className="rounded-xl bg-black/20 p-3"
                          >
                            <p className="font-mono text-[10px] text-white/30">
                              {formatTimecode(entry.startMs)}–{formatTimecode(entry.endMs)}
                            </p>
                            <p className="mt-2 text-[11px] leading-5 text-white/52">
                              {entry.visual}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="mt-5 grid gap-5 xl:grid-cols-2">
                      <ProductionContractList
                        title={t("production.detail.negativeConstraints")}
                        items={prompt.negativeConstraints}
                      />
                      <ProductionContractList
                        title={t("production.detail.continuityAndDialogue")}
                        items={prompt.continuityNotes}
                      />
                    </div>

                    <div className="mt-5 flex flex-wrap gap-2 text-[10px] text-white/34">
                      <span className="rounded-full bg-white/[0.045] px-2.5 py-1.5">
                        {frame.width} × {frame.height}
                      </span>
                      <span className="rounded-full bg-white/[0.045] px-2.5 py-1.5">
                        {t("production.seconds", { seconds: prompt.targetDurationMs / 1000 })}
                      </span>
                      {clip ? (
                        <span className="rounded-full bg-white/[0.045] px-2.5 py-1.5">
                          {t("production.detail.specVersion", { version: clip.version })}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        </FrostedPanel>
      ) : null}
    </div>
  );
}

function ProductionContractBlock({
  title,
  children,
  mono = false,
}: {
  title: string;
  children: string;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold tracking-[0.13em] text-white/32 uppercase">{title}</p>
      <p
        className={cn(
          "mt-2 whitespace-pre-wrap text-xs leading-6 text-white/52",
          mono && "font-mono text-[11px]"
        )}
      >
        {children}
      </p>
    </div>
  );
}

function ProductionContractList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-[10px] font-semibold tracking-[0.13em] text-white/32 uppercase">{title}</p>
      <ul className="mt-2 space-y-1.5">
        {items.map((item, index) => (
          <li key={`${index}:${item}`} className="flex gap-2 text-[11px] leading-5 text-white/48">
            <span className="shrink-0 font-mono text-white/20">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NoProductionData() {
  const t = useTranslations("storyStudio");
  return (
    <FrostedPanel className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
      <IconBook2 className="size-6 text-white/42" />
      <h2 className="mt-4 text-sm font-semibold text-white">
        {t("workbench.noProductionDataTitle")}
      </h2>
      <p className="mt-2 max-w-md text-xs leading-5 text-white/42">
        {t("workbench.noProductionDataDescription")}
      </p>
    </FrostedPanel>
  );
}

function OverviewMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof IconMovie;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl bg-white/[0.035] p-4">
      <div className="flex items-center gap-2 text-white/38">
        <Icon className="size-4" stroke={1.7} />
        <span className="text-[11px] font-medium">{label}</span>
      </div>
      <p className="mt-2 text-xl font-semibold tabular-nums text-white/82">{value}</p>
    </div>
  );
}

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-white/38">{label}</dt>
      <dd className={cn("truncate text-right text-white/68", mono && "font-mono text-[11px]")}>
        {value}
      </dd>
    </div>
  );
}

function StatusPill({ label, status }: { label: string; status: string }) {
  const positive = status === "approved" || status === "ready";
  const warning = status === "blocked" || status === "failed" || status === "invalidated";
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[10px] font-semibold",
        positive && "bg-emerald-400/10 text-emerald-200/70",
        warning && "bg-red-400/10 text-red-200/70",
        !positive && !warning && "bg-white/[0.055] text-white/42"
      )}
    >
      {label}
    </span>
  );
}

function WorkbenchSkeleton() {
  return (
    <main className="min-h-[calc(100vh-64px)] w-full px-6 py-6 lg:px-8">
      <div className="mx-auto max-w-[1680px]">
        <div className="space-y-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-10 w-72" />
        </div>
        <Skeleton className="mt-7 h-12 w-full rounded-2xl" />
        <div className="mt-6 grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
          <Skeleton className="h-72 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      </div>
    </main>
  );
}

function countChoices(content: InteractiveFilmDraftContent): number {
  const decisionIds = new Set<string>();
  for (const node of content.graph.nodes) {
    if (node.kind !== "clip" || node.exit.kind !== "choice") continue;
    decisionIds.add(node.exit.decisionId);
  }
  return decisionIds.size;
}

interface AuthoredDecision {
  id: string;
  sourceClipKeys: string[];
  options: Array<{
    id: string;
    label: Record<string, string>;
    nextNodeId: string;
    effects: FilmEffect[];
  }>;
}

function collectDecisions(content: InteractiveFilmDraftContent): AuthoredDecision[] {
  const decisions = new Map<string, AuthoredDecision>();
  for (const node of content.graph.nodes) {
    if (node.kind !== "clip" || node.exit.kind !== "choice") continue;
    const existing = decisions.get(node.exit.decisionId);
    if (existing) {
      existing.sourceClipKeys.push(node.clipKey);
      continue;
    }
    decisions.set(node.exit.decisionId, {
      id: node.exit.decisionId,
      sourceClipKeys: [node.clipKey],
      options: node.exit.choices.map((choice) => ({
        id: choice.choiceId,
        label: choice.label,
        nextNodeId: choice.nextNodeId,
        effects: choice.effects,
      })),
    });
  }
  return [...decisions.values()];
}

function formatEffect(effect: FilmEffect): string {
  switch (effect.kind) {
    case "set_variable":
      return `${effect.key} = ${String(effect.value)}`;
    case "increment_variable":
      return `${effect.key} ${effect.amount >= 0 ? "+" : ""}${effect.amount}`;
    case "set_flag":
      return `${effect.flag} = ${String(effect.value)}`;
    case "adjust_relationship":
      return `${effect.characterId} ${effect.amount >= 0 ? "+" : ""}${effect.amount}`;
    case "unlock_ending":
      return `unlock ${effect.endingId}`;
  }
}

function formatTimecode(milliseconds: number): string {
  return `${(milliseconds / 1_000).toFixed(1)}s`;
}

function localizedText(values: Record<string, string>, locale: string): string {
  return values[locale] || values["zh-CN"] || values["en-US"] || Object.values(values)[0] || "—";
}
