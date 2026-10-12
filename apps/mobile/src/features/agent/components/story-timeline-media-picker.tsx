import { CrewCandidateList } from "./story-crew-candidate-list";
import { resolveCrewCandidate } from "../api/story-crew-candidate-selection";
import { ConversationVideo } from "@/features/services/conversation-video";
import { useScreenActive } from "@/hooks/use-app-active";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, View } from "react-native";
import { Image } from "expo-image";
import { uuid } from "expo-modules-core";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import {
  fetchTimelineCandidates,
  timelineMediaPending,
  type TimelineCandidate,
  type TimelineMediaCommand,
} from "../api/story-timeline-media";
import { timelineUpload, type TimelineUploadCheckpoint } from "../api/story-timeline-upload";
import type { TimelineScope, TimelineInput } from "../api/story-timeline-api";
export function TimelineMediaPicker({
  scope,
  userId,
  sequenceId,
  clip,
  canEdit,
  onDone,
}: {
  scope: TimelineScope;
  userId: string;
  sequenceId: string;
  clip?: TimelineInput["clips"][number];
  canEdit: boolean;
  onDone: () => void;
}) {
  const t = useTranslations(),
    theme = useTheme();
  const active = useScreenActive();
  const crewOperation = useMemo(
    () => ({
      identity: `${scope.projectId}:${scope.chapterId}:${scope.generation}:${active}`,
      controller: new AbortController(),
    }),
    [scope.projectId, scope.chapterId, scope.generation, active]
  );
  useEffect(() => () => crewOperation.controller.abort(), [crewOperation]);
  const [crewOpen, setCrewOpen] = useState(false);
  const [preview, setPreview] = useState<string>();
  const store = useMemo(() => timelineMediaPending(scope, userId), [scope, userId]);
  const uploads = useMemo(() => timelineUpload(scope, userId), [scope, userId]);
  const uploadAbort = useRef<AbortController | null>(null);
  useEffect(() => () => uploadAbort.current?.abort(), [uploads, active]);
  const [uploadPending, setUploadPending] = useState<TimelineUploadCheckpoint | null>(null);
  const op = useAuthFormOperation(
    `${crewOperation.identity}:${sequenceId}:${clip?.id ?? "recovery"}`,
    active
  );
  const [items, setItems] = useState<TimelineCandidate[]>([]),
    [pending, setPending] = useState<TimelineMediaCommand | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string>(),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    void Promise.resolve()
      .then(async () => {
        const saved = store.read();
        const upload = uploads.read();
        if (!c.signal.aborted) setUploadPending(upload ?? null);
        if (!c.signal.aborted) setPending(saved ?? null);
        return fetchTimelineCandidates(scope, c.signal);
      })
      .then(
        (value) => {
          if (!c.signal.aborted) setItems(value);
        },
        (cause) => {
          if (!c.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
        }
      )
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [scope, store, uploads, revision]);
  const submit = (candidate?: TimelineCandidate, crewId?: string) => {
    if (!canEdit || !active || (crewId && (loading || uploadPending))) return;
    void op.run(
      async () => {
        setError(undefined);
        let command = pending;
        if (!command && crewId) {
          candidate = await resolveCrewCandidate(
            scope,
            userId,
            crewId,
            ["image", "video"],
            uuid.v4(),
            crewOperation.controller.signal
          );
          crewOperation.controller.signal.throwIfAborted();
        }
        if (!command) {
          if (!clip?.id || !candidate || !["image", "video"].includes(candidate.asset.kind))
            throw Error("Select a saved clip and project image or video.");
          const prompt = clip.imagePrompt ?? clip.videoPrompt;
          command = {
            clientKey: uuid.v4(),
            sequenceId,
            clipId: clip.id,
            input: {
              expectedVersion: clip.expectedVersion,
              sourceMediaAssetId: candidate.asset.id,
              kind: candidate.asset.kind as "image" | "video",
              imagePrompt: candidate.asset.kind === "image" ? prompt : null,
              videoPrompt: candidate.asset.kind === "video" ? prompt : null,
            },
          };
        }
        store.save(command);
        setPending(command);
        setError(undefined);
        return store.submit(command);
      },
      () => {
        setPending(null);
        onDone();
      },
      (cause) => setError(cause instanceof Error ? cause.message : String(cause))
    );
  };
  const upload = () => {
    if (!canEdit || pending) return;
    void op.run(
      async () => {
        const controller = new AbortController();
        uploadAbort.current = controller;
        setError(undefined);
        return uploads.read() ? uploads.resume(controller.signal) : uploads.pick(controller.signal);
      },
      (candidate) => {
        setUploadPending(null);
        if (candidate)
          setItems((values) => [
            candidate,
            ...values.filter((v) => v.asset.id !== candidate.asset.id),
          ]);
      },
      (cause) => {
        try {
          setUploadPending(uploads.read() ?? null);
        } catch {
          /* Preserve the original failure. */
        }
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
  };
  const button = (label: string, onPress: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || op.busy || !active}
      onPress={onPress}
      style={{ paddingVertical: 12, opacity: disabled || op.busy ? 0.5 : 1 }}
    >
      <ThemedText type="smallBold" style={{ color: theme.brand }}>
        {label}
      </ThemedText>
    </Pressable>
  );
  return (
    <View style={{ gap: 12 }}>
      <ThemedText type="smallBold">{t("timeline.replaceMedia")}</ThemedText>
      <ThemedText>{t("timeline.replaceHelp")}</ThemedText>
      {(loading || op.busy) && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {pending ? (
        <>
          <ThemedText>{t("timeline.pendingHelp")}</ThemedText>
          {button(t("timeline.retry"), () => submit(), !canEdit)}
          {button(t("timeline.clear"), () =>
            Alert.alert(t("timeline.clear"), t("timeline.clearHelp"), [
              { text: t("common.cancel"), style: "cancel" },
              {
                text: t("timeline.clear"),
                style: "destructive",
                onPress: () => {
                  try {
                    store.clear(pending.clientKey);
                    onDone();
                  } catch (cause) {
                    setError(String(cause));
                  }
                },
              },
            ])
          )}
        </>
      ) : (
        <>
          {uploadPending && (
            <ThemedText>
              {t("timeline.uploadRecovery")}: {uploadPending.name}
            </ThemedText>
          )}
          <Pressable
            accessibilityRole="button"
            disabled={!canEdit || loading || op.busy}
            onPress={upload}
            style={{ paddingVertical: 12, opacity: !canEdit || loading || op.busy ? 0.5 : 1 }}
          >
            <ThemedText type="smallBold" style={{ color: theme.brand }}>
              {t(uploadPending ? "timeline.retryUpload" : "timeline.uploadMedia")}
            </ThemedText>
          </Pressable>
          <ThemedText type="small">{t("timeline.uploadMediaHelp")}</ThemedText>
          {uploadPending &&
            button(t("timeline.clearUpload"), () =>
              Alert.alert(t("timeline.clearUpload"), t("timeline.clearUploadHelp"), [
                { text: t("common.cancel"), style: "cancel" },
                {
                  text: t("timeline.clearUpload"),
                  style: "destructive",
                  onPress: () => {
                    try {
                      uploads.clear(uploadPending.clientKey);
                      setUploadPending(null);
                    } catch (cause) {
                      setError(String(cause));
                    }
                  },
                },
              ])
            )}
          {canEdit &&
            button(
              t(crewOpen ? "storyCandidates.hideCrew" : "storyCandidates.importCrew"),
              () => setCrewOpen((value) => !value),
              loading || !!uploadPending
            )}
          {crewOpen && active && canEdit && (
            <CrewCandidateList
              key={`${scope.projectId}:${scope.generation}`}
              scope={scope}
              filter="visual"
              savedIds={[]}
              disabled={loading || op.busy || !clip?.id || !!uploadPending}
              add={(id) => submit(undefined, id)}
              selectionLabel={t("timeline.useMedia")}
            />
          )}
          {!loading && !items.length && <ThemedText>{t("timeline.noProjectMedia")}</ThemedText>}
          {items.map((item) => (
            <View
              key={item.asset.id}
              style={{
                padding: 12,
                backgroundColor: theme.backgroundElement,
                borderRadius: 8,
                gap: 8,
              }}
            >
              {item.asset.kind === "image" && /^https?:\/\//.test(item.asset.previewUrl ?? "") && (
                <Image
                  source={{ uri: item.asset.previewUrl! }}
                  style={{ height: 140, width: "100%" }}
                  contentFit="contain"
                />
              )}
              {item.asset.kind === "video" && /^https?:\/\//.test(item.asset.previewUrl ?? "") && (
                <>
                  {button(t("timeline.previewMedia"), () => setPreview(item.asset.id))}
                  {active && preview === item.asset.id && (
                    <View style={{ height: 200 }}>
                      <ConversationVideo
                        url={item.asset.previewUrl!}
                        onRetry={() => setPreview(undefined)}
                      />
                    </View>
                  )}
                </>
              )}
              <ThemedText type="small">
                {item.asset.kind} · {item.asset.contentType}
              </ThemedText>
              {button(
                t("timeline.useMedia"),
                () => submit(item),
                !canEdit || loading || !clip?.id || !!uploadPending
              )}
            </View>
          ))}
          {button(
            t("timeline.refresh"),
            () => {
              setItems([]);
              setError(undefined);
              setLoading(true);
              setRevision((n) => n + 1);
            },
            loading
          )}
          {button(t("timeline.close"), onDone)}
        </>
      )}
    </View>
  );
}
