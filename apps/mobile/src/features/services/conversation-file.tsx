import { useEffect, useRef, useState } from "react";
import { Linking, Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ConversationAudio } from "./conversation-audio";
import { ConversationVideo } from "./conversation-video";
import { Image } from "expo-image";
import { useTheme } from "@/hooks/use-theme";
import { getAuthGeneration } from "@/auth/auth-store";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTranslations } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import { fetchCrewAssetAccess } from "@/features/crew-assets/api";
type Props = { mediaAssetId: string; name: string; mediaKind?: string; contentType?: string };
/** Resolve access on tap; media URLs live only in the active preview, never persisted. */
function File({ mediaAssetId, name, mediaKind, contentType }: Props) {
  const insets = useSafeAreaInsets();
  const t = useTranslations(),
    theme = useTheme();
  const [preview, setPreview] = useState<{ url: string; expiresAt: string | null } | undefined>();
  const isVideo = mediaKind === "video" && /^video\//i.test(contentType || "");
  const isAudio = mediaKind === "audio" && /^audio\//i.test(contentType || "");
  const canPreview =
    isAudio ||
    isVideo ||
    (mediaKind === "image" &&
      /^image\/(jpeg|png|webp|gif|avif|heic|heif)$/i.test(contentType || ""));
  useEffect(() => {
    if (!preview?.expiresAt) return;
    const timer = setTimeout(
      () => setPreview(undefined),
      Math.min(2147483647, Math.max(0, Date.parse(preview.expiresAt) - Date.now()))
    );
    return () => clearTimeout(timer);
  }, [preview]);
  const request = useRef<AbortController | undefined>(undefined);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string>();
  useEffect(
    () => () => {
      request.current?.abort();
      request.current = undefined;
    },
    [mediaAssetId]
  );
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => {
          if (request.current) return;
          const controller = new AbortController(),
            generation = getAuthGeneration();
          request.current = controller;
          setBusy(true);
          setError(undefined);
          void (async () => {
            try {
              const access = await fetchCrewAssetAccess(mediaAssetId, controller.signal);
              if (controller.signal.aborted || generation !== getAuthGeneration()) return;
              if (canPreview) setPreview({ url: access.url, expiresAt: access.expiresAt });
              else await Linking.openURL(access.url);
            } catch (cause) {
              if (!controller.signal.aborted && generation === getAuthGeneration())
                setError(cause instanceof Error ? cause.message : String(cause));
            } finally {
              if (request.current === controller) {
                request.current = undefined;
                setBusy(false);
              }
            }
          })();
        }}
        style={{ padding: 12 }}
      >
        <ThemedText>
          {t("thread.openFile")}: {name}
        </ThemedText>
      </Pressable>
      {preview && (
        <Modal
          visible
          transparent={false}
          animationType="fade"
          onRequestClose={() => setPreview(undefined)}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: theme.background,
              padding: 16,
              paddingTop: insets.top + 12,
              paddingBottom: insets.bottom + 12,
            }}
          >
            <Pressable
              accessibilityRole="button"
              onPress={() => setPreview(undefined)}
              style={{ padding: 12 }}
            >
              <ThemedText>{t("thread.closePreview")}</ThemedText>
            </Pressable>
            <ThemedText numberOfLines={2}>{name}</ThemedText>
            {isAudio ? (
              <ConversationAudio url={preview.url} />
            ) : isVideo ? (
              <ConversationVideo url={preview.url} onRetry={() => setPreview(undefined)} />
            ) : (
              <Image
                source={{ uri: preview.url }}
                style={{ flex: 1 }}
                contentFit="contain"
                cachePolicy="none"
                accessibilityLabel={name}
                onError={() => {
                  setPreview(undefined);
                  setError(t("thread.previewFailed"));
                }}
              />
            )}
          </View>
        </Modal>
      )}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
    </View>
  );
}

export function ConversationFile(props: Props) {
  const active = useScreenActive();
  return active ? <File key={`${props.mediaAssetId}:${getAuthGeneration()}`} {...props} /> : null;
}
