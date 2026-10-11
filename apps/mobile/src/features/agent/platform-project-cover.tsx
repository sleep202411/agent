import { useEffect, useState } from "react";
import { Image } from "expo-image";
import { ActivityIndicator, Pressable, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { fetchCrewAssetAccess } from "@/features/crew-assets/api";
import type { PlatformProject } from "./api/platform-projects-api";
/** Resolve protected content through the authenticated API; never put login tokens on images. */
export function PlatformProjectCover({ project }: { project: PlatformProject }) {
  const t = useTranslations();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; url?: string; error?: string }>();
  const key = `${project.id}:${project.version}:${revision}`;
  useEffect(() => {
    const c = new AbortController();
    void (async () => {
      try {
        const assetId =
          project.coverAssetId ||
          project.thumbnailUrl?.match(/^\/aurora\/media\/assets\/([a-f0-9-]+)\/content$/i)?.[1];
        const url = assetId
          ? (await fetchCrewAssetAccess(assetId, c.signal)).url
          : project.thumbnailUrl || undefined;
        if (url) {
          const parsed = new URL(url);
          if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password)
            throw Error("Invalid project cover URL.");
        }
        if (!c.signal.aborted) setResult({ key, url });
      } catch (e) {
        if (!c.signal.aborted)
          setResult({ key, error: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => c.abort();
  }, [key, project.coverAssetId, project.thumbnailUrl]);
  const visible = result?.key === key ? result : undefined;
  return (
    <View style={{ gap: 8 }}>
      {!visible ? (
        <ActivityIndicator />
      ) : visible.error ? (
        <>
          <ThemedText accessibilityRole="alert">{visible.error}</ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => setRevision((v) => v + 1)}
            style={{ padding: 12 }}
          >
            <ThemedText type="small">{t("common.retry")}</ThemedText>
          </Pressable>
        </>
      ) : visible.url ? (
        <Image
          source={{ uri: visible.url }}
          recyclingKey={key}
          contentFit="cover"
          accessibilityLabel={t("studioProjects.cover")}
          style={{ width: "100%", aspectRatio: 16 / 9, borderRadius: 8 }}
          onError={() =>
            setResult((previous) =>
              previous?.key === key ? { key, error: t("studioProjects.coverFailed") } : previous
            )
          }
        />
      ) : (
        <ThemedText type="small">{t("studioProjects.coverEmpty")}</ThemedText>
      )}
    </View>
  );
}
