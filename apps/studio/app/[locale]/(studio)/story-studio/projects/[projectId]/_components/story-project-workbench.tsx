"use client";

import {
  IconAlertTriangle,
  IconArrowLeft,
  IconBook2,
  IconCheck,
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
import { Button } from "@/components/ui/button";
import { FrostedPanel } from "@/components/ui/frosted-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  STORY_FRAME_PROFILE_CONTRACTS,
  getStoryWorkbench,
  storyApiErrorMessage,
  type InteractiveStoryDraftContent,
  type StoryProjectProductionSummary,
  type StoryProjectSummary,
  type StoryWorkbench,
} from "@/lib/story-projects-api";
import { StoryReferencePack } from "./story-reference-pack";

type WorkbenchStage = "overview" | "story" | "references";

const STAGES: Array<{ id: WorkbenchStage; icon: typeof IconBook2 }> = [
  { id: "overview", icon: IconSparkles },
  { id: "story", icon: IconBook2 },
  { id: "references", icon: IconPhoto },
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
  const workbenchQuery = useQuery({
    queryKey: ["story-studio", "workbench", projectId],
    queryFn: () => getStoryWorkbench(projectId),
    retry: false,
  });
  const workspaceId = workbenchQuery.data?.project.workspaceId ?? null;

  if (workbenchQuery.isLoading) {
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
          <p className="mt-2 text-sm leading-6 text-white/64">
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

  const authoringWorkbench = workbenchQuery.data;
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
          className="inline-flex items-center gap-1.5 text-xs font-medium text-white/62 transition hover:text-white/82"
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
            <p className="mt-1 text-xs text-white/62">
              {t("workbench.draftHead", { revision: workbench.draft.revision })}
            </p>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/64">
        <span className="rounded-full bg-white/[0.05] px-3 py-1.5">
          {t(`visibility.${workbench.project.visibility}`)}
        </span>
        {workbench.project.creativeProfileConfirmedAt ? (
          <span className="rounded-full bg-white/[0.05] px-3 py-1.5 tabular-nums">
            {`${t(`frameProfiles.${workbench.project.frameProfile}.label`)} · ${t(
              `frameProfiles.${workbench.project.frameProfile}.dimensions`
            )}`}
          </span>
        ) : null}
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
              : "text-white/64 hover:bg-white/[0.04] hover:text-white/88"
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
  const production = workbench.project.production;
  const choices = countChoices(workbench.draft.content);
  const sceneNodes = workbench.draft.content.graph.nodes.length;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
      <div className="space-y-5">
        <StoryOverviewCreativeProfile project={workbench.project} />
        <FrostedPanel className="p-5 lg:p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-white">
                {t("overview.productionTitle")}
              </h2>
              <p className="mt-1 text-xs text-white/64">{t("overview.productionSubtitle")}</p>
            </div>
            <span className="text-xs font-semibold tabular-nums text-white/54">
              {t("overview.draftRevisionStatus", { revision: workbench.draft.revision })}
            </span>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
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
          </div>
        </FrostedPanel>

        <FrostedPanel className="p-5 lg:p-6">
          <h2 className="text-base font-semibold text-white">
            {t("overview.storyStructureTitle")}
          </h2>
          <p className="mt-1 text-xs text-white/64">{t("overview.storyStructureSubtitle")}</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <OverviewMetric
              icon={IconGitBranch}
              label={t("metrics.choices")}
              value={String(choices)}
            />
            <OverviewMetric
              icon={IconRoute}
              label={t("metrics.graphScenes")}
              value={String(sceneNodes)}
            />
          </div>
          {workbench.project.creativeProfileConfirmedAt ? (
            <div className="mt-4 rounded-xl bg-black/20 px-4 py-3 text-[11px] text-white/62">
              {STORY_FRAME_PROFILE_CONTRACTS[workbench.project.frameProfile].width} ×{" "}
              {STORY_FRAME_PROFILE_CONTRACTS[workbench.project.frameProfile].height}
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

export function StoryOverviewCreativeProfile({
  project,
}: {
  project: Pick<
    StoryProjectSummary,
    "frameProfile" | "durationPreset" | "visualStyle" | "defaultLocale"
  >;
}) {
  const t = useTranslations("storyStudio.canvas.filmFoundation.profile");
  const locale = useLocale();
  const values = [
    { key: "aspectRatio", value: t(`frameProfiles.${project.frameProfile}`) },
    {
      key: "targetRuntime",
      value: project.durationPreset ? t(`durationPresets.${project.durationPreset}`) : t("notSet"),
    },
    {
      key: "visualStyle",
      value: project.visualStyle ? t(`visualStyles.${project.visualStyle}`) : t("notSet"),
    },
    {
      key: "language",
      value: `${displayLanguage(project.defaultLocale, locale)} · ${project.defaultLocale}`,
    },
  ] as const;

  return (
    <FrostedPanel className="p-5 lg:p-6" aria-labelledby="overview-creative-profile-title">
      <h2 id="overview-creative-profile-title" className="text-base font-semibold text-white">
        {t("title")}
      </h2>
      <p className="mt-1 text-xs leading-5 text-white/64">{t("description")}</p>
      <dl className="mt-5 grid gap-3 sm:grid-cols-2">
        {values.map((item) => (
          <div key={item.key} className="rounded-2xl bg-white/[0.045] px-4 py-3.5">
            <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/64">
              {t(item.key)}
            </dt>
            <dd className="mt-1.5 text-sm font-semibold text-white/90">{item.value}</dd>
          </div>
        ))}
      </dl>
    </FrostedPanel>
  );
}

function CurrentVideoState({ production }: { production: StoryProjectProductionSummary }) {
  const t = useTranslations("storyStudio");
  return (
    <FrostedPanel className="p-5">
      <div className="flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.055] text-white/62">
          <IconCheck className="size-4" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-white">{t("overview.videoState")}</h2>
          <p className="mt-1.5 text-xs leading-5 text-white/64">
            {t("overview.videoStateReady", {
              current: production.currentVideoCount,
              total: production.clipCount,
            })}
          </p>
        </div>
      </div>
    </FrostedPanel>
  );
}

function StoryStage({ content }: { content: InteractiveStoryDraftContent }) {
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
                  {character.images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element -- unsized user upload
                    <img
                      src={character.images[0].url}
                      alt=""
                      draggable={false}
                      className="size-9 shrink-0 select-none rounded-xl object-cover"
                    />
                  ) : (
                    <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.05] text-white/48">
                      <IconUser className="size-4" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="font-semibold text-white/82">
                      {localizedText(character.name, locale)}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-xs leading-5 text-white/46">{character.summary}</p>
              </div>
            ))}
          </div>
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
                    {t("story.decisionSources", { scenes: decision.sourceSceneLabels.join(" / ") })}
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
            <InfoRow label={t("story.graphNodes")} value={String(content.graph.nodes.length)} />
          </dl>
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
      <dt className="text-white/62">{label}</dt>
      <dd className={cn("truncate text-right text-white/68", mono && "font-mono text-[11px]")}>
        {value}
      </dd>
    </div>
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

function countChoices(content: InteractiveStoryDraftContent): number {
  const decisionIds = new Set<string>();
  for (const node of content.graph.nodes) {
    if (node.exit.kind !== "choice") continue;
    decisionIds.add(node.exit.decisionId);
  }
  return decisionIds.size;
}

interface AuthoredDecision {
  id: string;
  sourceSceneLabels: string[];
  options: Array<{
    id: string;
    label: Record<string, string>;
    nextNodeId: string | null;
  }>;
}

function collectDecisions(content: InteractiveStoryDraftContent): AuthoredDecision[] {
  const decisions = new Map<string, AuthoredDecision>();
  for (const node of content.graph.nodes) {
    if (node.kind === "world" || node.exit.kind !== "choice") continue;
    const sourceLabel = node.kind === "clip" ? node.name?.trim() || node.clipKey : node.nodeId;
    const existing = decisions.get(node.exit.decisionId);
    if (existing) {
      existing.sourceSceneLabels.push(sourceLabel);
      continue;
    }
    decisions.set(node.exit.decisionId, {
      id: node.exit.decisionId,
      sourceSceneLabels: [sourceLabel],
      options: node.exit.choices.map((choice) => ({
        id: choice.choiceId,
        label: choice.label,
        nextNodeId: choice.nextNodeId,
      })),
    });
  }
  return [...decisions.values()];
}

function localizedText(values: Record<string, string> | undefined, locale: string): string {
  if (!values) return "—";
  return values[locale] || values["zh-CN"] || values["en-US"] || Object.values(values)[0] || "—";
}

function displayLanguage(languageTag: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(languageTag) ?? languageTag;
  } catch {
    return languageTag;
  }
}
