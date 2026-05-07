"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  IconAlertCircle,
  IconArrowRight,
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
import { useProjectScripts } from "../_hooks/use-project-scripts";
import { ProjectEpisodeCard } from "./_components/project-episode-card";
import { ProduceReseedCard } from "./_components/produce-reseed-card";

const MESSAGE_INTERVAL_MS = 2200;

/**
 * Step 1 — Script.
 *
 * Single unified layout. Status panel on top, project episodes always
 * below. The pipeline state machine has only 4 visible states (the
 * `committed` blip routes away before users see it):
 *
 *   idle (no seed)              → ProduceReseedCard (upload entry)
 *   running                     → progress card (cancel button)
 *   completed | committing      → draft review + 保存继续
 *   failed | cancelled          → error card (retry / discard)
 *
 * Refresh = lose the in-memory seed = upload card. Retry uses the
 * same seed in React state, so the user doesn't re-upload between
 * attempts on the same page mount.
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

  // Refresh the existing-episodes list after a successful commit so
  // the new rows show up alongside any saved ones.
  useEffect(() => {
    if (pipeline.status === "committed") {
      void projectScripts.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipeline.status]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PipelineStatusPanel
        pipeline={pipeline}
        worldId={projectWorldId ?? undefined}
        worldName={projectDetail?.name?.trim() || `Project ${projectId}`}
        description={projectDetail?.description}
        onContinueToAssets={() => router.push(`/projects/${projectId}/produce/asset`)}
      />

      {projectScripts.loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner className="size-3.5" />
          {t("loadingProjectEpisodes")}
        </div>
      ) : projectScripts.error ? (
        <Empty className="border border-dashed border-border/40">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconAlertCircle />
            </EmptyMedia>
            <EmptyTitle>{t("loadEpisodesFailed")}</EmptyTitle>
            <EmptyDescription>{projectScripts.error}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : projectScripts.episodes.length > 0 ? (
        <ExistingEpisodes episodes={projectScripts.episodes} />
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

// ─── Pipeline status panel ────────────────────────────────────

type Pipeline = ReturnType<typeof useProducePipeline>;

function PipelineStatusPanel({
  pipeline,
  worldId,
  worldName,
  description,
  onContinueToAssets,
}: {
  pipeline: Pipeline;
  worldId: string | undefined;
  worldName: string;
  description: string | undefined;
  onContinueToAssets: () => void;
}) {
  const t = useTranslations("produce");
  const status = pipeline.status;

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

  if (
    (status === "completed" || status === "committing" || status === "committed") &&
    pipeline.draft
  ) {
    return (
      <DraftReviewCard
        draft={pipeline.draft}
        committing={status === "committing"}
        committed={status === "committed"}
        onCommit={async () => {
          await pipeline.commit();
          onContinueToAssets();
        }}
      />
    );
  }

  // Transient gap (e.g. mount → consume seed → run effect schedules).
  // Render a slim placeholder rather than an empty hole.
  return (
    <Card className="gap-2 p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Spinner className="size-3.5" />
        {t("preparing")}
      </div>
    </Card>
  );
}

// ─── State sub-cards ──────────────────────────────────────────

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

function DraftReviewCard({
  draft,
  committing,
  committed,
  onCommit,
}: {
  draft: NonNullable<Pipeline["draft"]>;
  committing: boolean;
  committed: boolean;
  onCommit: () => Promise<void>;
}) {
  const t = useTranslations("produce");
  const totalScriptChars = draft.episodes.reduce((sum, ep) => sum + ep.script.length, 0);
  return (
    <Card className="gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs text-primary">
            <IconSparkles className="size-3.5" />
            {t("draftBadgePending")}
          </div>
          <h3 className="mt-1 text-base font-semibold">{draft.title}</h3>
          <p className="mt-2 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            {draft.storySummary}
          </p>
        </div>
        <Button
          variant="solid"
          color="primary"
          size="lg"
          disabled={committing || committed}
          onClick={() => void onCommit()}
        >
          {committing ? t("committing") : t("saveAndContinue")}
          <IconArrowRight />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <Metric label={t("metricEpisodes")} value={draft.episodes.length} />
        <Metric label={t("metricScriptChars")} value={totalScriptChars} />
        {draft.language && <Metric label={t("metricLanguage")} valueText={draft.language} />}
      </div>

      <ul className="grid gap-1.5">
        {draft.episodes.map((episode) => (
          <li
            key={episode.no}
            className="flex items-start gap-2 rounded-md bg-muted/30 px-2.5 py-1.5"
          >
            <span className="shrink-0 select-none font-mono text-xs text-muted-foreground/80">
              {String(episode.no).padStart(2, "0")}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium">{episode.title}</div>
              <p className="line-clamp-1 text-[11px] text-muted-foreground/80">
                {episode.introduction}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {t("scriptCharsBadge", { count: episode.script.length })}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ─── Existing episodes (always-on) ────────────────────────────

function ExistingEpisodes({
  episodes,
}: {
  episodes: ReturnType<typeof useProjectScripts>["episodes"];
}) {
  const t = useTranslations("produce");
  const totalShots = episodes.reduce((sum, ep) => sum + ep.shotCount, 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{t("existingBadge")}</p>
        <h2 className="mt-2 text-lg font-semibold">
          {t("existingHeader", { episodes: episodes.length, shots: totalShots })}
        </h2>
        <p className="mt-2 max-w-3xl text-xs leading-relaxed text-muted-foreground">
          {t("existingDescription")}
        </p>
      </div>
      <div className="grid gap-3">
        {episodes.map((episode) => (
          <ProjectEpisodeCard key={episode.id} episode={episode} />
        ))}
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────

function Metric({
  label,
  value,
  valueText,
}: {
  label: string;
  value?: number;
  valueText?: string;
}) {
  return (
    <Card className="gap-1 p-3">
      <div className="text-base font-semibold">
        {valueText ?? (typeof value === "number" ? value.toLocaleString() : "—")}
      </div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </Card>
  );
}
