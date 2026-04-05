"use client";

import { useState } from "react";
import {
  IconArrowLeft,
  IconUsers,
  IconMapPin,
  IconPlus,
  IconPlayerPlay,
  IconVolume,
  IconMaximize,
  IconDownload,
  IconEdit,
  IconPhoto,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { EpisodeStoryboard, Shot } from "@/src/store/slices/agentSlice";

// ─── Mock data for the editor ───────────────────────────

const mockCharacters = [
  { name: "林萧", tag: "基础形象·基础拾荒者形象" },
  { name: "王强", tag: "基础形象·基础形象" },
];

const mockScenes = [{ name: "基地外的废墟街道_0" }];

// ─── Component ──────────────────────────────────────────

interface EpisodeEditorProps {
  storyboard: EpisodeStoryboard;
  onBack: () => void;
}

export function EpisodeEditor({ storyboard, onBack }: EpisodeEditorProps) {
  const t = useTranslations("pipeline");
  const tc = useTranslations("common");
  const [activeShot, setActiveShot] = useState(0);
  const currentShot = storyboard.shots[activeShot];

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-card px-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" color="muted" size="icon-sm" onClick={onBack}>
            <IconArrowLeft className="size-4" />
          </Button>
          <span className="text-sm font-semibold">{storyboard.title}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" disabled>
            {t("synthesizeAll")}
          </Button>
        </div>
      </header>

      {/* Main content — 3 columns */}
      <div className="flex flex-1 overflow-hidden">
        {/* ─── Left: Asset library ─── */}
        <aside className="w-56 shrink-0 overflow-auto border-r border-border p-4">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold">{t("assetLibrary")}</h3>
            <Button variant="ghost" color="muted" size="icon-xs">
              <IconPlus className="size-4" />
            </Button>
          </div>

          {/* Characters */}
          <div className="mb-4">
            <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <IconUsers className="size-3.5" />
              {t("characters")} ({mockCharacters.length})
            </div>
            <div className="flex gap-2">
              {mockCharacters.map((char) => (
                <div key={char.name} className="w-20 text-center">
                  <div className="mx-auto aspect-square w-full overflow-hidden rounded-lg bg-muted/30">
                    <div className="flex size-full items-center justify-center">
                      <IconPhoto className="size-6 text-muted-foreground/20" />
                    </div>
                  </div>
                  <p className="mt-1 truncate text-[10px] font-medium">{char.name}</p>
                  <p className="truncate text-[9px] text-muted-foreground">{char.tag}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Scenes */}
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <IconMapPin className="size-3.5" />
              {t("scenes")} ({mockScenes.length})
            </div>
            <div className="space-y-2">
              {mockScenes.map((scene) => (
                <div key={scene.name}>
                  <div className="aspect-video w-full overflow-hidden rounded-lg bg-muted/30">
                    <div className="flex size-full items-center justify-center">
                      <IconPhoto className="size-6 text-muted-foreground/20" />
                    </div>
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">{scene.name}</p>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* ─── Center: Script details ─── */}
        <div className="flex-1 overflow-auto p-6">
          {currentShot && (
            <ShotDetail
              shot={currentShot}
              shotIndex={activeShot}
              totalShots={storyboard.shots.length}
            />
          )}
        </div>

        {/* ─── Right: Video preview ─── */}
        <div className="w-[380px] shrink-0 border-l border-border p-4">
          <div className="overflow-hidden rounded-lg bg-black">
            <div className="flex aspect-[9/16] items-center justify-center">
              <IconPlayerPlay className="size-12 text-white/30" />
            </div>
            {/* Player controls */}
            <div className="flex items-center justify-between bg-black/80 px-3 py-2">
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  color="muted"
                  size="icon-xs"
                  className="text-white/70 hover:text-white"
                >
                  <IconPlayerPlay className="size-4" />
                </Button>
                <span className="text-xs text-white/60">
                  00:00 | {formatDuration(currentShot?.duration ?? 0)}
                </span>
                <Button
                  variant="ghost"
                  color="muted"
                  size="icon-xs"
                  className="text-white/70 hover:text-white"
                >
                  <IconVolume className="size-4" />
                </Button>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  color="muted"
                  size="icon-xs"
                  className="text-white/70 hover:text-white"
                >
                  <IconMaximize className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  color="muted"
                  size="icon-xs"
                  className="text-white/70 hover:text-white"
                >
                  <IconDownload className="size-4" />
                </Button>
              </div>
            </div>
          </div>
          <p className="mt-2 text-right text-[10px] text-muted-foreground">
            {t("videoCreditNote")}
          </p>
        </div>
      </div>

      {/* ─── Bottom: Shot timeline ─── */}
      <div className="shrink-0 border-t border-border bg-card px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <IconPlayerPlay className="size-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              {formatDuration(getTotalDuration(storyboard.shots, activeShot))} /{" "}
              {formatDuration(getTotalDuration(storyboard.shots))}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">{t("multiSelect")}</span>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {storyboard.shots.map((shot, i) => (
            <button
              key={shot.id}
              type="button"
              onClick={() => setActiveShot(i)}
              className={cn(
                "relative shrink-0 w-24 overflow-hidden rounded-md border-2 transition-colors",
                i === activeShot ? "border-primary" : "border-transparent hover:border-border"
              )}
            >
              {/* Shot number badge */}
              <span className="absolute left-1 top-1 z-10 flex size-4 items-center justify-center rounded bg-primary text-[9px] font-bold text-primary-foreground">
                {i + 1}
              </span>
              {/* Thumbnail */}
              <div className="aspect-[9/16] bg-muted/30">
                {shot.imageUrl ? (
                  <img src={shot.imageUrl} alt="" className="size-full object-cover" />
                ) : (
                  <div className="flex size-full items-center justify-center">
                    <IconPhoto className="size-4 text-muted-foreground/20" />
                  </div>
                )}
              </div>
              {/* Duration */}
              <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 py-0.5 text-[9px] text-white">
                {formatDuration(shot.duration)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Shot Detail ────────────────────────────────────────

function ShotDetail({
  shot,
  shotIndex,
  totalShots,
}: {
  shot: Shot;
  shotIndex: number;
  totalShots: number;
}) {
  const t = useTranslations("pipeline");
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">{t("shotNumber", { index: shotIndex + 1 })}</h3>
          <span className="text-xs text-muted-foreground">{t("shotDurationHint")}</span>
        </div>
      </div>

      <div className="space-y-4 rounded-lg border border-border bg-card p-5">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{t("visualStyleType")}</span> 3D, CG动画,
          废土末世, 男频科幻/游戏
        </p>

        <p className="text-sm text-muted-foreground">
          生成一个由{totalShots > 3 ? 3 : totalShots}个分镜组成的视频:
        </p>

        <div className="space-y-4 text-sm leading-relaxed text-muted-foreground">
          <div>
            <p className="font-medium text-foreground">
              {t("storyboardShot", { index: shotIndex + 1 })} ⏱ {shot.duration}.0 s ; 时间: 日，
              <span className="mx-1 inline-flex items-center gap-0.5 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                🧑 林萧-基础形象·基础拾荒者形象
              </span>
            </p>
            <p className="mt-1">
              {shot.description ||
                "的瞳孔深处闪过一道金色符文，眼神瞬间从隐忍变为冰冷。镜头前朝向迎面的巨鳄，视线锁定目标。"}
            </p>
          </div>

          {shot.dialogue && (
            <div>
              <p>
                <span className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                  🧑 林萧-基础形象·基础拾荒者形象
                </span>{" "}
                {t("says", { dialogue: shot.dialogue })}
              </p>
            </div>
          )}

          {shot.narration && (
            <p className="italic">{t("narrationLabel", { text: shot.narration })}</p>
          )}
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <Button variant="outline" color="muted">
          <IconEdit className="size-4" />
          {t("editScript")}
        </Button>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function getTotalDuration(shots: Shot[], upTo?: number) {
  const sliced = upTo !== undefined ? shots.slice(0, upTo + 1) : shots;
  return sliced.reduce((sum, s) => sum + s.duration, 0);
}
