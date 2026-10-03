import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { useIsFocused } from "expo-router";
import { Image } from "expo-image";
import { uuid } from "expo-modules-core";
import { getDocumentAsync } from "expo-document-picker";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { useScreenActive } from "@/hooks/use-app-active";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { api, ApiRequestError } from "@/lib/api-client";
import { invalidateBrowse } from "@/data/browse-refresh";
import { ConversationVideo } from "@/features/services/conversation-video";
import { pickIpMedia } from "./media-api";
import { createEpisodeUploadCheckpoint, uploadEpisodeVideo } from "./episode-upload";
import { episodeVideoSource } from "./episode-video-source";
import { probeEpisodeVideoDuration } from "./episode-video-duration";
import type { EpisodeSnapshot } from "./episodes-api";
import {
  episodeMediaKey,
  episodeMediaVersion,
  episodeMediaRecord,
  fetchEpisodeMedia,
  finishEpisodeMedia,
  rebaseEpisodeMedia,
  type PendingEpisodeMedia,
} from "./episode-media-api";
type Props = { ipId: string; episodeId: string; userId: string; generation: number };
export function IpEpisodeMediaPanel(props: Props) {
  const focused = useIsFocused();
  return focused && getAuthGeneration() === props.generation ? (
    <Session key={JSON.stringify(props)} {...props} />
  ) : null;
}
function Button({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
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
function Session({ ipId, episodeId, userId, generation }: Props) {
  const active = useScreenActive();
  const t = useTranslations(),
    op = useAuthFormOperation(`${ipId}:${episodeId}`, true);
  const [record] = useState(() => episodeMediaRecord(ipId, episodeId, userId, generation));
  const [initial] = useState(() => {
    try {
      return { pending: record.read(), error: "" };
    } catch (e) {
      return { pending: null, error: String(e) };
    }
  });
  const [pending, setPending] = useState<PendingEpisodeMedia | null>(initial.pending),
    [snapshot, setSnapshot] = useState<EpisodeSnapshot>();
  const [error, setError] = useState(initial.error),
    [loading, setLoading] = useState(true),
    [saved, setSaved] = useState(false),
    [preview, setPreview] = useState(false),
    [progress, setProgress] = useState<number>();
  const [removing, setRemoving] = useState(false),
    [canceling, setCanceling] = useState(false),
    [storageFailed, setStorageFailed] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    void fetchEpisodeMedia(ipId, episodeId, generation, c.signal)
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
  }, [ipId, episodeId, generation]);
  const ensure = (signal: AbortSignal) => {
    signal.throwIfAborted();
    if (generation !== getAuthGeneration()) throw new Error("Episode media session expired.");
  };
  const save = (value: PendingEpisodeMedia) => {
    try {
      record.save(value);
      setPending(value);
    } catch (e) {
      setStorageFailed(true);
      throw e;
    }
  };
  const run = <T,>(request: (signal: AbortSignal) => Promise<T>, success: (value: T) => void) => {
    if (!active) return;
    setError("");
    setSaved(false);
    setPreview(false);
    void op.run(
      async () => {
        controller.current?.abort();
        const c = new AbortController();
        controller.current = c;
        const value = await request(c.signal);
        ensure(c.signal);
        return value;
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
  const done = (value: EpisodeSnapshot | null) => {
    setProgress(undefined);
    if (value) {
      setSnapshot(value);
      setPending(null);
      setCanceling(false);
      setSaved(true);
      setRemoving(false);
      invalidateBrowse();
    }
  };
  const finish = async (value: PendingEpisodeMedia, signal: AbortSignal) => {
    const result = await finishEpisodeMedia(value, generation, signal, save);
    ensure(signal);
    record.clear(episodeMediaKey(value));
    return result;
  };
  const cover = () => {
    if (!snapshot || pending) return;
    run(async (signal) => {
      const upload = await pickIpMedia(
        ipId,
        "cover",
        snapshot.version,
        generation,
        signal,
        (value) => save({ slot: "cover", upload: value }),
        episodeId
      );
      return upload ? finish({ slot: "cover", upload }, signal) : null;
    }, done);
  };
  const source = () => {
    if (!snapshot || (pending && pending.slot !== "source")) return;
    run(async (signal) => {
      const picked = await getDocumentAsync({
        type: ["video/mp4", "video/quicktime", "video/webm"],
        multiple: false,
        copyToCacheDirectory: true,
        base64: false,
      });
      ensure(signal);
      if (picked.canceled) return null;
      await fetchEpisodeMedia(ipId, episodeId, generation, signal);
      ensure(signal);
      const file = episodeVideoSource(picked.assets[0]);
      const durationSeconds =
        pending?.slot === "source"
          ? pending.durationSeconds
          : await probeEpisodeVideoDuration(picked.assets[0], signal);
      ensure(signal);
      let next: Extract<PendingEpisodeMedia, { slot: "source" }> =
        pending?.slot === "source"
          ? pending
          : {
              slot: "source",
              durationSeconds,
              ipId,
              episodeId,
              expectedVersion: snapshot.version,
              checkpoint: createEpisodeUploadCheckpoint(uuid.v4(), ipId, userId, file),
            };
      const result = await uploadEpisodeVideo(file, {
        ipId,
        userId,
        generation,
        checkpoint: next.checkpoint,
        signal,
        persist: async (checkpoint) => {
          ensure(signal);
          next = { ...next, checkpoint };
          save(next);
        },
        onProgress: (value) => {
          ensure(signal);
          setProgress(value);
        },
      });
      ensure(signal);
      next = {
        ...next,
        media: { mediaAssetId: result.mediaAssetId, storageKey: result.storageKey },
      };
      save(next);
      return finish(next, signal);
    }, done);
  };
  const resume = (rebase = false) => {
    if (!pending || !snapshot) return;
    run(async (signal) => {
      const next = rebase ? rebaseEpisodeMedia(pending, snapshot.version) : pending;
      save(next);
      return finish(next, signal);
    }, done);
  };
  const refresh = () =>
    run(
      (signal) => fetchEpisodeMedia(ipId, episodeId, generation, signal),
      (value) => setSnapshot(value)
    );
  const item = snapshot?.episodes.find((value) => value.id === episodeId),
    frozen = op.busy || loading || !!initial.error || storageFailed || !item;
  if (!active) return null;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      {(loading || op.busy) && <ActivityIndicator />}
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {saved && <ThemedText>{t("ipMedia.saved")}</ThemedText>}
      <Button label={t("thread.refresh")} onPress={refresh} disabled={loading || op.busy} />
      {item && (
        <>
          <ThemedText type="smallBold">
            {item.episodeNo}. {item.title}
          </ThemedText>
          <ThemedText type="smallBold">{t("ipMedia.cover")}</ThemedText>
          {item.coverAsset?.url ? (
            <Image
              source={{ uri: item.coverAsset.url }}
              contentFit="contain"
              style={{ width: "100%", height: 200 }}
            />
          ) : (
            <ThemedText>{t(item.coverAsset ? "ipMedia.processing" : "ipMedia.empty")}</ThemedText>
          )}
          <ThemedText>{t("ipEpisodeMedia.coverHint")}</ThemedText>
          <Button label={t("ipMedia.uploadCover")} onPress={cover} disabled={frozen || !!pending} />
          {!!item.coverAsset && (
            <Button
              label={t("ipEpisodeMedia.removeCover")}
              onPress={() => setRemoving(true)}
              disabled={frozen || !!pending}
            />
          )}
          {removing && (
            <View>
              <ThemedText>{t("ipEpisodeMedia.removeConfirm")}</ThemedText>
              <Button
                label={t("ipEpisodeCreate.confirmDiscard")}
                disabled={frozen || !!pending}
                onPress={() =>
                  run(async (signal) => {
                    const value: PendingEpisodeMedia = {
                      slot: "removeCover",
                      ipId,
                      episodeId,
                      clientKey: uuid.v4(),
                      expectedVersion: snapshot!.version,
                    };
                    save(value);
                    return finish(value, signal);
                  }, done)
                }
              />
              <Button
                label={t("common.cancel")}
                disabled={frozen}
                onPress={() => setRemoving(false)}
              />
            </View>
          )}
          <ThemedText type="smallBold">{t("ipEpisodeMedia.source")}</ThemedText>
          {item.mediaAsset?.url ? (
            preview ? (
              <View style={{ height: 220 }}>
                <ConversationVideo url={item.mediaAsset.url} onRetry={() => setPreview(false)} />
              </View>
            ) : (
              <Button label={t("ipEpisodes.preview")} onPress={() => setPreview(true)} />
            )
          ) : (
            <ThemedText>{t(item.mediaAsset ? "ipMedia.processing" : "ipMedia.empty")}</ThemedText>
          )}
          <ThemedText>{t("ipEpisodeMedia.sourceHint")}</ThemedText>
          <ThemedText>{t("ipEpisodeMedia.durationHint")}</ThemedText>
          <Button
            label={t("ipEpisodeMedia.replaceSource")}
            onPress={source}
            disabled={frozen || !!pending}
          />
          {progress !== undefined && (
            <>
              <ThemedText>
                {t("ipEpisodeCreate.progress").replace("{percent}", String(progress))}
              </ThemedText>
              <Button
                label={t("ipEpisodeCreate.pause")}
                onPress={() => controller.current?.abort()}
              />
            </>
          )}
          {pending && (
            <View style={{ gap: 8 }}>
              <ThemedText>{t("ipEpisodeMedia.pending")}</ThemedText>
              {pending.slot !== "removeCover" && (
                <ThemedText>
                  {pending.slot === "cover" ? pending.upload.fileName : pending.checkpoint.fileName}
                </ThemedText>
              )}
              {pending.slot === "source" && !pending.media ? (
                <>
                  <Button label={t("ipEpisodeCreate.resume")} onPress={source} disabled={frozen} />
                  <Button
                    label={t("ipEpisodeMedia.cancelUpload")}
                    onPress={() => setCanceling(true)}
                    disabled={frozen}
                  />
                </>
              ) : (
                <>
                  <Button label={t("common.retry")} onPress={() => resume()} disabled={frozen} />
                  {snapshot!.version !== episodeMediaVersion(pending) && (
                    <>
                      <ThemedText>{t("ipMedia.changed")}</ThemedText>
                      <Button
                        label={t(
                          pending.slot === "removeCover"
                            ? "ipEpisodeMedia.applyRemoval"
                            : "ipMedia.applyUploaded"
                        )}
                        onPress={() => resume(true)}
                        disabled={frozen}
                      />
                    </>
                  )}
                </>
              )}
              {canceling && pending.slot === "source" && !pending.media && (
                <View>
                  <ThemedText>{t("ipEpisodeMedia.cancelConfirm")}</ThemedText>
                  <Button
                    label={t("ipEpisodeCreate.confirmDiscard")}
                    disabled={frozen}
                    onPress={() =>
                      run(
                        async (signal) => {
                          await api.delete(`/media/episode-uploads/${pending.checkpoint.id}`, {
                            service: "aurora",
                            signal,
                            retry: false,
                            timeout: 180000,
                          });
                          ensure(signal);
                          record.clear(episodeMediaKey(pending));
                        },
                        () => {
                          setPending(null);
                          setCanceling(false);
                        }
                      )
                    }
                  />
                  <Button
                    label={t("common.cancel")}
                    onPress={() => setCanceling(false)}
                    disabled={frozen}
                  />
                </View>
              )}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}
