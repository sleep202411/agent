"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { IconEdit, IconFileX, IconLayout2, IconRefresh } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  loadEpisodeShotCount,
  loadProduceJavaEpisodes,
  loadProjectWorldId,
  type ProduceJavaEpisode,
} from "@/src/lib/produce/java-produce-data";
import { localizedProjectWorkspaceHref } from "@/src/lib/studio-routes";
import { useProduceCommittedResult } from "../_hooks/use-produce-seed";

export default function ProduceVideoPage() {
  const params = useParams();
  const projectId = String(params.id ?? "");
  const committed = useProduceCommittedResult(projectId);
  const committedWorldId = committed?.worldId ?? "";
  const [worldId, setWorldId] = useState(committedWorldId);
  const [episodes, setEpisodes] = useState<ProduceJavaEpisode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadEpisodes = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError("");
    try {
      const [resolvedWorldId, nextEpisodes] = await Promise.all([
        committedWorldId ? Promise.resolve(committedWorldId) : loadProjectWorldId(projectId),
        loadProduceJavaEpisodes(projectId),
      ]);
      setWorldId(resolvedWorldId);
      setEpisodes(nextEpisodes);
      void Promise.all(
        nextEpisodes.map(async (episode) => ({
          episodeId: episode.id,
          count: await loadEpisodeShotCount(episode.id).catch(() => 0),
        }))
      ).then((counts) => {
        setEpisodes((current) =>
          current.map((episode) => {
            const matched = counts.find((item) => item.episodeId === episode.id);
            return matched ? { ...episode, shotCount: matched.count } : episode;
          })
        );
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "剧集加载失败");
      setEpisodes([]);
    } finally {
      setLoading(false);
    }
  }, [committedWorldId, projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadEpisodes();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadEpisodes]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
          <IconRefresh className="size-5 animate-spin" />
          正在读取剧集和分镜
        </div>
      </div>
    );
  }

  if (error || episodes.length === 0) {
    return (
      <Empty className="min-h-[60vh] border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconFileX />
          </EmptyMedia>
          <EmptyTitle>还没有可编辑的视频分镜</EmptyTitle>
          <EmptyDescription>
            {error || "请先完成剧本确认，系统会写入剧集和分镜表。"}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">共 {episodes.length} 集</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            这里直接读取项目分镜表。进入编辑后，单元格改动会走项目详情页已有保存接口。
          </p>
        </div>
        <Button
          variant="ghost"
          color="muted"
          size="lg"
          className="rounded-full"
          onClick={() => void loadEpisodes()}
        >
          <IconRefresh />
          刷新
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-x-6 gap-y-5 lg:grid-cols-2">
        {episodes.map((episode) => (
          <EpisodeRow key={episode.id} projectId={projectId} worldId={worldId} episode={episode} />
        ))}
      </div>
    </div>
  );
}

function EpisodeRow({
  projectId,
  worldId,
  episode,
}: {
  projectId: string;
  worldId: string;
  episode: ProduceJavaEpisode;
}) {
  const href = localizedProjectWorkspaceHref(projectId, {
    suffix: `/episodes/${episode.id}/video`,
    query: {
      worldId,
      title: episode.title,
      no: episode.no,
    },
  });
  const shotCount = episode.shotCount;

  return (
    <div className="flex items-start gap-4">
      <span className="mt-3 w-6 shrink-0 text-center text-sm text-muted-foreground">
        {episode.no}
      </span>

      <Card className="flex-1 flex-row items-stretch gap-0 overflow-hidden p-0">
        <div className="relative flex w-[110px] shrink-0 items-center justify-center bg-muted">
          <span className="text-2xl font-semibold text-muted-foreground/35">{episode.no}</span>
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-between gap-3 p-4">
          <div className="flex flex-col gap-2">
            <h3 className="truncate text-sm font-semibold">
              第 {episode.no} 集：{episode.title}
            </h3>
            {episode.synopsis ? (
              <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                {episode.synopsis}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <MetaChip
                icon={<IconLayout2 className="size-3.5" />}
                label={typeof shotCount === "number" ? `${shotCount} 分镜` : "正在统计分镜"}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="solid" color="primary" size="default">
              <Link href={href}>
                <IconEdit /> 编辑分镜表
              </Link>
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function MetaChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {icon}
      {label}
    </span>
  );
}
