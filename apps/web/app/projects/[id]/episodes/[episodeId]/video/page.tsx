"use client";

/**
 * Per-episode video editor — composition shell only. Heavy lifting
 * is split into siblings:
 *   _hooks/use-episode-shots          state + Java fetch
 *   _components/episode-header        top bar
 *   _components/shot-editor-panel     middle column (prompt + cells)
 *   _components/preview-panel         right column preview
 *   _components/shot-timeline         bottom horizontal strip
 *   _lib/shot-helpers                 cell access + mention helpers
 *
 * The page itself wires those together and handles the page-level
 * states (loading / empty / error). Anything heavier should keep
 * moving out of this file.
 */

import { useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { IconArrowLeft, IconFileX, IconLoader2 } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useProduceCommittedResult } from "../../../produce/_hooks/use-produce-seed";
import { EpisodeHeader } from "./_components/episode-header";
import { PreviewPanel } from "./_components/preview-panel";
import { ShotEditorPanel } from "./_components/shot-editor-panel";
import { ShotTimeline } from "./_components/shot-timeline";
import { useEpisodeShots } from "./_hooks/use-episode-shots";
import { findColumn, getCell, getMediaPath, getText } from "./_lib/shot-helpers";

export default function ProduceEpisodeVideoEditorPage() {
  const params = useParams<{ id: string; episodeId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = String(params.id ?? "");
  const episodeId = String(params.episodeId ?? "");
  const committed = useProduceCommittedResult(projectId);
  const queryWorldId = searchParams.get("worldId") ?? "";
  const episodeTitle = searchParams.get("title") ?? "";
  const episodeNo = searchParams.get("no") ?? "";

  const {
    columns,
    rows,
    assets,
    selectedShotId,
    setSelectedShotId,
    setRows,
    loading,
    error,
    reload,
  } = useEpisodeShots({
    projectId,
    episodeId,
    queryWorldId,
    committedWorldId: committed?.worldId,
  });

  // Derived columns + selection — kept here because the page wires
  // them into both the editor (middle column) and the timeline /
  // preview (right + bottom). Lifting up avoids prop-drilling
  // separate column lookups into each child.
  const selectedRow = useMemo(
    () => rows.find((row) => String(row.shotId ?? "") === selectedShotId) ?? rows[0] ?? null,
    [rows, selectedShotId]
  );

  const promptColumn = useMemo(
    () =>
      findColumn(columns, (column) => column.presetColumnKey === "video_prompt") ??
      findColumn(columns, (column) => column.presetColumnKey === "description") ??
      findColumn(columns, (column) => column.presetColumnKey === "image_prompt") ??
      findColumn(columns, (column) => column.resolvedType === "richtext"),
    [columns]
  );
  const imageColumn = useMemo(
    () => findColumn(columns, (column) => column.resolvedType === "image"),
    [columns]
  );
  const videoColumn = useMemo(
    () => findColumn(columns, (column) => column.resolvedType === "video"),
    [columns]
  );
  const durationColumn = useMemo(
    () => findColumn(columns, (column) => column.presetColumnKey === "duration"),
    [columns]
  );

  const imagePath = getMediaPath(getCell(selectedRow, imageColumn));
  const videoPath = getMediaPath(getCell(selectedRow, videoColumn));
  const durationValue = getText(getCell(selectedRow, durationColumn)) || "5";

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
          <IconLoader2 className="size-5 animate-spin" />
          正在加载单集分镜
        </div>
      </div>
    );
  }

  if (error || rows.length === 0) {
    return (
      <div className="h-screen bg-background p-6 text-foreground">
        <Button
          variant="ghost"
          color="muted"
          onClick={() => router.push(`/projects/${projectId}/produce/video`)}
        >
          <IconArrowLeft /> 返回
        </Button>
        <Empty className="min-h-[70vh] border-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconFileX />
            </EmptyMedia>
            <EmptyTitle>没有可编辑的分镜行</EmptyTitle>
            <EmptyDescription>{error || "请先完成 Step1 的剧本确认。"}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <EpisodeHeader
        projectId={projectId}
        episodeId={episodeId}
        episodeNo={episodeNo}
        episodeTitle={episodeTitle}
      />

      {/* Two-column main: editor fluid, preview fixed at the
          right. Below lg, preview hides itself (see PreviewPanel)
          and the editor takes the full width. */}
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_460px] 2xl:grid-cols-[minmax(0,1fr)_560px]">
        <ShotEditorPanel
          selectedRow={selectedRow}
          promptColumn={promptColumn}
          videoColumn={videoColumn}
          imageColumn={imageColumn}
          durationColumn={durationColumn}
          assets={assets}
          setRows={setRows}
          reload={reload}
        />

        <PreviewPanel videoPath={videoPath} imagePath={imagePath} duration={durationValue} />
      </main>

      <ShotTimeline
        rows={rows}
        selectedShotId={selectedShotId}
        imageColumn={imageColumn}
        videoColumn={videoColumn}
        durationColumn={durationColumn}
        onSelect={setSelectedShotId}
      />
    </div>
  );
}
