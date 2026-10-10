"use client";

import { useRef, useState } from "react";
import { useAuth } from "@/app/_components/auth-provider";
import { useLocale, useTranslations } from "next-intl";
import { IconFileUpload, IconLoader2, IconTrash } from "@tabler/icons-react";
import {
  STORY_SUBTITLE_FILE_MAX_BYTES,
  STORY_SUBTITLE_LANGUAGES,
  type StorySubtitleLanguage,
  type StorySubtitleUpload,
} from "@repo/shared/story-subtitles";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { useQuery } from "@tanstack/react-query";
import { ExperienceRuntimePlayer } from "@/components/experience-runtime/experience-runtime-player";
import { getStoryWorkingPreview, storyApiErrorMessage } from "@/lib/story-projects-api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { StoryStoryboardSequence } from "@/lib/story-production-api";

export function StorySequenceSubtitles({
  sequence,
  projectId,
  chapterId,
  disabled,
  editable,
  onPatch,
  onReadingChange,
}: {
  sequence: StoryStoryboardSequence;
  projectId: string;
  chapterId: string;
  disabled: boolean;
  editable: boolean;
  onPatch: (
    input:
      | { subtitleUpload: StorySubtitleUpload }
      | { removeSubtitleLanguage: StorySubtitleLanguage }
  ) => Promise<void>;
  onReadingChange?: (reading: boolean) => void;
}) {
  const t = useTranslations("storyStudio.subtitles");
  const locale = useLocale();
  const { user } = useAuth();
  const [language, setLanguage] = useState<StorySubtitleLanguage>(
    STORY_SUBTITLE_LANGUAGES.find((tag) => tag === locale) ?? "en-US"
  );
  const [previewLanguage, setPreviewLanguage] = useState<StorySubtitleLanguage | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const tracks = sequence.subtitleTracks;
  const timeline = sequence.subtitleTimeline;
  const canUpload = timeline.ready;
  const currentTracks = tracks.filter(
    (track) => timeline.ready && track.timelineFingerprint === timeline.fingerprint
  );
  const previewTrack = currentTracks.find((track) => track.language === previewLanguage);
  const busy = disabled || reading;
  const name = (tag: StorySubtitleLanguage) => t(`languages.${tag}`);
  const preview = useQuery({
    queryKey: [
      "story-studio",
      "node-subtitle-preview",
      projectId,
      chapterId,
      sequence.id,
      user?.id,
      sequence.version,
      timeline.fingerprint,
    ],
    queryFn: () => getStoryWorkingPreview(projectId, chapterId, sequence.plotNodeId),
    enabled: Boolean(previewTrack && user?.id != null),
    retry: false,
  });

  const upload = async (file: File) => {
    if (busy || !editable || !canUpload) return;
    setError(null);
    setReading(true);
    onReadingChange?.(true);
    try {
      const format = file.name.toLowerCase().endsWith(".srt")
        ? "srt"
        : file.name.toLowerCase().endsWith(".vtt")
          ? "vtt"
          : null;
      if (!format) throw new Error(t("invalidFormat"));
      if (file.size > STORY_SUBTITLE_FILE_MAX_BYTES) throw new Error(t("tooLarge"));
      let content: string;
      try {
        content = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      } catch {
        throw new Error(t("encodingError"));
      }
      await onPatch({
        subtitleUpload: {
          language,
          timelineFingerprint: timeline.fingerprint,
          fileName: file.name,
          format,
          content,
        },
      });
      setPreviewLanguage(language);
    } catch (failure) {
      if (!(failure instanceof DOMException && failure.name === "AbortError"))
        setError(failure instanceof Error ? failure.message : t("saveError"));
    } finally {
      setReading(false);
      onReadingChange?.(false);
    }
  };

  return (
    <section className="space-y-4" aria-label={t("title")}>
      {timeline.durationMs !== null ? (
        <p className="text-xs text-white/55">
          {t("duration", { seconds: Number((timeline.durationMs / 1000).toFixed(1)) })}
        </p>
      ) : null}
      {!canUpload ? (
        <p className="rounded-xl bg-white/5 p-4 text-sm text-white/65">{t("timelineRequired")}</p>
      ) : null}
      {editable ? (
        <div className="flex items-end gap-3">
          <div className="min-w-0 flex-1">
            <Field
              dense
              required
              label={t("language")}
              htmlFor={`subtitle-language-${sequence.id}`}
            >
              <Select
                value={language}
                onValueChange={(value) => setLanguage(value as StorySubtitleLanguage)}
                disabled={busy || !canUpload}
              >
                <SelectTrigger
                  id={`subtitle-language-${sequence.id}`}
                  className="w-full"
                  aria-required="true"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STORY_SUBTITLE_LANGUAGES.map((tag) => (
                    <SelectItem key={tag} value={tag}>
                      {name(tag)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept=".srt,.vtt"
            className="hidden"
            tabIndex={-1}
            aria-label={t("upload")}
            disabled={busy || !editable || !canUpload}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void upload(file);
            }}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={busy || !canUpload}
            onClick={() => fileInput.current?.click()}
          >
            {busy ? (
              <IconLoader2 className="size-4 animate-spin" />
            ) : (
              <IconFileUpload className="size-4" />
            )}
            {tracks.some((track) => track.language === language) ? t("replace") : t("upload")}
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {tracks.length === 0 ? (
        <div className="rounded-xl bg-white/[0.035] px-4 py-6 text-center text-sm text-white/45">
          {t("empty")}
        </div>
      ) : (
        <ul className="space-y-2">
          {tracks.map((track) => {
            const stale = !timeline.ready || track.timelineFingerprint !== timeline.fingerprint;
            return (
              <li
                key={track.language}
                className="flex items-center gap-3 rounded-xl bg-white/5 p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{name(track.language)} </p>
                  <p className="truncate text-xs text-white/45" title={track.fileName}>
                    {track.fileName} · {t("cueCount", { count: track.cues.length })}
                  </p>
                  {stale ? <p className="mt-1 text-xs text-destructive">{t("stale")}</p> : null}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={stale}
                  onClick={() => {
                    setPreviewLanguage(previewLanguage === track.language ? null : track.language);
                  }}
                >
                  {previewLanguage === track.language ? t("hidePreview") : t("preview")}
                </Button>
                {editable ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={busy}
                    aria-label={t("remove", { language: name(track.language) })}
                    onClick={() => {
                      setError(null);
                      void onPatch({ removeSubtitleLanguage: track.language }).catch(
                        (failure: unknown) => {
                          if (!(failure instanceof DOMException && failure.name === "AbortError"))
                            setError(failure instanceof Error ? failure.message : t("saveError"));
                        }
                      );
                    }}
                  >
                    <IconTrash className="size-4 text-white/50" />
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {previewTrack ? (
        <div className="space-y-2">
          {preview.isPending ? (
            <p role="status" className="text-sm text-white/55">
              {t("loadingPreview")}
            </p>
          ) : null}
          {preview.error ? (
            <p role="alert" className="text-sm text-destructive">
              {storyApiErrorMessage(preview.error, t("saveError"))}
            </p>
          ) : null}
          {preview.data?.runtime ? (
            <div
              className="relative h-72 overflow-hidden rounded-xl bg-black"
              aria-label={t("videoPreview")}
            >
              <ExperienceRuntimePlayer
                key={`${preview.data.videoSnapshotHash}:${previewLanguage}`}
                runtime={preview.data.runtime}
                locale={locale}
                startSceneId={sequence.plotNodeId}
                initialSubtitleLanguage={previewTrack.language}
                coverUrl={preview.data.coverUrl}
              />
            </div>
          ) : null}
          {preview.data && !preview.data.runtime ? (
            <p role="alert" className="text-sm text-destructive">
              {preview.data.diagnostics.map((item) => item.message).join(" · ") ||
                t("previewUnavailable")}
            </p>
          ) : null}
          <ol
            className="max-h-36 overflow-y-auto rounded-xl bg-black/15 p-2"
            aria-label={t("cuesPreview")}
          >
            {previewTrack.cues.map((cue, index) => (
              <li key={index}>
                <div className="flex w-full gap-3 rounded-lg px-2 py-2 text-left text-xs">
                  <span className="shrink-0 font-mono text-white/40">
                    {(cue.startMs / 1000).toFixed(1)}s
                  </span>
                  <span dir="auto" className="whitespace-pre-line text-white/75">
                    {cue.text}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
