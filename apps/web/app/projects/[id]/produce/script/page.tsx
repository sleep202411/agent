"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  IconAlertCircle,
  IconFileX,
  IconPlayerStop,
  IconRefresh,
  IconSparkles,
  IconTrash,
} from "@tabler/icons-react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useTranslations } from "@/src/i18n/i18n";
import { useAppSelector } from "@/src/store";
import { selectCurrentInstance } from "@/src/store/slices/projectSlice";
import { useProducePipeline } from "../_hooks/use-produce-pipeline";
import { useProjectScripts, type ProjectScriptEpisode } from "../_hooks/use-project-scripts";
import { useStepAdvanceController } from "../_hooks/use-step-advance";
import { ProjectEpisodeCard } from "./_components/project-episode-card";
import { ProduceReseedCard } from "./_components/produce-reseed-card";

const MESSAGE_INTERVAL_MS = 2200;

/**
 * Step 1 — Script. Pattern matches Step 2 (assets):
 *
 *   - Top status panel: branches over the pipeline state.
 *   - Episodes list below: ALWAYS renders. When step1 completes, the
 *     fresh-from-LLM draft items splat into this list with `draft_*`
 *     ids + a yellow ring + 草稿 badge.
 *   - Footer 下一步 button (in the wizard layout): when drafts are
 *     pending, it commits via `pipeline.commit()` then navigates to
 *     /produce/asset; otherwise it just navigates.
 *
 * Refresh wipes the in-memory File source — there's no resume path,
 * the user re-uploads. That trade-off is intentional (state machine
 * stays simple, no orphan LLM runs after refresh).
 */
