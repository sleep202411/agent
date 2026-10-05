import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, View } from "react-native";
import { uuid } from "expo-modules-core";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { useTheme } from "@/hooks/use-theme";
import { loadCanvasPanorama, type CanvasPanoramaSource } from "../api/story-canvas-panorama";
import type { CanvasEditScope } from "../lib/story-canvas-draft";
import { panoramaDocument, type PanoramaLabels } from "../lib/story-panorama-document";
import { StoryPanoramaFrame } from "./story-panorama-frame";
type PreviewProps = { scope: CanvasEditScope; source: CanvasPanoramaSource; close(): void };
export function StoryPanoramaPreview(props: PreviewProps) {
  const [attempt, setAttempt] = useState(0);
  const key = `${props.scope.generation}:${props.scope.documentId}:${props.source.mediaAssetId ?? props.source.url}:${attempt}`;
  return <Preview key={key} {...props} retry={() => setAttempt((value) => value + 1)} />;
}
function Preview({ scope, source, close, retry }: PreviewProps & { retry(): void }) {
  const t = useTranslations(),
    theme = useTheme(),
    insets = useSafeAreaInsets();
  const [src, setSrc] = useState<string>(),
    [error, setError] = useState<string>(),
    [ready, setReady] = useState(false),
    [dimensions, setDimensions] = useState<string>();
  const [sessionId] = useState(() => uuid.v4());
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
      setError(t("thread.previewFailed"));
    }, 30000);
    void loadCanvasPanorama(scope, source, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setSrc(value);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [scope, source, t]);
  const html = useMemo(() => {
    if (!src) return undefined;
    const labels = Object.fromEntries(
      (["title", "hint", "left", "right", "up", "down", "zoomIn", "zoomOut", "reset"] as const).map(
        (key) => [key, t(`storyCanvas.panorama.${key}`)]
      )
    ) as PanoramaLabels;
    return panoramaDocument(sessionId, src, labels);
  }, [src, sessionId, t]);
  useEffect(() => {
    if (!html || ready || error) return;
    const timeout = setTimeout(() => setError(t("thread.previewFailed")), 25000);
    return () => clearTimeout(timeout);
  }, [html, ready, error, t]);
  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        }}
      >
        <View
          style={{
            paddingHorizontal: 16,
            paddingVertical: 8,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
          }}
        >
          <View style={{ flex: 1 }}>
            <ThemedText type="smallBold" numberOfLines={1}>
              {source.title || t("storyCanvas.panorama.title")}
            </ThemedText>
            {dimensions && (
              <ThemedText type="small" themeColor="textSecondary">
                {dimensions}
              </ThemedText>
            )}
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={close}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <ThemedText type="small">{t("thread.closePreview")}</ThemedText>
          </Pressable>
        </View>
        {error ? (
          <View style={{ padding: 16, gap: 12 }}>
            <ThemedText accessibilityRole="alert">{error}</ThemedText>
            <Pressable accessibilityRole="button" onPress={retry} style={{ minHeight: 44 }}>
              <ThemedText>{t("common.retry")}</ThemedText>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={{ flex: 1 }}>
              {html && (
                <StoryPanoramaFrame
                  key={sessionId}
                  html={html}
                  sessionId={sessionId}
                  title={t("storyCanvas.panorama.title")}
                  onEvent={(type, detail) => {
                    if (type === "error") setError(t("thread.previewFailed"));
                    else {
                      setReady(true);
                      setDimensions(detail);
                    }
                  }}
                />
              )}
            </View>
            {!ready && (
              <ActivityIndicator
                accessibilityLabel={t("courses.loading")}
                style={{ position: "absolute", top: "50%", alignSelf: "center" }}
              />
            )}
          </>
        )}
      </View>
    </Modal>
  );
}
