"use client";

import { useRouter } from "next/navigation";
import { IconArrowLeft, IconLayoutDashboard } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";

interface EpisodeHeaderProps {
  projectId: string;
  episodeId: string;
  episodeNo: string;
  episodeTitle: string;
}

/**
 * Top header bar — back nav (true history.back) + episode title +
 * project-space jump. Credit chip / model picker / export were
 * removed earlier; add them back here when those features land.
 */
export function EpisodeHeader({
  projectId,
  episodeId,
  episodeNo,
  episodeTitle,
}: EpisodeHeaderProps) {
  const router = useRouter();
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border/60 px-4">
      <Button variant="ghost" color="muted" size="sm" onClick={() => router.back()}>
        <IconArrowLeft /> 返回
      </Button>
      <div className="min-w-0 flex-1 truncate text-sm font-semibold">
        {episodeNo ? `第${episodeNo}集 · ` : ""}
        {episodeTitle || `剧集 ${episodeId}`}
      </div>
      <Button
        variant="outline"
        color="muted"
        size="sm"
        onClick={() => router.push(`/projects/${projectId}`)}
      >
        <IconLayoutDashboard /> 进入项目空间
      </Button>
    </header>
  );
}