export default function ProduceScriptPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = String(params.id ?? "");
  const pipeline = useProducePipeline(projectId);
  const projectScripts = useProjectScripts(projectId);
  const projectDetail = useAppSelector((s) => selectCurrentInstance(s).detail);
  const projectWorldId = useAppSelector((s) => selectCurrentInstance(s).worldId);
  const t = useTranslations("produce");

  // Episode list shown below the banner. Composed from:
  //   - committed rows from Java (useProjectScripts)
  //   - in-memory draft rows from pipeline.draft when step1 just
  //     finished generating.
  // Drafts go to the front so the just-generated content is first
  // thing the user reviews; committed rows follow.
  const draftEpisodes = useMemo<ProjectScriptEpisode[]>(() => {
    if (!pipeline.draft || pipeline.status !== "completed") return [];
    return pipeline.draft.episodes.map((ep) => ({
      id: `draft_${ep.no}_${pipeline.draft?.generatedAt ?? Date.now()}`,
      no: ep.no,
      title: ep.title,
      synopsis: ep.introduction,
      sort: ep.no * 1024,
      shotCount: 0,
      raw: { __draft: true, script: ep.script } as unknown as ProjectScriptEpisode["raw"],
    }));
  }, [pipeline.draft, pipeline.status]);

  const draftScriptByEpisodeId = useMemo(() => {
    const map = new Map<string, string>();
    if (!pipeline.draft || pipeline.status !== "completed") return map;
    pipeline.draft.episodes.forEach((ep) => {
      const key = `draft_${ep.no}_${pipeline.draft?.generatedAt ?? Date.now()}`;
      map.set(key, ep.script);
    });
    return map;
  }, [pipeline.draft, pipeline.status]);

  const hasDrafts = draftEpisodes.length > 0;
  const allEpisodes: ProjectScriptEpisode[] = useMemo(
    () => [...draftEpisodes, ...projectScripts.episodes],
    [draftEpisodes, projectScripts.episodes]
  );

  // Wire layout's footer 下一步 to commit drafts before navigating.
  const { setHandler } = useStepAdvanceController();
  useEffect(() => {
    if (!hasDrafts) {
      setHandler(null);
      return;
    }
    setHandler(async () => {
      try {
        await pipeline.commit();
        await projectScripts.refresh();
        router.push(`/projects/${projectId}/produce/asset`);
      } catch (err) {
        console.error("[script/page] commit failed:", err);
      }
    });
    return () => setHandler(null);
  }, [hasDrafts, pipeline, projectScripts, setHandler, router, projectId]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <Step1StatusPanel
        pipeline={pipeline}
        worldId={projectWorldId ?? undefined}
        worldName={projectDetail?.name?.trim() || `Project ${projectId}`}
        description={projectDetail?.description}
        hasDrafts={hasDrafts}
      />

      {projectScripts.loading && !hasDrafts ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner className="size-3.5" />
          {t("loadingProjectEpisodes")}
        </div>
      ) : projectScripts.error && !hasDrafts ? (
        <Empty className="border border-dashed border-border/40">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconAlertCircle />
            </EmptyMedia>
            <EmptyTitle>{t("loadEpisodesFailed")}</EmptyTitle>
            <EmptyDescription>{projectScripts.error}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : allEpisodes.length > 0 ? (
        <ExistingEpisodes
          episodes={allEpisodes}
          draftScripts={draftScriptByEpisodeId}
          showHeader={projectScripts.episodes.length > 0}
        />
      ) : (
        <Empty className="min-h-[28vh] border border-dashed border-border/40">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconFileX />
            </EmptyMedia>
            <EmptyTitle>{t("noEpisodesYet")}</EmptyTitle>
            <EmptyDescription>{t("noEpisodesYetHint")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
}

// ─── Status panel ──────────────────────────────────────────────────

type Pipeline = ReturnType<typeof useProducePipeline>;

function Step1StatusPanel({
  pipeline,
  worldId,
  worldName,
  description,
  hasDrafts,
}: {
  pipeline: Pipeline;
  worldId: string | undefined;
  worldName: string;
  description: string | undefined;
  hasDrafts: boolean;
}) {
  const t = useTranslations("produce");
  const status = pipeline.status;

  // Drafts are inline-merged into the episodes list below — banner just
  // confirms the state and offers retry / discard. Same pattern as
  // Step 2's asset page.
  if (hasDrafts && (status === "completed" || status === "committing" || status === "committed")) {
    return (
      <Card className="gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs text-primary">
              <IconSparkles className="size-3.5" /> {t("draftBadgePending")}
            </div>
            <h3 className="mt-1 text-sm font-semibold">{t("step1DraftMergedTitle")}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{t("step1DraftMergedHint")}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" color="muted" size="sm" onClick={pipeline.discard}>
              <IconTrash className="size-3.5" /> {t("resumeDiscard")}
            </Button>
            <Button variant="outline" color="muted" size="sm" onClick={pipeline.retry}>
              <IconRefresh className="size-3.5" /> {t("scriptDraftRetry")}
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  if (status === "idle") {
    return (
      <ProduceReseedCard
        worldId={worldId}
        worldName={worldName}
        description={description}
        onFileReady={pipeline.runWithFile}
      />
    );
  }

  if (status === "running") {
    return <RunningCard onCancel={pipeline.cancel} />;
  }

  if (status === "failed" || status === "cancelled") {
    return (
      <FailureCard
        cancelled={status === "cancelled"}
        error={pipeline.error}
        canRetry={pipeline.hasSource}
        onRetry={pipeline.retry}
        onDiscard={pipeline.discard}
      />
    );
  }

  // Transient gap — completed without drafts shouldn't last long
  // (draftEpisodes are derived synchronously from pipeline.draft).
  return (
    <Card className="gap-2 p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Spinner className="size-3.5" />
        {t("preparing")}
      </div>
    </Card>
  );
}

function RunningCard({ onCancel }: { onCancel: () => void | Promise<void> }) {
  const t = useTranslations("produce");
  const messages = useMemo(
    () => [t("scriptDraftMsgParse"), t("scriptDraftMsgPlan"), t("scriptDraftMsgWrite")],
    [t]
  );
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % messages.length);
    }, MESSAGE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [messages.length]);

  return (
    <Card className="gap-3 p-5">
      <div className="flex items-center gap-3">
        <Spinner className="size-5 text-primary" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{t("scriptDraftLoadingTitle")}</h3>
          <p key={index} className="mt-0.5 animate-in fade-in text-xs text-muted-foreground">
            {messages[index]}
          </p>
        </div>
        <Button variant="outline" color="muted" size="sm" onClick={() => void onCancel()}>
          <IconPlayerStop className="size-3.5" />
          {t("scriptDraftCancel")}
        </Button>
      </div>
    </Card>
  );
}

function FailureCard({
  cancelled,
  error,
  canRetry,
  onRetry,
  onDiscard,
}: {
  cancelled: boolean;
  error: string | undefined;
  canRetry: boolean;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const t = useTranslations("produce");
  return (
    <Card className="gap-3 p-5">
      <div className="flex items-start gap-3">
        <IconAlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">
            {cancelled ? t("scriptDraftCancelled") : t("scriptDraftFailed")}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {error || t("scriptDraftRetryHint")}
          </p>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" color="muted" size="sm" onClick={onDiscard}>
          <IconTrash className="size-3.5" />
          {t("resumeDiscard")}
        </Button>
        {canRetry ? (
          <Button variant="solid" color="primary" size="sm" onClick={onRetry}>
            <IconRefresh className="size-3.5" />
            {t("scriptDraftRetry")}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

// ─── Episodes list ─────────────────────────────────────────────────

function ExistingEpisodes({
  episodes,
  draftScripts,
  showHeader,
}: {
  episodes: ProjectScriptEpisode[];
  draftScripts: Map<string, string>;
  showHeader: boolean;
}) {
  const t = useTranslations("produce");
  const totalShots = episodes.reduce((sum, ep) => sum + ep.shotCount, 0);
  return (
    <div className="flex flex-col gap-4">
      {showHeader && (
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{t("existingBadge")}</p>
          <h2 className="mt-2 text-lg font-semibold">
            {t("existingHeader", { episodes: episodes.length, shots: totalShots })}
          </h2>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            {t("existingDescription")}
          </p>
        </div>
      )}
      <div className="grid gap-3">
        {episodes.map((episode) => (
          <ProjectEpisodeCard
            key={episode.id}
            episode={episode}
            draftScript={draftScripts.get(String(episode.id))}
          />
        ))}
      </div>
    </div>
  );
}
