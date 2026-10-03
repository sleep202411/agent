import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTranslations } from "@/i18n";
import { durableRecord } from "@/lib/durable-record";
import { timelineUpload } from "../api/story-timeline-upload";
import { timelinePlaybackClips } from "../api/story-timeline-playback";
import type { TimelineScope, TimelineSequence } from "../api/story-timeline-api";
import { createTimelineEncoder } from "../lib/story-timeline-encoder";
import type { TimelineExportResult } from "../lib/story-timeline-export-session";

type Props = { scope: TimelineScope; userId: string; sequence: TimelineSequence };
function ExportPanel({ scope, userId, sequence }: Props) {
  const t = useTranslations();
  const resource = useRef<{
    encoder: ReturnType<typeof createTimelineEncoder>;
    upload: ReturnType<typeof timelineUpload>;
    operation?: AbortController;
    result?: TimelineExportResult;
  } | null>(null);
  const [recovery] = useState(() => {
    const upload = timelineUpload(
      scope,
      userId,
      durableRecord(
        "story-timeline-export-upload",
        userId,
        `${scope.projectId}:${scope.chapterId}:${sequence.id}`
      )
    );
    try {
      return { upload, pending: Boolean(upload.read()), error: undefined as string | undefined };
    } catch (e) {
      return { upload, pending: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  const [stage, setStage] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | undefined>(recovery.error);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(recovery.pending);
  const clips = timelinePlaybackClips(sequence);
  const shots = clips
    .filter((c) => c.kind === "video" && c.source && c.durationMs > 0)
    .map((c) => ({ id: c.id, kind: "video" as const, url: c.source!, durationMs: c.durationMs }));
  const [omitted, setOmitted] = useState(clips.length - shots.length);
  useEffect(() => {
    const owned = {
      encoder: createTimelineEncoder(),
      upload: recovery.upload,
    } as NonNullable<typeof resource.current>;
    resource.current = owned;
    return () => {
      resource.current = null;
      owned.operation?.abort();
      owned.encoder.dispose();
    };
  }, [recovery]);
  const save = async (downloadOnly = false) => {
    const owned = resource.current;
    if (!owned || owned.operation || getAuthGeneration() !== scope.generation) return;
    const operation = new AbortController();
    owned.operation = operation;
    const current = () =>
      resource.current === owned &&
      owned.operation === operation &&
      !operation.signal.aborted &&
      getAuthGeneration() === scope.generation;
    setError(undefined);
    try {
      if (!downloadOnly && owned.upload.read()) {
        setStage("uploading");
        await owned.upload.resume(operation.signal);
      } else {
        if (!shots.length) throw Error(t("timeline.exportNoVideos"));
        if (!owned.result) {
          setStage("rendering");
          setProgress(0);
          const result = await owned.encoder.render(shots, operation.signal, (ratio) => {
            if (current()) setProgress(ratio);
          });
          if (!current()) {
            owned.encoder.release(result.artifact);
            return;
          }
          owned.result = result;
          setOmitted(clips.length - result.completedClipIds.length);
        }
        if (downloadOnly) {
          setStage("sharing");
          await owned.encoder.share(owned.result.artifact, `timeline-${sequence.id}.mp4`, current);
          if (current()) setStage("idle");
          return;
        }
        setStage("uploading");
        await owned.upload.upload(
          { ...owned.result.artifact, type: "video/mp4", name: `timeline-${sequence.id}.mp4` },
          operation.signal
        );
      }
      if (current()) {
        setStage("saved");
        setSaved(true);
        setPending(false);
      }
    } catch (e) {
      if (current()) {
        setStage("failed");
        setError(e instanceof Error ? e.message : String(e));
        try {
          setPending(Boolean(owned.upload.read()));
        } catch {
          /* Preserve original failure. */
        }
      }
    } finally {
      if (owned.operation === operation) {
        owned.operation = undefined;
        if (resource.current === owned && operation.signal.aborted) {
          setStage("idle");
          try {
            setPending(Boolean(owned.upload.read()));
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }
      }
    }
  };
  const busy =
    stage === "rendering" || stage === "uploading" || stage === "cancelling" || stage === "sharing";
  return (
    <View style={{ gap: 8 }}>
      <ThemedText type="smallBold">{t("timeline.exportTitle")}</ThemedText>
      {omitted > 0 && (
        <ThemedText>{t("timeline.exportOmitted").replace("{count}", String(omitted))}</ThemedText>
      )}
      {stage === "rendering" && (
        <ThemedText>
          {t("timeline.exportRendering").replace("{percent}", String(Math.round(progress * 100)))}
        </ThemedText>
      )}
      {stage === "uploading" && <ThemedText>{t("timeline.exportUploading")}</ThemedText>}
      {saved && <ThemedText>{t("timeline.exportSaved")}</ThemedText>}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {!saved && (
        <Pressable
          accessibilityRole="button"
          disabled={busy || (!pending && !shots.length)}
          style={{ paddingVertical: 12, opacity: busy || (!pending && !shots.length) ? 0.5 : 1 }}
          onPress={() => void save()}
        >
          <ThemedText type="smallBold">
            {t(pending ? "timeline.exportResume" : "timeline.exportSave")}
          </ThemedText>
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={busy || !shots.length}
        style={{ paddingVertical: 12, opacity: busy || !shots.length ? 0.5 : 1 }}
        onPress={() => void save(true)}
      >
        <ThemedText type="smallBold">{t("timeline.exportDownload")}</ThemedText>
      </Pressable>
      {busy && stage !== "sharing" && (
        <Pressable
          accessibilityRole="button"
          style={{ paddingVertical: 12 }}
          onPress={() => {
            const owned = resource.current;
            owned?.operation?.abort();
            // Wait for the cancelled operation to settle before allowing another encoder job.
            setStage("cancelling");
          }}
        >
          <ThemedText>{t("timeline.exportCancel")}</ThemedText>
        </Pressable>
      )}
    </View>
  );
}
export function TimelineExportPanel(props: Props) {
  const active = useScreenActive();
  const identity = JSON.stringify([props.scope, props.userId, props.sequence]);
  return active ? <ExportPanel key={identity} {...props} /> : null;
}
