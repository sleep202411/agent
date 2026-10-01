import { useScreenActive } from "@/hooks/use-app-active";
import { useAuth } from "@/auth";
import { View, Pressable } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { TextAdventureLibrary } from "./text-adventure-library";
export function TextAdventures({ onClose }: { onClose: () => void }) {
  const auth = useAuth(),
    t = useTranslations(),
    active = useScreenActive();
  const userId = String(auth.user?.userId ?? auth.user?.id ?? "");
  return (
    <View style={{ flex: 1 }}>
      <Pressable accessibilityRole="button" onPress={onClose} style={{ padding: 16 }}>
        <ThemedText>{t("textAdventure.back")}</ThemedText>
      </Pressable>
      {active && auth.status === "authenticated" && userId && (
        <TextAdventureLibrary
          key={`${userId}:${auth.generation}`}
          session={{
            userId,
            generation: auth.generation,
          }}
        />
      )}
    </View>
  );
}
