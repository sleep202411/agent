import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { useIsFocused } from "expo-router";
import { Image } from "expo-image";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { useScreenActive } from "@/hooks/use-app-active";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { ApiRequestError } from "@/lib/api-client";
import { invalidateBrowse } from "@/data/browse-refresh";
import { ConversationVideo } from "@/features/services/conversation-video";
import {
  fetchIpMedia,
  pickIpMedia,
  finishIpMedia,
  mediaUploadRecord,
  type MediaCheckpoint,
  type MediaSlot,
  type MediaSnapshot,
} from "./media-api";
type Props = { ipId: string; userId: string; generation: number };
export function IpMediaPanel(props: Props) {
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
function Session({ ipId, userId, generation }: Props) {
  const active = useScreenActive();
  const t = useTranslations(),
    op = useAuthFormOperation(ipId, true);
  const [record] = useState(() => mediaUploadRecord(ipId, userId, generation));
  const [initial] = useState(() => {
    try {
      return { pending: record.read(), error: "" };
    } catch (e) {
      return { pending: null, error: String(e) };
    }
  });
  const [pending, setPending] = useState<MediaCheckpoint | null>(initial.pending);
  const [snapshot, setSnapshot] = useState<MediaSnapshot>();
  const [error, setError] = useState(initial.error),
    [loading, setLoading] = useState(true),
    [saved, setSaved] = useState(false),
    [preview, setPreview] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    controller.current = c;
    void fetchIpMedia(ipId, generation, c.signal)
      .then((value) => {
        if (!c.signal.aborted) setSnapshot(value);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(String(e.message ?? e));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [ipId, generation]);
  const failure = (e: unknown) => {
    setError(String(e instanceof Error ? e.message : e));
    if (e instanceof ApiRequestError && [401, 403, 404].includes(e.status)) {
      setSnapshot(undefined);
      setPreview(false);
    }
  };
  const save = (value: MediaCheckpoint) => {
    record.save(value);
    setPending(value);
  };
  const refresh = () => {
    const signal = controller.current?.signal;
    if (!active || !signal) return;
    void op.run(
      () => fetchIpMedia(ipId, generation, signal),
      (value) => {
        setSnapshot(value);
        setError(initial.error);
        setPreview(false);
      },
      failure
    );
  };
  const upload = (slot: MediaSlot) => {
    const signal = controller.current?.signal;
    if (!active || !snapshot || pending || initial.error || !signal) return;
    setError("");
    setSaved(false);
    setPreview(false);
    void op.run(
      async () => {
        const checkpoint = await pickIpMedia(
          ipId,
          slot,
          snapshot.version,
          generation,
          signal,
          save
        );
        if (!checkpoint) return null;
        const result = await finishIpMedia(checkpoint, generation, signal, save);
        record.clear(checkpoint.clientKey);
        return result;
      },
      (result) => {
        if (result) {
          setSnapshot(result);
          setPending(null);
          setSaved(true);
          invalidateBrowse();
        }
      },
      failure
    );
  };
  const resume = (rebase = false) => {
    const signal = controller.current?.signal;
    if (!active || !pending || !snapshot || !signal) return;
    setError("");
    setSaved(false);
    void op.run(
      async () => {
        const checkpoint = rebase ? { ...pending, expectedVersion: snapshot.version } : pending;
        save(checkpoint);
        const result = await finishIpMedia(checkpoint, generation, signal, save);
        record.clear(checkpoint.clientKey);
        return result;
      },
      (result) => {
        setSnapshot(result);
        setPending(null);
        setSaved(true);
        invalidateBrowse();
      },
      failure
    );
  };
  if (!active) return null;
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      {loading && <ActivityIndicator />}
      {op.busy && <ActivityIndicator accessibilityLabel={t("ipMedia.working")} />}
      {!!error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {saved && <ThemedText>{t("ipMedia.saved")}</ThemedText>}
      <Button label={t("thread.refresh")} onPress={refresh} disabled={loading || op.busy} />
      {snapshot && (
        <>
          {(["cover", "trailer"] as const).map((slot) => {
            const asset = slot === "cover" ? snapshot.coverAsset : snapshot.trailerAsset;
            return (
              <View key={slot} style={{ gap: 8 }}>
                <ThemedText type="smallBold">{t(`ipMedia.${slot}`)}</ThemedText>
                {asset?.url ? (
                  slot === "cover" ? (
                    <Image
                      source={{ uri: asset.url }}
                      contentFit="contain"
                      style={{ width: "100%", height: 200 }}
                    />
                  ) : preview ? (
                    <View style={{ height: 220 }}>
                      <ConversationVideo url={asset.url} onRetry={() => setPreview(false)} />
                    </View>
                  ) : (
                    <Button label={t("ipMedia.preview")} onPress={() => setPreview(true)} />
                  )
                ) : (
                  <ThemedText>{t(asset ? "ipMedia.processing" : "ipMedia.empty")}</ThemedText>
                )}
                <ThemedText type="small" themeColor="textSecondary">
                  {t(`ipMedia.${slot}Hint`)}
                </ThemedText>
                <Button
                  label={t(slot === "cover" ? "ipMedia.uploadCover" : "ipMedia.uploadTrailer")}
                  onPress={() => upload(slot)}
                  disabled={op.busy || !!pending || !!initial.error}
                />
              </View>
            );
          })}
          {pending && (
            <View style={{ gap: 8 }}>
              <ThemedText>{t("ipMedia.pending")}</ThemedText>
              <ThemedText>{pending.fileName}</ThemedText>
              <Button
                label={t("common.retry")}
                onPress={() => resume()}
                disabled={op.busy || !!initial.error}
              />
              {snapshot.version !== pending.expectedVersion && (
                <>
                  <ThemedText>{t("ipMedia.changed")}</ThemedText>
                  <Button
                    label={t("ipMedia.applyUploaded")}
                    onPress={() => resume(true)}
                    disabled={op.busy || !!initial.error}
                  />
                </>
              )}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}
