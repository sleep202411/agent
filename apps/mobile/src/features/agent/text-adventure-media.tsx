import { useScreenActive } from "@/hooks/use-app-active";
import { Image, ScrollView, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { ConversationAudio } from "@/features/services/conversation-audio";
function safeMediaUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}
export function TextAdventureMusic({ url }: { url: string }) {
  const t = useTranslations();
  const active = useScreenActive();
  return (
    <View style={{ gap: 8 }}>
      <ThemedText>{t("textAdventures.editor.sections.music")}</ThemedText>
      {safeMediaUrl(url) ? (
        active ? (
          <ConversationAudio key={url} url={url} />
        ) : null
      ) : (
        <ThemedText accessibilityRole="alert">{t("thread.previewFailed")}</ThemedText>
      )}
    </View>
  );
}
export function TextAdventureMedia({
  stillUrls,
  bgmUrl,
}: {
  stillUrls: string[];
  bgmUrl: string | null;
}) {
  const t = useTranslations();
  return (
    <View style={{ gap: 12 }}>
      {stillUrls.length > 0 && (
        <>
          <ThemedText>{t("textAdventures.editor.sections.stills")}</ThemedText>
          <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
            {stillUrls.map((url, index) =>
              safeMediaUrl(url) ? (
                <Image
                  key={`${url}:${index}`}
                  accessibilityLabel={`${t("textAdventures.editor.sections.stills")} ${index + 1}`}
                  source={{ uri: url }}
                  resizeMode="contain"
                  style={{ width: 240, height: 150, borderRadius: 8 }}
                />
              ) : (
                <ThemedText key={index} accessibilityRole="alert">
                  {t("thread.previewFailed")}
                </ThemedText>
              )
            )}
          </ScrollView>
        </>
      )}
      {bgmUrl && <TextAdventureMusic url={bgmUrl} />}
    </View>
  );
}
