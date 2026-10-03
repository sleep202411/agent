import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, View } from "react-native";
import { Image } from "expo-image";
import { useAuth } from "@/auth";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { useIsFocused } from "expo-router";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import { durableRecord } from "@/lib/durable-record";
import { fetchTimelineCandidates, type TimelineCandidate } from "../api/story-timeline-media";
import { timelineUpload, type TimelineUploadCheckpoint } from "../api/story-timeline-upload";
export function AssetCandidatePicker({
  projectId,
  chapterId,
  locked,
  onSelect,
  onClose,
}: {
  projectId: string;
  chapterId: string;
  locked: boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const auth = useAuth(),
    active = useIsFocused(),
    theme = useTheme(),
    t = useTranslations();
  const userId = String(auth.user?.userId ?? auth.user?.id ?? "");
  const scope = useMemo(
    () => ({ projectId, chapterId, generation: auth.generation }),
    [projectId, chapterId, auth.generation]
  );
  const uploads = useMemo(
    () => timelineUpload(scope, userId, durableRecord("story-asset-upload", userId, projectId)),
    [scope, userId, projectId]
  );
  const op = useAuthFormOperation(projectId, active);
  const abort = useRef<AbortController | null>(null);
  const [items, setItems] = useState<TimelineCandidate[]>([]),
    [pending, setPending] = useState<TimelineUploadCheckpoint | null>(null),
    [error, setError] = useState<string>(),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!active) return;
    const c = new AbortController();
    void Promise.resolve()
      .then(async () => {
        if (c.signal.aborted) return;
        setPending(uploads.read() ?? null);
        const candidates = await fetchTimelineCandidates(scope, c.signal);
        if (!c.signal.aborted) setItems(candidates.filter((v) => v.asset.kind === "image"));
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => {
      c.abort();
      abort.current?.abort();
    };
  }, [active, scope, uploads, revision]);
  const upload = () => {
    if (locked) return;
    void op.run(
      async () => {
        const c = new AbortController();
        abort.current = c;
        setError(undefined);
        return uploads.read() ? uploads.resume(c.signal) : uploads.pick(c.signal, true);
      },
      (candidate) => {
        setPending(null);
        if (candidate?.asset.kind === "image")
          setItems((values) => [
            candidate,
            ...values.filter((v) => v.asset.id !== candidate.asset.id),
          ]);
      },
      (e) => {
        try {
          setPending(uploads.read() ?? null);
        } catch {
          // Preserve the upload failure when recovery itself cannot be read.
        }
        setError(e instanceof Error ? e.message : String(e));
      }
    );
  };
  const button = (label: string, run: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || op.busy || !active}
      onPress={run}
      style={{ paddingVertical: 12, opacity: disabled || op.busy ? 0.5 : 1 }}
    >
      <ThemedText type="smallBold" style={{ color: theme.brand }}>
        {label}
      </ThemedText>
    </Pressable>
  );
  return (
    <View style={{ gap: 12 }}>
      <ThemedText type="smallBold">{t("assetEdit.candidates")}</ThemedText>
      <ThemedText type="small">{t("assetEdit.uploadHelp")}</ThemedText>
      {(loading || op.busy) && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      <Pressable
        accessibilityRole="button"
        disabled={locked || loading || op.busy || !active}
        onPress={upload}
        style={{ paddingVertical: 12, opacity: locked || loading || op.busy ? 0.5 : 1 }}
      >
        <ThemedText type="smallBold" style={{ color: theme.brand }}>
          {pending ? t("timeline.retryUpload") : t("assetEdit.uploadImage")}
        </ThemedText>
      </Pressable>
      {pending &&
        button(t("timeline.clearUpload"), () =>
          Alert.alert(t("timeline.clearUpload"), t("timeline.clearUploadHelp"), [
            { text: t("common.cancel"), style: "cancel" },
            {
              text: t("timeline.clearUpload"),
              style: "destructive",
              onPress: () => {
                try {
                  uploads.clear(pending.clientKey);
                  setPending(null);
                } catch (e) {
                  setError(String(e));
                }
              },
            },
          ])
        )}
      {!loading && !items.length && <ThemedText>{t("assetEdit.noCandidates")}</ThemedText>}
      {items.map((item, index) => (
        <View key={item.asset.id} style={{ gap: 4 }}>
          {item.asset.previewUrl && /^https:\/\//i.test(item.asset.previewUrl) && (
            <Image
              source={{ uri: item.asset.previewUrl }}
              style={{ height: 140, width: "100%" }}
              contentFit="contain"
            />
          )}
          {button(
            `${t("assetEdit.useImage")} ${index + 1}`,
            () => onSelect(item.asset.id),
            locked || !!pending
          )}
        </View>
      ))}
      {button(
        t("common.retry"),
        () => {
          setError(undefined);
          setLoading(true);
          setRevision((n) => n + 1);
        },
        !!pending
      )}
      {button(t("common.cancel"), onClose)}
    </View>
  );
}
