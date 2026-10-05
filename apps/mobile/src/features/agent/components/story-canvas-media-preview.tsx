import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, View } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getAuthGeneration } from "@/auth/auth-store";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTranslations } from "@/i18n";
import { useTheme } from "@/hooks/use-theme";
import { ThemedText } from "@/components/themed-text";
import { ConversationVideo } from "@/features/services/conversation-video";
import { ConversationAudio } from "@/features/services/conversation-audio";
import { StoryCanvasReader } from "./story-canvas-reader";
import { canvasOverview, type CanvasLibraryAsset } from "../lib/story-canvas-overview";
import { loadCanvasMediaAccess, type CanvasMediaScope } from "../api/story-canvas-media-access";
import { canvasMediaView } from "../lib/story-canvas-media-view";
import { openPlatformCanvasDocument } from "../api/platform-canvas-document";
export type CanvasMediaTarget =
  | { assetId: string; node?: never; shot?: never }
  | { assetId?: never; shot?: never; node: { nodeId: string; mediaKey: string } }
  | { assetId?: never; node?: never; shot: { nodeId: string; key: string; attached: boolean } };
type Props = { scope: CanvasMediaScope; close(): void } & CanvasMediaTarget;
export function StoryCanvasMediaPreview(props: Props) {
  const active = useScreenActive();
  const [attempt, setAttempt] = useState(0);
  return active && getAuthGeneration() === props.scope.generation ? (
    <Preview
      key={`${"kind" in props.scope ? `${props.scope.kind}:${props.scope.workspaceId}:${props.scope.sectionId}` : "story"}:${props.scope.generation}:${props.scope.projectId}:${props.scope.documentId}:${props.assetId ?? JSON.stringify(props.node ?? props.shot)}:${attempt}`}
      {...props}
      retry={() => setAttempt((value) => value + 1)}
    />
  ) : null;
}
function Preview({ scope, assetId, node, shot, close, retry }: Props & { retry(): void }) {
  const t = useTranslations(),
    theme = useTheme(),
    insets = useSafeAreaInsets();
  const life = useRef<AbortController | null>(null);
  const [reading, setReading] = useState(true),
    [error, setError] = useState<string>();
  const [media, setMedia] = useState<{
    asset: CanvasLibraryAsset;
    url: string;
    expiresAt: string | null;
  }>();
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useLayoutEffect(() => {
    const controller = new AbortController();
    life.current = controller;
    timeout.current = setTimeout(() => {
      controller.abort();
      setError(t("thread.previewFailed"));
    }, 30000);
    return () => {
      clearTimeout(timeout.current);
      controller.abort();
    };
  }, [t]);
  useEffect(() => {
    if (!media?.expiresAt) return;
    const timer = setTimeout(
      () => setError(t("thread.previewFailed")),
      Math.min(2147483647, Math.max(0, Date.parse(media.expiresAt) - Date.now()))
    );
    return () => clearTimeout(timer);
  }, [media, t]);
  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          padding: 16,
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + 12,
          gap: 12,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <ThemedText type="smallBold" numberOfLines={2} style={{ flex: 1 }}>
            {media?.asset.name || t("storyCandidates.preview")}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={close}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <ThemedText type="small">{t("thread.closePreview")}</ThemedText>
          </Pressable>
        </View>
        {error ? (
          <View style={{ gap: 12 }}>
            <ThemedText accessibilityRole="alert">{error}</ThemedText>
            <Pressable accessibilityRole="button" onPress={retry} style={{ minHeight: 44 }}>
              <ThemedText>{t("common.retry")}</ThemedText>
            </Pressable>
          </View>
        ) : !media ? (
          <ActivityIndicator accessibilityLabel={t("courses.loading")} />
        ) : media.asset.kind === "video" ? (
          <ConversationVideo url={media.url} onRetry={close} />
        ) : media.asset.kind === "audio" ? (
          <ConversationAudio url={media.url} />
        ) : (
          <Image
            source={{ uri: media.url }}
            contentFit="contain"
            cachePolicy="none"
            style={{ flex: 1 }}
            accessibilityLabel={media.asset.name || t("storyCanvas.image")}
            onError={() => setError(t("thread.previewFailed"))}
          />
        )}
        {reading && !error && (
          <StoryCanvasReader
            scope={scope}
            platform={
              "kind" in scope && scope.kind === "platform"
                ? { scope, load: openPlatformCanvasDocument }
                : undefined
            }
            title={t("storyCanvas.title")}
            runtimeError={t("storyCanvas.loadError")}
            onError={(message) => {
              clearTimeout(timeout.current);
              setReading(false);
              setError(message);
            }}
            onResult={(loaded) => {
              setReading(false);
              const controller = life.current;
              if (!controller || controller.signal.aborted) return;
              void (async () => {
                if (loaded.documentId !== scope.documentId)
                  throw Error("Canvas document scope mismatch.");
                const overview = canvasOverview(loaded.snapshot);
                const shotView = shot ? canvasMediaView(loaded.snapshot, shot.nodeId) : undefined;
                const shotItem =
                  shot && shotView
                    ? (shot.attached ? shotView.attached : shotView.sources).find(
                        (item) => item.key === shot.key
                      )
                    : undefined;
                const asset = shot
                  ? shotItem && {
                      id: shotItem.key,
                      name: shotItem.name,
                      kind: shotItem.kind,
                      url: shotItem.url ?? "",
                      mediaAssetId: shotItem.mediaAssetId,
                    }
                  : node
                    ? overview.nodes
                        .find((row) => row.id === node.nodeId)
                        ?.media.find((row) => row.id === node.mediaKey)
                    : overview.assets.find((row) => row.id === assetId);
                if (!asset) throw Error("This canvas media is no longer available.");
                const access = await loadCanvasMediaAccess(scope, asset, controller.signal);
                if (!controller.signal.aborted && getAuthGeneration() === scope.generation)
                  setMedia({ asset, ...access });
              })()
                .catch((cause) => {
                  if (!controller.signal.aborted && getAuthGeneration() === scope.generation)
                    setError(cause instanceof Error ? cause.message : String(cause));
                })
                .finally(() => clearTimeout(timeout.current));
            }}
          />
        )}
      </View>
    </Modal>
  );
}
