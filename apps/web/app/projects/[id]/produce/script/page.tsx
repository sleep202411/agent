"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  IconAlertCircle,
  IconArrowRight,
  IconFileX,
  IconPlayerStop,
  IconRefresh,
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
import { useProduceSeed } from "../_hooks/use-produce-seed";
import { useProducePipeline } from "../_hooks/use-produce-pipeline";
import { useProjectScripts } from "../_hooks/use-project-scripts";
import { ProjectEpisodeCard } from "./_components/project-episode-card";

const MESSAGE_INTERVAL_MS = 2200;

/**
 * Step 1 — Script. Single page-wide loading state until the consult
 * endpoint is wired; once it's done generating, this swaps to the
 * real episode TOC + content layout.
 */
export default function ProduceScriptPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = String(params.id ?? "");
  const seed = useProduceSeed(projectId);
  const pipeline = useProducePipeline(projectId, seed);
  const loading = pipeline.status === "running";
  const t = useTranslations("produce");
  const loadingMessages = useMemo(
    () => [
      t("scriptDraftMsgParse"),
      t("scriptDraftMsgPlan"),
      t("scriptDraftMsgWrite"),
      t("scriptDraftMsgStoryboard"),
    ],
    [t]
  );

  const [messageIndex, setMessageIndex] = useState(0);
  useEffect(() => {
    if (!loading) return;
    const id = window.setInterval(() => {
      setMessageIndex((i) => (i + 1) % loadingMessages.length);
    }, MESSAGE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [loading, loadingMessages.length]);

  // No seed → fall back to whatever Java already has for the
  // project. Returning users (committed earlier, or built
  // episodes through chat) should see their work, not the empty
  // onboarding card. The pipeline branch below only runs when
  // there's a fresh seed to analyse.
  const projectScripts = useProjectScripts(seed ? "" : projectId);
  if (!seed) {
    if (projectScripts.loading) {
      return (
        <div className="mx-auto flex min-h-[60vh] w-full max-w-3xl flex-col items-center justify-center gap-3">
          <Spinner className="size-6 text-primary" />
          <p className="text-sm text-muted-foreground">正在加载项目剧集…</p>
        </div>
      );
    }
    if (projectScripts.error) {
      return (
        <Empty className="min-h-[60vh] border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconAlertCircle />
            </EmptyMedia>
            <EmptyTitle>加载剧集失败</EmptyTitle>
            <EmptyDescription>{projectScripts.error}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      );
    }
    if (projectScripts.episodes.length > 0) {
      const totalShots = projectScripts.episodes.reduce((sum, ep) => sum + ep.shotCount, 0);
      return (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">项目剧集 · 已入库</p>
            <h2 className="mt-2 text-xl font-semibold">
              {projectScripts.episodes.length} 集 · {totalShots} 分镜
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              项目已存在剧集与分镜数据。可直接进入下一步生成资产或视频。
            </p>
          </div>

          <div className="grid gap-3">
            {projectScripts.episodes.map((episode) => (
              <ProjectEpisodeCard key={episode.id} episode={episode} />
            ))}
          </div>
        </div>
      );
    }
    return (
      <Empty className="min-h-[60vh] border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconFileX />
          </EmptyMedia>
          <EmptyTitle>还没有剧本数据</EmptyTitle>
          <EmptyDescription>
            从首页或 Studio 创建一个新项目并上传剧本素材，StoryOS 会把分析结果自动带入这里。
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto flex min-h-[60vh] w-full max-w-3xl flex-col items-center justify-center gap-6">
        <Spinner className="size-8 text-primary" />
        <div className="w-full text-center">
          <h2 className="text-lg font-semibold">{t("scriptDraftLoadingTitle")}</h2>
          <p key={messageIndex} className="mt-2 animate-in fade-in text-sm text-muted-foreground">
            {loadingMessages[messageIndex]}
          </p>
        </div>
        <Button variant="outline" color="muted" size="lg" onClick={() => void pipeline.cancel()}>
          <IconPlayerStop /> {t("scriptDraftCancel")}
        </Button>
      </div>
    );
  }

  if (pipeline.status === "failed" || pipeline.status === "cancelled") {
    return (
      <Empty className="min-h-[60vh] border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconAlertCircle />
          </EmptyMedia>
          <EmptyTitle>
            {pipeline.status === "cancelled" ? t("scriptDraftCancelled") : t("scriptDraftFailed")}
          </EmptyTitle>
          <EmptyDescription>{pipeline.error || t("scriptDraftRetryHint")}</EmptyDescription>
        </EmptyHeader>
        <Button
          variant="solid"
          color="primary"
          size="lg"
          className="mt-4"
          onClick={() => pipeline.retry()}
        >
          <IconRefresh /> {t("scriptDraftRetry")}
        </Button>
      </Empty>
    );
  }

  const draft = pipeline.draft;
  if (!draft) {
    return (
      <Empty className="min-h-[60vh] border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Spinner className="text-primary" />
          </EmptyMedia>
          <EmptyTitle>准备分析</EmptyTitle>
          <EmptyDescription>正在启动生产流水线。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const totals = {
    characters: draft.assets.characters.length,
    scenes: draft.assets.scenes.length,
    props: draft.assets.props.length,
    shots: draft.episodes.reduce((sum, ep) => sum + ep.storyboardRows.length, 0),
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">临时草稿 · 尚未入库</p>
          <h2 className="mt-2 text-xl font-semibold">{draft.title}</h2>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {draft.storySummary}
          </p>
        </div>
        <Button
          variant="solid"
          color="primary"
          size="lg"
          disabled={pipeline.status === "committing"}
          onClick={async () => {
            await pipeline.commit();
            router.push(`/projects/${projectId}/produce/asset`);
          }}
        >
          {pipeline.status === "committing" ? "正在入库…" : "确认并进入资产生图"}
          <IconArrowRight />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="剧集" value={draft.episodes.length} />
        <Metric label="角色" value={totals.characters} />
        <Metric label="场景/道具" value={totals.scenes + totals.props} />
        <Metric label="分镜" value={totals.shots} />
      </div>

      <div className="grid gap-3">
        {draft.episodes.map((episode) => (
          <Card key={episode.clientRefId} className="gap-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">
                  第 {episode.no} 集：{episode.title}
                </h3>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                  {episode.introduction}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
                {episode.storyboardRows.length} 分镜
              </span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card className="gap-1 p-4">
      <div className="text-xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </Card>
  );
}
