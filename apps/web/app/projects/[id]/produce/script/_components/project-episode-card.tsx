"use client";

import { useState } from "react";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { loadProduceStoryboard, type ProduceShotColumn } from "@/src/lib/produce/java-produce-data";
import type { ShotRow, ShotValue } from "@/src/store/slices/projectSlice";
import type { ProjectScriptEpisode } from "../../_hooks/use-project-scripts";

interface ProjectEpisodeCardProps {
  episode: ProjectScriptEpisode;
}

/**
 * One row of the read-only "existing project" view on the script
 * step. Collapsed by default; expanding fetches the episode's shots
 * once and renders them as a screenplay-shaped readout (shot number
 * + scene heading + description + dialogue per row).
 *
 * Lazy fetch keeps the project page snappy even with 30+ episodes —
 * the storyboard endpoint costs us a paged query per episode, and
 * most users only open one or two.
 */
export function ProjectEpisodeCard({ episode }: ProjectEpisodeCardProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [columns, setColumns] = useState<ProduceShotColumn[]>([]);
  const [rows, setRows] = useState<ShotRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ensureLoaded = async () => {
    if (loaded || loading || !episode.id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await loadProduceStoryboard(episode.id);
      setColumns(data.columns);
      setRows(data.rows);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载剧本失败");
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) void ensureLoaded();
  };

  return (
    <Card className="gap-3 p-4">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <div className="flex min-w-0 flex-1 items-start gap-2">
          {open ? (
            <IconChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          ) : (
            <IconChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">
              第 {episode.no} 集：{episode.title}
            </h3>
            {episode.synopsis ? (
              <p
                className={cn(
                  "mt-1 text-xs leading-relaxed text-muted-foreground",
                  open ? "" : "line-clamp-2"
                )}
              >
                {episode.synopsis}
              </p>
            ) : null}
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
          {episode.shotCount} 分镜
        </span>
      </button>

      {open ? (
        <div className="border-t pt-3">
          {loading && rows.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner className="size-3.5" />
              正在加载剧本…
            </div>
          ) : error ? (
            <div className="text-xs text-destructive">{error}</div>
          ) : rows.length === 0 ? (
            <div className="text-xs text-muted-foreground">本集尚无分镜内容</div>
          ) : (
            <ScreenplayReadout rows={rows} columns={columns} />
          )}
        </div>
      ) : null}
    </Card>
  );
}

// ─── Screenplay readout ───────────────────────────────────────

/** Render rows as a screenplay-shaped block. Pulls the most useful
 *  fields by `presetColumnKey` so it works regardless of the column
 *  order Java returns. */
function ScreenplayReadout({ rows, columns }: { rows: ShotRow[]; columns: ProduceShotColumn[] }) {
  const sceneCol = columns.find((c) => c.presetColumnKey === "scene") ?? null;
  const descCol = columns.find((c) => c.presetColumnKey === "description") ?? null;
  const dialogueCol = columns.find((c) => c.presetColumnKey === "dialogue") ?? null;

  return (
    <ol className="flex flex-col gap-3 text-[13px] leading-relaxed">
      {rows.map((row, index) => {
        const scene = readCell(row, sceneCol);
        const desc = readCell(row, descCol);
        const dialogue = readCell(row, dialogueCol);
        return (
          <li
            key={String(row.shotId ?? index)}
            className="flex gap-3 border-l-2 border-border/60 pl-3"
          >
            <span className="shrink-0 select-none font-mono text-xs text-muted-foreground/80">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {scene ? (
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {scene}
                </div>
              ) : null}
              {desc ? <div className="text-foreground/90">{desc}</div> : null}
              {dialogue ? (
                <div className="text-xs text-muted-foreground">「{dialogue}」</div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function readCell(row: ShotRow, column: ProduceShotColumn | null): string {
  if (!column?.id) return "";
  const cell = row.shotValues?.find((value) => String(value.shotColumnId ?? "") === column.id);
  return readText(cell);
}

function readText(cell?: ShotValue): string {
  const richText = typeof cell?.richText?.content === "string" ? cell.richText.content : "";
  if (richText.trim()) {
    // Strip mention/HTML tags for a plain readable view; the editor
    // surfaces will use the rich form, but this readout is plain.
    return richText
      .replace(/<mention[^>]*>([\s\S]*?)<\/mention>/g, "$1")
      .replace(/<[^>]+>/g, "")
      .trim();
  }
  return String(cell?.value ?? "").trim();
}
