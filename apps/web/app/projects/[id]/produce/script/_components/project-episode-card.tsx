"use client";

import { useState } from "react";
import { IconChevronDown, IconChevronRight, IconSparkles } from "@tabler/icons-react";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";
import { loadProduceEpisodeScript } from "@/src/lib/produce/java-produce-data";
import type { ProjectScriptEpisode } from "../../_hooks/use-project-scripts";

interface ProjectEpisodeCardProps {
  episode: ProjectScriptEpisode;
  /**
   * Pre-resolved script content for a draft episode (Step 1's
   * `pipeline.draft` items aren't in Java yet, so the lazy fetch
   * would 404). When provided, the card skips fetch and shows the
   * in-memory text directly + flags the row as a draft.
   */
  draftScript?: string;
}

/**
 * One row of the read-only "existing project" view on the script
 * step. Collapsed by default; expanding fetches the episode's script
 * content (NOT the storyboard) and renders it as plain prose, line
 * by line.
 *
 * Why script and not storyboard: this is the Step 1 view — Step 1's
 * deliverable is the per-episode script. Storyboard rows belong to
 * Step 3 and are reviewed on the storyboard tab. Showing shot rows
 * here was misleading — the user came to confirm scripts.
 *
 * Lazy fetch keeps the page snappy even with 30+ episodes.
 */
export function ProjectEpisodeCard({ episode, draftScript }: ProjectEpisodeCardProps) {
  const t = useTranslations("produce");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scriptText, setScriptText] = useState<string>(draftScript ?? "");
  const [loaded, setLoaded] = useState(draftScript !== undefined);
  const [error, setError] = useState<string | null>(null);
  const isDraft = draftScript !== undefined;

  const ensureLoaded = async () => {
    if (loaded || loading || !episode.id) return;
    setLoading(true);
    setError(null);
    try {
      const detail = await loadProduceEpisodeScript(episode.id);
      setScriptText(detail.content);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("loadEpisodeScriptFailed"));
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) void ensureLoaded();
  };

  const scriptChars = scriptText.length;

  return (
    <Card className={cn("gap-3 p-4", isDraft && "ring-1 ring-amber-500/40 bg-amber-500/[0.02]")}>
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
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              第 {episode.no} 集：{episode.title}
              {isDraft && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/95 px-1.5 py-0.5 text-[10px] font-medium text-amber-950">
                  <IconSparkles className="size-2.5" /> {t("draftBadge")}
                </span>
              )}
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
        <div className="flex shrink-0 items-center gap-2">
          {(open || isDraft) && scriptChars > 0 ? (
            <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
              {t("scriptCharsBadge", { count: scriptChars })}
            </span>
          ) : null}
          {!isDraft && (
            <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
              {t("episodeShotCountBadge", { count: episode.shotCount })}
            </span>
          )}
        </div>
      </button>

      {open ? (
        <div className="border-t pt-3">
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner className="size-3.5" />
              {t("loadingEpisodeScript")}
            </div>
          ) : error ? (
            <div className="text-xs text-destructive">{error}</div>
          ) : !scriptText ? (
            <div className="text-xs text-muted-foreground">{t("episodeNoScript")}</div>
          ) : (
            <ScriptReadout text={scriptText} />
          )}
        </div>
      ) : null}
    </Card>
  );
}

// ─── Script readout ───────────────────────────────────────────

/** Render the script as plain prose, one line per source line. The
 *  upstream stripper turns `</p><p>` and `<br>` into `\n`, so split
 *  on newlines and trust each segment is a paragraph. Empty segments
 *  become spacer rows so paragraph breaks are visually preserved. */
function ScriptReadout({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  return (
    <div className="max-h-96 overflow-y-auto pr-1">
      <div className="flex flex-col gap-2 text-[13px] leading-relaxed text-foreground/90">
        {lines.map((line, index) => {
          const trimmed = line.trim();
          if (!trimmed) return <div key={index} className="h-2" aria-hidden />;
          return (
            <p key={index} className="whitespace-pre-wrap break-words">
              {trimmed}
            </p>
          );
        })}
      </div>
    </div>
  );
}
