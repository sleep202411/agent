import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { useIsFocused } from "expo-router";
import { uuid } from "expo-modules-core";
import { getDocumentAsync } from "expo-document-picker";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useScreenActive } from "@/hooks/use-app-active";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { useTranslations } from "@/i18n";
import { invalidateBrowse } from "@/data/browse-refresh";
import { ApiRequestError } from "@/lib/api-client";
import { fetchAuthorEpisodes, type EpisodeSnapshot } from "./episodes-api";
import { createEpisodeUploadCheckpoint, uploadEpisodeVideo } from "./episode-upload";
import { episodeVideoSource } from "./episode-video-source";
import { probeEpisodeVideoDuration } from "./episode-video-duration";
import {
  associateEpisodeVideo,
  cancelEpisodeVideo,
  createAuthorEpisode,
  episodeCreateCommand,
  episodeCreationStorage,
  type EpisodeCreationDraft,
} from "./episode-create-api";
type Props = { ipId: string; userId: string; generation: number };
export function IpEpisodeCreatePanel(props: Props) {
  const focused = useIsFocused();
  return focused && getAuthGeneration() === props.generation ? (
    <Session key={JSON.stringify(props)} {...props} />
  ) : null;
}
function Session({ ipId, userId, generation }: Props) {
  const active = useScreenActive();
  const t = useTranslations(),
    theme = useTheme(),
    op = useAuthFormOperation(ipId, true);
  const [storage] = useState(() => episodeCreationStorage(ipId, userId, generation));
  const [initial] = useState(() => {
    try {
      return { draft: storage.read() ?? storage.empty(uuid.v4()), error: "" };
    } catch (e) {
      return { draft: null, error: String(e) };
    }
  });
  const [draft, setDraft] = useState(initial.draft),
    [snapshot, setSnapshot] = useState<EpisodeSnapshot>();
  const [error, setError] = useState(initial.error),
    [saved, setSaved] = useState(false),
    [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<number>(),
    [reviewed, setReviewed] = useState(false),
    [discarding, setDiscarding] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    void fetchAuthorEpisodes(ipId, generation, c.signal)
      .then((value) => {
        if (!c.signal.aborted) setSnapshot(value);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(String(e.message ?? e));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => controller.current?.abort();
  }, [ipId, generation]);
  const ensure = (signal: AbortSignal) => {
    signal.throwIfAborted();
    if (generation !== getAuthGeneration()) throw new Error("Episode creation session expired.");
  };
  const persist = (value: EpisodeCreationDraft) => {
    try {
      storage.save(value);
      setDraft(value);
    } catch (e) {
      setStorageFailed(true);
      throw e;
    }
  };
  const run = <T,>(work: (signal: AbortSignal) => Promise<T>, success: (value: T) => void) => {
    if (!active) return;
    setError("");
    setSaved(false);
    void op.run(
      async () => {
        controller.current?.abort();
        const c = new AbortController();
        controller.current = c;
        const result = await work(c.signal);
        ensure(c.signal);
        return result;
      },
      success,
      (e) => {
        setProgress(undefined);
        setError(String(e instanceof Error ? e.message : e));
        if (e instanceof ApiRequestError && [401, 403, 404].includes(e.status))
          setSnapshot(undefined);
      }
    );
  };
  const refresh = () =>
    run(
      (signal) => fetchAuthorEpisodes(ipId, generation, signal),
      (value) => {
        setSnapshot(value);
        setReviewed(!!draft?.command);
      }
    );
  const pick = () => {
    if (!draft) return;
    run(
      async (signal) => {
        const selected = await getDocumentAsync({
          type: ["video/mp4", "video/quicktime", "video/webm"],
          multiple: false,
          copyToCacheDirectory: true,
          base64: false,
        });
        ensure(signal);
        if (selected.canceled) return;
        const source = episodeVideoSource(selected.assets[0]);
        const duration =
          draft.duration.trim() || draft.checkpoint
            ? draft.duration
            : String((await probeEpisodeVideoDuration(selected.assets[0], signal)) ?? "");
        ensure(signal);
        let next = {
          ...draft,
          duration,
          checkpoint:
            draft.checkpoint ??
            createEpisodeUploadCheckpoint(draft.clientKey, ipId, userId, source),
        };
        const result = await uploadEpisodeVideo(source, {
          ipId,
          userId,
          generation,
          checkpoint: next.checkpoint,
          signal,
          persist: async (checkpoint) => {
            ensure(signal);
            next = { ...next, checkpoint };
            persist(next);
          },
          onProgress: (value) => {
            ensure(signal);
            setProgress(value);
          },
        });
        ensure(signal);
        persist({
          ...next,
          media: { mediaAssetId: result.mediaAssetId, storageKey: result.storageKey },
        });
      },
      () => setProgress(undefined)
    );
  };
  const submit = () => {
    if (!draft?.media) return;
    run(
      async (signal) => {
        let next = draft;
        if (!next.command) {
          const latest = await fetchAuthorEpisodes(ipId, generation, signal);
          ensure(signal);
          next = {
            ...next,
            command: episodeCreateCommand.parse({
              expectedVersion: latest.version,
              sourceLocale: latest.sourceLocale,
              data: {
                title: next.title,
                summary: next.summary,
                durationSeconds: next.duration.trim() ? Number(next.duration) : null,
                isFreePreview: next.isFreePreview,
                mediaAssetId: next.media!.mediaAssetId,
              },
            }),
          };
          persist(next);
          setReviewed(false);
        }
        await associateEpisodeVideo(ipId, generation, next.media!, signal);
        const result = await createAuthorEpisode(ipId, generation, next.command!, signal);
        ensure(signal);
        storage.clear(next.clientKey);
        return result;
      },
      (value) => {
        setSnapshot(value);
        setDraft(storage.empty(uuid.v4()));
        setSaved(true);
        setReviewed(false);
        invalidateBrowse();
      }
    );
  };
  const frozen = op.busy || loading || !snapshot || !!initial.error || storageFailed;
  const fieldsFrozen = frozen || !!draft?.command;
  const valid =
    !!draft?.media &&
    episodeCreateCommand.shape.data.safeParse({
      title: draft.title,
      summary: draft.summary,
      durationSeconds: draft.duration.trim() ? Number(draft.duration) : null,
      isFreePreview: draft.isFreePreview,
      mediaAssetId: draft.media.mediaAssetId,
    }).success;
  if (!active) return null;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      {(loading || op.busy) && <ActivityIndicator />}
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {saved && <ThemedText>{t("ipEpisodeCreate.saved")}</ThemedText>}
      {<Button label={t("thread.refresh")} onPress={refresh} disabled={op.busy || loading} />}
      {draft && snapshot && (
        <>
          <ThemedText>
            {t("ipAuthor.source")}: {snapshot.sourceLocale}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t("ipEpisodeCreate.help")}
          </ThemedText>
          {(["title", "summary", "duration"] as const).map((field) => (
            <View key={field}>
              <ThemedText>{t(`ipEpisodes.${field}`)}</ThemedText>
              <TextInput
                accessibilityLabel={t(`ipEpisodes.${field}`)}
                value={draft[field]}
                editable={!fieldsFrozen}
                multiline={field === "summary"}
                keyboardType={field === "duration" ? "numeric" : "default"}
                maxLength={field === "title" ? 80 : field === "summary" ? 800 : 5}
                style={{
                  padding: 12,
                  color: theme.text,
                  backgroundColor: theme.backgroundElement,
                  borderRadius: 8,
                }}
                onChangeText={(value) => {
                  try {
                    persist({ ...draft, [field]: value });
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              />
            </View>
          ))}
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: draft.isFreePreview, disabled: fieldsFrozen }}
            disabled={fieldsFrozen}
            onPress={() => {
              try {
                persist({ ...draft, isFreePreview: !draft.isFreePreview });
              } catch (e) {
                setError(String(e));
              }
            }}
            style={{ padding: 12 }}
          >
            <ThemedText>
              {draft.isFreePreview ? "☑ " : "☐ "}
              {t("ipEpisodes.freePreview")}
            </ThemedText>
          </Pressable>
          {draft.checkpoint && <ThemedText>{draft.checkpoint.fileName}</ThemedText>}
          {draft.media ? (
            <ThemedText>{t("ipEpisodeCreate.videoReady")}</ThemedText>
          ) : (
            <Button
              label={t(draft.checkpoint ? "ipEpisodeCreate.resume" : "ipEpisodeCreate.pick")}
              onPress={pick}
              disabled={fieldsFrozen}
            />
          )}
          {progress !== undefined && (
            <>
              <ThemedText>
                {t("ipEpisodeCreate.progress").replace("{percent}", String(progress))}
              </ThemedText>
              {
                <Button
                  label={t("ipEpisodeCreate.pause")}
                  onPress={() => controller.current?.abort()}
                  disabled={false}
                />
              }
            </>
          )}
          {draft.command ? (
            <>
              <ThemedText>{t("ipEpisodeCreate.pending")}</ThemedText>
              {<Button label={t("common.retry")} onPress={submit} disabled={frozen} />}
              {reviewed && (
                <Button
                  label={t("ipEpisodeCreate.resolve")}
                  onPress={() => setDiscarding(true)}
                  disabled={frozen}
                />
              )}
            </>
          ) : (
            <Button
              label={t("ipEpisodeCreate.create")}
              onPress={submit}
              disabled={frozen || !valid}
            />
          )}
          {!draft.command && (
            <Button
              label={t("ipEpisodeCreate.discard")}
              onPress={() => setDiscarding(true)}
              disabled={frozen}
            />
          )}
          {discarding && (
            <View style={{ gap: 8 }}>
              <ThemedText>
                {t(
                  draft.command
                    ? "ipEpisodeCreate.resolveConfirm"
                    : "ipEpisodeCreate.discardConfirm"
                )}
              </ThemedText>
              {
                <Button
                  label={t("ipEpisodeCreate.confirmDiscard")}
                  onPress={() =>
                    run(
                      async (signal) => {
                        if (!draft.command)
                          await cancelEpisodeVideo(ipId, generation, draft, signal);
                        ensure(signal);
                        storage.clear(draft.clientKey);
                      },
                      () => {
                        setDraft(storage.empty(uuid.v4()));
                        setDiscarding(false);
                        setReviewed(false);
                      }
                    )
                  }
                  disabled={frozen}
                />
              }
              {
                <Button
                  label={t("common.cancel")}
                  onPress={() => setDiscarding(false)}
                  disabled={frozen}
                />
              }
            </View>
          )}
          {draft.command && reviewed && (
            <View style={{ gap: 8 }}>
              <ThemedText type="smallBold">{t("ipEpisodes.heading")}</ThemedText>
              {!snapshot.episodes.length && <ThemedText>{t("ipEpisodes.empty")}</ThemedText>}
              {snapshot.episodes.map((item) => (
                <View key={item.id}>
                  <ThemedText>
                    {item.episodeNo}. {item.title}
                  </ThemedText>
                  <ThemedText>{item.summary}</ThemedText>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

function Button({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{ padding: 12, opacity: disabled ? 0.5 : 1 }}
    >
      <ThemedText>{label}</ThemedText>
    </Pressable>
  );
}
