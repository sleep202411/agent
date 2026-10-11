import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/auth";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import { ConversationAudio } from "@/features/services/conversation-audio";
import { ConversationVideo } from "@/features/services/conversation-video";
import type { CandidateScope } from "../api/story-candidates-api";
import { fetchStoryCandidatePlayback } from "../api/story-candidate-playback";

type Props = { scope: CandidateScope; mediaAssetId: string; kind: "audio" | "video"; name: string };
export function StoryCandidatePlayback(props: Props) {
  const active = useScreenActive(),
    auth = useAuth();
  return active && auth.generation === props.scope.generation ? (
    <Playback
      key={`${props.scope.projectId}:${props.scope.generation}:${props.mediaAssetId}:${props.kind}`}
      {...props}
    />
  ) : null;
}
function Playback({ scope, mediaAssetId, kind, name }: Props) {
  const t = useTranslations(),
    theme = useTheme(),
    insets = useSafeAreaInsets();
  const [url, setUrl] = useState<string>(),
    [error, setError] = useState<string>(),
    [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
    },
    []
  );
  const open = async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(undefined);
    try {
      const next = await fetchStoryCandidatePlayback(scope, mediaAssetId, kind, controller.signal);
      if (!controller.signal.aborted) setUrl(next);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  };
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => void open()}
        style={{ paddingVertical: 12 }}
      >
        <ThemedText type="smallBold">{t("storyCandidates.preview")}</ThemedText>
      </Pressable>
      {busy && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {url && (
        <Modal visible animationType="fade" onRequestClose={() => setUrl(undefined)}>
          <View
            style={{
              flex: 1,
              backgroundColor: theme.background,
              padding: 16,
              paddingTop: insets.top + 16,
              paddingBottom: insets.bottom + 16,
              gap: 12,
            }}
          >
            <Pressable
              accessibilityRole="button"
              onPress={() => setUrl(undefined)}
              style={{ paddingVertical: 12 }}
            >
              <ThemedText type="smallBold">{t("thread.closePreview")}</ThemedText>
            </Pressable>
            <ThemedText type="smallBold">{name}</ThemedText>
            {kind === "audio" ? (
              <ConversationAudio url={url} />
            ) : (
              <ConversationVideo url={url} onRetry={() => setUrl(undefined)} />
            )}
          </View>
        </Modal>
      )}
    </View>
  );
}
