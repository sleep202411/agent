"use client";

import { useState } from "react";
import {
  IconEdit,
  IconPhoto,
  IconPlayerPlay,
  IconDownload,
  IconUsers,
  IconMapPin,
  IconLayoutList,
  IconArrowLeft,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { EpisodeEditor } from "@/components/pipeline/episode-editor";
import { StoryboardPlayer } from "@/components/player/storyboard-player";
import type { EpisodeStoryboard } from "@/src/store/slices/agentSlice";
import { useAppSelector, useAppDispatch } from "@/src/store";

export function StepStoryboard() {
  const t = useTranslations("pipeline");
  const tc = useTranslations("common");
  const stepStatuses = useAppSelector((s) => s.agent.stepStatuses);
  const storyboards = useAppSelector((s) => s.agent.storyboards);
  const outline = useAppSelector((s) => s.agent.outline);
  const [editingEpisodeId, setEditingEpisodeId] = useState<string | null>(null);
  const [previewEpisodeId, setPreviewEpisodeId] = useState<string | null>(null);

  const isGenerating = stepStatuses[3] === "generating";

  // Show episode editor when editing
  const editingStoryboard = storyboards.find((sb) => sb.episodeId === editingEpisodeId);
  if (editingStoryboard) {
    return (
      <div className="-m-6 h-[calc(100%+48px)]">
        <EpisodeEditor storyboard={editingStoryboard} onBack={() => setEditingEpisodeId(null)} />
      </div>
    );
  }

  // Show Remotion player when previewing
  const previewStoryboard = storyboards.find((sb) => sb.episodeId === previewEpisodeId);
  if (previewStoryboard) {
    return (
      <div className="flex h-full flex-col items-center gap-4">
        <div className="flex w-full items-center gap-3">
          <Button
            variant="ghost"
            color="muted"
            size="icon-sm"
            onClick={() => setPreviewEpisodeId(null)}
          >
            <IconArrowLeft className="size-4" />
          </Button>
          <span className="text-sm font-semibold">{previewStoryboard.title}</span>
        </div>
        <StoryboardPlayer
          shots={previewStoryboard.shots}
          bgmUrl={previewStoryboard.bgmUrl}
          aspectRatio={outline?.aspectRatio ?? "9:16"}
          className="w-full max-w-lg"
        />
      </div>
    );
  }

  if (isGenerating && storyboards.length === 0) {
    return <StoryboardSkeleton />;
  }

  return (
    <div className="w-full">
      <div className="mb-1 flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">共 {storyboards.length} 集</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            分镜脚本生成100字符消耗2积分，以实际生成为准
          </p>
        </div>
        <Button variant="outline" color="muted" size="sm">
          多选
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {storyboards.map((storyboard, index) => (
          <StoryboardCard
            key={storyboard.episodeId}
            storyboard={storyboard}
            index={index + 1}
            onEdit={() => setEditingEpisodeId(storyboard.episodeId)}
            onPreview={() => setPreviewEpisodeId(storyboard.episodeId)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Storyboard Card ────────────────────────────────────

function StoryboardCard({
  storyboard,
  index,
  onEdit,
  onPreview,
}: {
  storyboard: EpisodeStoryboard;
  index: number;
  onEdit: () => void;
  onPreview: () => void;
}) {
  const tc = useTranslations("common");
  const totalDuration = storyboard.shots.reduce((sum, shot) => sum + shot.duration, 0);
  const firstImage = storyboard.shots.find((s) => s.imageUrl)?.imageUrl;

  // Mock character/scene counts based on shot count
  const characterCount = Math.min(index + 1, 6);
  const sceneCount = 1;
  const shotCount = storyboard.shots.length;

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  return (
    <div className="flex gap-4 rounded-lg border border-border bg-card p-5">
      {/* Index */}
      <span className="shrink-0 pt-2 text-xl font-bold text-muted-foreground/30">{index}</span>

      {/* Thumbnail */}
      <div className="relative h-28 w-24 shrink-0 overflow-hidden rounded-lg bg-muted/30">
        {firstImage ? (
          <img src={firstImage} alt={storyboard.title} className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center">
            <IconPhoto className="size-8 text-muted-foreground/20" />
          </div>
        )}
        <span className="absolute bottom-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">
          {formatDuration(totalDuration)}
        </span>
      </div>

      {/* Info & actions */}
      <div className="flex flex-1 flex-col justify-between min-w-0">
        <div>
          <h4 className="text-sm font-semibold">{storyboard.title}</h4>
          <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <IconUsers className="size-3.5" />
              {characterCount} 角色
            </span>
            <span className="flex items-center gap-1">
              <IconMapPin className="size-3.5" />
              {sceneCount} 场景
            </span>
            <span className="flex items-center gap-1">
              <IconLayoutList className="size-3.5" />
              {shotCount} 分镜
            </span>
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          <Button variant="outline" color="muted" size="sm" onClick={onPreview}>
            <IconPlayerPlay className="size-3.5" />
            {tc("preview")}
          </Button>
          <Button variant="outline" color="muted" size="sm" onClick={onEdit}>
            <IconEdit className="size-3.5" />
            {tc("edit")}
          </Button>
          <Button size="sm">
            <IconDownload className="size-3.5" />
            {tc("export")}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Skeleton ───────────────────────────────────────────

function StoryboardSkeleton() {
  const t = useTranslations("pipeline");
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex items-center gap-3 text-muted-foreground">
        <Spinner className="size-5" />
        <span className="text-sm">{t("generatingStoryboard")}</span>
      </div>
    </div>
  );
}
