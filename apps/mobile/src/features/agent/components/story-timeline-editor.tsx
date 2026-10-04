import { TimelineExportPanel } from "./story-timeline-export-panel";
import { TimelineGenerationPanel } from "./story-timeline-generation-panel";
import { TimelinePreview } from "./story-timeline-preview";
import { TimelineMediaPicker } from "./story-timeline-media-picker";
import { timelineMediaPending } from "../api/story-timeline-media";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { uuid } from "expo-modules-core";
import { useAuth } from "@/auth";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { useStoryChapterContext } from "../context/story-chapter-context";
import {
  fetchTimelines,
  timelineDraft,
  reflowTimeline,
  type TimelineInput,
  type TimelineSequence,
  type TimelineScope,
} from "../api/story-timeline-api";
import { timelinePending, type PendingTimeline } from "../api/story-timeline-pending";

function Action({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ paddingVertical: 12, opacity: disabled ? 0.5 : 1 }}
    >
      <ThemedText type="smallBold" style={{ color: theme.brand }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}
export function StoryTimelineEntry() {
  const chapter = useStoryChapterContext(),
    auth = useAuth(),
    t = useTranslations();
  const [open, setOpen] = useState(false);
  const scope = useMemo(
    () => ({
      projectId: chapter.projectId,
      chapterId: chapter.chapterId,
      generation: auth.generation,
    }),
    [chapter.projectId, chapter.chapterId, auth.generation]
  );
  if (chapter.loading || !chapter.chapterId || auth.status !== "authenticated") return null;
  return (
    <>
      <Action label={t("timeline.title")} onPress={() => setOpen(true)} />
      {open && (
        <TimelineEditor
          key={JSON.stringify(scope)}
          scope={scope}
          userId={String(auth.user?.userId ?? auth.user?.id ?? "")}
          canEdit={chapter.capabilities.includes("story.edit")}
          canGenerate={chapter.capabilities.includes("story.generate")}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
export function TimelineEditor({
  scope,
  userId,
  canEdit,
  canGenerate = false,
  initialNodeId,
  onClose,
}: {
  scope: TimelineScope;
  userId: string;
  canEdit: boolean;
  canGenerate?: boolean;
  initialNodeId?: string;
  onClose: () => void;
}) {
  const t = useTranslations(),
    theme = useTheme();
  const store = useMemo(() => timelinePending(scope, userId), [scope, userId]);
  const mediaStore = useMemo(() => timelineMediaPending(scope, userId), [scope, userId]);
  const [generationTarget, setGenerationTarget] = useState<string>();
  const [preview, setPreview] = useState(false);
  const [mediaTarget, setMediaTarget] = useState<{ sequenceId: string; clipId: string }>();
  const op = useAuthFormOperation(`${scope.projectId}:${scope.chapterId}`, true);
  const [rows, setRows] = useState<TimelineSequence[]>([]),
    [draft, setDraft] = useState<TimelineInput>(),
    [selected, setSelected] = useState("");
  const [pending, setPending] = useState<PendingTimeline | null>(null),
    [error, setError] = useState<string>(),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0),
    [dirty, setDirty] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve()
      .then(async () => {
        const saved = store.read();
        const media = mediaStore.read();
        if (!controller.signal.aborted && media)
          setMediaTarget({ sequenceId: media.sequenceId, clipId: media.clipId });
        if (!controller.signal.aborted && saved) {
          setPending(saved);
          setSelected(saved.sequenceId);
          setDraft(saved.input);
        }
        const value = await fetchTimelines(scope, controller.signal);
        return { value, hasPending: !!saved || !!media };
      })
      .then(
        ({ value, hasPending }) => {
          if (controller.signal.aborted) return;
          setRows(value);
          if (initialNodeId && !hasPending) {
            const match = value.find((row) => row.plotNodeId === initialNodeId);
            if (match) {
              setSelected((current) => current || match.id);
              setDraft((current) => current ?? timelineDraft(match));
            }
          }
        },
        (cause) => {
          if (!controller.signal.aborted)
            setError(cause instanceof Error ? cause.message : String(cause));
        }
      )
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [scope, store, mediaStore, revision, initialNodeId]);
  const locked = loading || op.busy || !!pending || !!mediaTarget || !!generationTarget || !canEdit;
  const confirmDiscard = (next: () => void) => {
    if (!dirty) return next();
    Alert.alert(t("timeline.discardTitle"), t("timeline.discardHelp"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("timeline.discard"), style: "destructive", onPress: next },
    ]);
  };
  const update = (clips: TimelineInput["clips"]) => {
    if (!draft || locked) return;
    // Keep incomplete text editable; validate the complete command only on Save.
    let durationMs = 0;
    setDraft({
      ...draft,
      clips: clips.map((clip) => {
        const next = { ...clip, startMs: durationMs };
        durationMs += clip.durationMs;
        return next;
      }),
      durationMs: clips.reduce((n, clip) => n + clip.durationMs, 0),
    });
    setDirty(true);
  };
  const submit = () => {
    if (!canEdit || !draft || !selected) return;
    void op.run(
      async () => {
        const command = pending ?? {
          version: 1 as const,
          sequenceId: selected,
          clientKey: uuid.v4(),
          input: reflowTimeline(draft.expectedVersion, draft.clips),
        };
        store.save(command);
        setPending(command);
        setError(undefined);
        return store.submit(command);
      },
      (value) => {
        setRows((old) => old.map((row) => (row.id === value.id ? value : row)));
        setDraft(timelineDraft(value));
        setPending(null);
        setDirty(false);
      },
      (cause) => setError(cause instanceof Error ? cause.message : String(cause))
    );
  };
  const field = (
    label: string,
    value: string,
    onChangeText: (text: string) => void,
    multiline = false
  ) => (
    <View style={{ gap: 4 }}>
      <ThemedText type="small">{label}</ThemedText>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        editable={!locked}
        multiline={multiline}
        style={{
          padding: 10,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 8,
          color: theme.text,
        }}
      />
    </View>
  );
  return (
    <Modal
      visible
      animationType="slide"
      onRequestClose={() => {
        if (!op.busy) confirmDiscard(onClose);
      }}
    >
      <ScrollView
        contentContainerStyle={{
          padding: 20,
          paddingTop: 48,
          gap: 12,
          backgroundColor: theme.background,
        }}
        style={{ backgroundColor: theme.background }}
      >
        <ThemedText type="smallBold">{t("timeline.title")}</ThemedText>
        <Action
          label={t("timeline.close")}
          disabled={op.busy}
          onPress={() => confirmDiscard(onClose)}
        />
        {loading && <ActivityIndicator />}
        {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
        {!canEdit && <ThemedText>{t("timeline.readOnly")}</ThemedText>}
        {pending && (
          <>
            <ThemedText>{t("timeline.pendingHelp")}</ThemedText>
            <Action label={t("timeline.retry")} disabled={op.busy || !canEdit} onPress={submit} />
            <Action
              label={t("timeline.clear")}
              disabled={op.busy}
              onPress={() =>
                Alert.alert(t("timeline.clear"), t("timeline.clearHelp"), [
                  { text: t("common.cancel"), style: "cancel" },
                  {
                    text: t("timeline.clear"),
                    style: "destructive",
                    onPress: () => {
                      try {
                        store.clear(pending.clientKey);
                        setPending(null);
                        setDraft(undefined);
                        setSelected("");
                        setDirty(false);
                        setLoading(true);
                        setRevision((n) => n + 1);
                      } catch (cause) {
                        setError(String(cause));
                      }
                    },
                  },
                ])
              }
            />
          </>
        )}
        {!loading && !rows.length && !pending && <ThemedText>{t("timeline.empty")}</ThemedText>}
        {!loading && initialNodeId && !rows.some((row) => row.plotNodeId === initialNodeId) ? (
          <ThemedText>{t("storyRepair.noTimeline")}</ThemedText>
        ) : null}
        <Action
          label={t("timeline.refresh")}
          disabled={op.busy || !!pending || !!mediaTarget || !!generationTarget || loading}
          onPress={() =>
            confirmDiscard(() => {
              setDraft(undefined);
              setSelected("");
              setDirty(false);
              setError(undefined);
              setLoading(true);
              setRevision((n) => n + 1);
            })
          }
        />
        {rows.map((row) => (
          <Action
            key={row.id}
            label={row.title || row.plotNodeId}
            disabled={op.busy || !!pending || !!mediaTarget || !!generationTarget}
            onPress={() =>
              confirmDiscard(() => {
                setSelected(row.id);
                setDraft(timelineDraft(row));
                setDirty(false);
              })
            }
          />
        ))}
        {mediaTarget && (
          <TimelineMediaPicker
            scope={scope}
            userId={userId}
            sequenceId={mediaTarget.sequenceId}
            clip={draft?.clips.find((c) => c.id === mediaTarget.clipId)}
            canEdit={canEdit}
            onDone={() => {
              setMediaTarget(undefined);
              setDraft(undefined);
              setSelected("");
              setDirty(false);
              setLoading(true);
              setError(undefined);
              setRevision((n) => n + 1);
            }}
          />
        )}
        {generationTarget && (
          <TimelineGenerationPanel
            key={`${selected}:${generationTarget}`}
            scope={{ ...scope, sequenceId: selected, clipId: generationTarget }}
            userId={userId}
            canGenerate={canGenerate}
            version={draft?.clips.find((c) => c.id === generationTarget)?.expectedVersion ?? 0}
            kind={draft?.clips.find((c) => c.id === generationTarget)?.kind ?? "image"}
            latestId={(() => {
              const latest = rows
                .find((r) => r.id === selected)
                ?.clips.find((c) => c.id === generationTarget)?.latestGeneration;
              return latest &&
                typeof latest === "object" &&
                "id" in latest &&
                typeof latest.id === "string"
                ? latest.id
                : undefined;
            })()}
            onClose={() => {
              setGenerationTarget(undefined);
              setDraft(undefined);
              setSelected("");
              setDirty(false);
              setLoading(true);
              setRevision((n) => n + 1);
            }}
          />
        )}
        {draft && !mediaTarget && !generationTarget && (
          <>
            {!dirty && !pending && !op.busy && rows.find((row) => row.id === selected) && (
              <>
                <Action
                  label={t(preview ? "timeline.hidePreview" : "timeline.showPreview")}
                  onPress={() => setPreview((v) => !v)}
                />
                {preview && <TimelinePreview sequence={rows.find((row) => row.id === selected)!} />}
                {canEdit && (
                  <TimelineExportPanel
                    scope={scope}
                    userId={userId}
                    sequence={rows.find((row) => row.id === selected)!}
                  />
                )}
              </>
            )}

            <ThemedText>
              {t("timeline.durationMs")}: {draft.durationMs}
            </ThemedText>
            {draft.clips.map((clip, index) => (
              <View
                key={clip.id ?? clip.stableKey}
                style={{
                  padding: 12,
                  borderRadius: 8,
                  gap: 8,
                  backgroundColor: theme.backgroundElement,
                }}
              >
                <Action
                  label={t("timeline.generation")}
                  disabled={dirty || !!pending || op.busy || !clip.id}
                  onPress={() => setGenerationTarget(clip.id)}
                />
                <ThemedText>
                  {index + 1} · {clip.kind} · {clip.startMs} ms
                </ThemedText>
                {field(t("timeline.name"), clip.title, (title) =>
                  update(draft.clips.map((c, i) => (i === index ? { ...c, title } : c)))
                )}
                {field(t("timeline.durationMs"), String(clip.durationMs), (text) => {
                  if (/^\d*$/.test(text))
                    update(
                      draft.clips.map((c, i) =>
                        i === index ? { ...c, durationMs: Number(text) } : c
                      )
                    );
                })}
                {field(
                  t("timeline.prompt"),
                  clip.imagePrompt ?? clip.videoPrompt ?? "",
                  (prompt) =>
                    update(
                      draft.clips.map((c, i) =>
                        i !== index
                          ? c
                          : c.kind === "image"
                            ? { ...c, imagePrompt: prompt }
                            : { ...c, videoPrompt: prompt }
                      )
                    ),
                  true
                )}
                {field(
                  t("timeline.description"),
                  clip.description ?? "",
                  (description) =>
                    update(
                      draft.clips.map((c, i) =>
                        i === index ? { ...c, description: description || null } : c
                      )
                    ),
                  true
                )}
                {field(
                  t("timeline.negativePrompt"),
                  clip.negativePrompt ?? "",
                  (negativePrompt) =>
                    update(
                      draft.clips.map((c, i) =>
                        i === index ? { ...c, negativePrompt: negativePrompt || null } : c
                      )
                    ),
                  true
                )}
                <Action
                  label={t("timeline.replaceMedia")}
                  disabled={locked || dirty || !clip.id}
                  onPress={() => setMediaTarget({ sequenceId: selected, clipId: clip.id! })}
                />
                <Action
                  label={t("timeline.toggleKind")}
                  disabled={locked}
                  onPress={() =>
                    update(
                      draft.clips.map((c, i) =>
                        i !== index
                          ? c
                          : c.kind === "image"
                            ? { ...c, kind: "video", videoPrompt: c.imagePrompt, imagePrompt: null }
                            : { ...c, kind: "image", imagePrompt: c.videoPrompt, videoPrompt: null }
                      )
                    )
                  }
                />
                <Action
                  label={t("timeline.up")}
                  disabled={locked || index === 0}
                  onPress={() => {
                    const clips = [...draft.clips];
                    [clips[index - 1], clips[index]] = [clips[index]!, clips[index - 1]!];
                    update(clips);
                  }}
                />
                <Action
                  label={t("timeline.down")}
                  disabled={locked || index === draft.clips.length - 1}
                  onPress={() => {
                    const clips = [...draft.clips];
                    [clips[index + 1], clips[index]] = [clips[index]!, clips[index + 1]!];
                    update(clips);
                  }}
                />
                <Action
                  label={t("timeline.remove")}
                  disabled={locked}
                  onPress={() => update(draft.clips.filter((_, i) => i !== index))}
                />
              </View>
            ))}
            <Action
              label={t("timeline.add")}
              disabled={locked}
              onPress={() =>
                update([
                  ...draft.clips,
                  {
                    expectedVersion: 0,
                    stableKey: `manual_clip_${uuid.v4().replaceAll("-", "").slice(0, 24)}`,
                    title: t("timeline.newClip"),
                    kind: "image",
                    startMs: draft.durationMs,
                    durationMs: 1000,
                    imagePrompt: "",
                    videoPrompt: null,
                    description: null,
                    negativePrompt: null,
                  },
                ])
              }
            />
            <Action label={t("timeline.save")} disabled={locked || !dirty} onPress={submit} />
          </>
        )}
      </ScrollView>
    </Modal>
  );
}
