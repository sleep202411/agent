"use client";

import { IconPlus, IconTrash, IconRefresh } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { StoryOutlineResult } from "@/src/lib/agent/schemas";
import { useAppSelector, useAppDispatch } from "@/src/store";
import {
  updateOutlineField,
  addEpisode,
  updateEpisode,
  removeEpisode,
} from "@/src/store/slices/agentSlice";
import { Field, FieldLabel } from "@/components/ui/field";

interface StepOutlineProps {
  /** Partial streaming object from useObject — shown as thinking process */
  streamingOutline?: Partial<StoryOutlineResult>;
}

export function StepOutline({ streamingOutline }: StepOutlineProps) {
  const t = useTranslations("pipeline");
  const tp = useTranslations("project");
  const dispatch = useAppDispatch();
  const outline = useAppSelector((s) => s.agent.outline);
  const stepStatuses = useAppSelector((s) => s.agent.stepStatuses);

  const isGenerating = stepStatuses[1] === "generating";

  // ─── Generating state: centered spinner + thinking process ───
  if (isGenerating || !outline) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-6 max-w-md">
          {/* Spinner */}
          <div className="flex flex-col items-center gap-3">
            <Spinner />
            <p className="text-xs text-muted-foreground">{t("generatingOutline")}</p>
          </div>

          {/* Thinking process — subtle, only if streaming data exists */}
          {streamingOutline && Object.keys(streamingOutline).length > 0 && (
            <ThinkingProcess data={streamingOutline} />
          )}
        </div>
      </div>
    );
  }

  // ─── Done: normal content ───────────────────────────────────

  const handleAddEpisode = () => {
    dispatch(
      addEpisode({
        id: crypto.randomUUID(),
        title: "",
        summary: "",
        script: "",
      })
    );
  };

  return (
    <div className="flex h-full gap-6 overflow-hidden">
      {/* ─── Left: Story Outline (sticky) ─── */}
      <div className="w-[400px] shrink-0 overflow-auto">
        <div className="space-y-4">
          {/* Video style & aspect ratio */}
          <div className="flex gap-4">
            <Field orientation="horizontal" className="w-auto">
              <FieldLabel className="text-sm font-medium text-muted-foreground whitespace-nowrap">
                {t("videoStyleLabel")}
              </FieldLabel>
              <Select
                value={outline.videoStyle}
                onValueChange={(v) =>
                  dispatch(updateOutlineField({ field: "videoStyle", value: v }))
                }
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3D, CG动画">{t("style3DCG")}</SelectItem>
                  <SelectItem value="2D动画">{t("style2D")}</SelectItem>
                  <SelectItem value="写实">{t("styleRealistic")}</SelectItem>
                  <SelectItem value="水墨风">{t("styleInkWash")}</SelectItem>
                  <SelectItem value="赛博朋克">{t("styleCyberpunk")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field orientation="horizontal" className="w-auto">
              <FieldLabel className="text-sm font-medium text-muted-foreground whitespace-nowrap">
                {t("aspectRatioLabel")}
              </FieldLabel>
              <Select
                value={outline.aspectRatio}
                onValueChange={(v) =>
                  dispatch(updateOutlineField({ field: "aspectRatio", value: v }))
                }
              >
                <SelectTrigger className="w-[100px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="16:9">16:9</SelectItem>
                  <SelectItem value="9:16">9:16</SelectItem>
                  <SelectItem value="1:1">1:1</SelectItem>
                  <SelectItem value="4:3">4:3</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          {/* Story info */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <EditableField
              label={tp("projectName")}
              value={outline.title}
              onChange={(v) => dispatch(updateOutlineField({ field: "title", value: v }))}
            />
            <EditableField
              label={t("storyType")}
              value={outline.genre}
              onChange={(v) => dispatch(updateOutlineField({ field: "genre", value: v }))}
              placeholder={t("storyTypePlaceholder")}
            />
            <EditableField
              label={t("storyBackground")}
              value={outline.background}
              onChange={(v) => dispatch(updateOutlineField({ field: "background", value: v }))}
              multiline
              placeholder={t("storyBackgroundPlaceholder")}
            />
            <EditableField
              label={t("coreConflict")}
              value={outline.conflict}
              onChange={(v) => dispatch(updateOutlineField({ field: "conflict", value: v }))}
              multiline
              placeholder={t("coreConflictPlaceholder")}
            />
            <EditableField
              label={t("oneLineStory")}
              value={outline.oneLiner}
              onChange={(v) => dispatch(updateOutlineField({ field: "oneLiner", value: v }))}
              multiline
              placeholder={t("oneLineStoryPlaceholder")}
            />
          </div>
        </div>
      </div>

      {/* ─── Right: Episodes with scripts ─── */}
      <div className="flex-1 min-w-0 overflow-auto">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            {t("episodePlots", { count: outline.episodes.length })}
          </h3>
        </div>

        <div className="space-y-3">
          {outline.episodes.map((episode, index) => (
            <div key={episode.id} className="group rounded-lg border border-border bg-card">
              {/* Episode header */}
              <div className="flex items-start gap-3 p-4">
                <div className="flex-1 min-w-0 space-y-1.5">
                  <input
                    value={episode.title}
                    onChange={(e) =>
                      dispatch(
                        updateEpisode({ id: episode.id, updates: { title: e.target.value } })
                      )
                    }
                    placeholder={t("episodeTitlePlaceholder", { index: index + 1 })}
                    className="w-full bg-transparent text-sm font-semibold focus:outline-none"
                  />
                  <textarea
                    value={episode.summary}
                    onChange={(e) =>
                      dispatch(
                        updateEpisode({ id: episode.id, updates: { summary: e.target.value } })
                      )
                    }
                    placeholder={t("plotSummaryPlaceholder")}
                    rows={2}
                    className="w-full resize-none bg-transparent text-sm text-muted-foreground focus:outline-none"
                  />
                </div>
                <Button
                  variant="ghost"
                  color="muted"
                  size="icon-sm"
                  className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                  onClick={() => dispatch(removeEpisode(episode.id))}
                >
                  <IconTrash className="size-4" />
                </Button>
              </div>

              {/* Script area */}
              <div className="border-t border-border px-4 py-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">{t("script")}</span>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" color="muted" size="icon-xs">
                      <IconRefresh className="size-3.5" />
                    </Button>
                  </div>
                </div>
                <textarea
                  value={episode.script}
                  onChange={(e) =>
                    dispatch(updateEpisode({ id: episode.id, updates: { script: e.target.value } }))
                  }
                  placeholder={t("episodeScriptPlaceholder")}
                  rows={5}
                  className="w-full resize-y rounded-md border border-border bg-muted/20 p-3 text-sm leading-relaxed text-muted-foreground focus:outline-none"
                />
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={handleAddEpisode}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
          >
            <IconPlus className="size-4" />
            {t("addChapter")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Thinking Process ──────────────────────────────────

function ThinkingProcess({ data }: { data: Partial<StoryOutlineResult> }) {
  const t = useTranslations("pipeline");
  const items: string[] = [];

  if (data.title) items.push(t("thinkingTitle", { value: data.title }));
  if (data.genre) items.push(t("thinkingGenre", { value: data.genre }));
  if (data.videoStyle) items.push(t("thinkingStyle", { value: data.videoStyle }));
  if (data.background)
    items.push(t("thinkingBackground", { value: truncate(data.background, 60) }));
  if (data.conflict) items.push(t("thinkingConflict", { value: truncate(data.conflict, 60) }));
  if (data.episodes && data.episodes.length > 0) {
    items.push(t("thinkingEpisodes", { count: data.episodes.length }));
  }

  if (items.length === 0) return null;

  return (
    <div className="w-full rounded-lg border border-border/50 bg-muted/30 px-4 py-3">
      <div className="space-y-1">
        {items.map((item, i) => (
          <p key={i} className="text-xs text-muted-foreground/70 truncate">
            {item}
          </p>
        ))}
      </div>
    </div>
  );
}

function truncate(str: string, len: number): string {
  return str.length > len ? str.slice(0, len) + "..." : str;
}

// ─── Editable Field ─────────────────────────────────────

function EditableField({
  label,
  value,
  onChange,
  placeholder,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <Field orientation="horizontal" className="items-start">
      <FieldLabel className="w-20 shrink-0 pt-1 text-sm font-medium text-muted-foreground">
        {label}
      </FieldLabel>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={2}
          className="flex-1 resize-none bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground/40"
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground/40"
        />
      )}
    </Field>
  );
}
