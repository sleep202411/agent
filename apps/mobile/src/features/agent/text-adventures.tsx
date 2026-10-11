import { useIsFocused } from "expo-router";
import { useAuth } from "@/auth";
import { View, Pressable } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { TextAdventureLibrary } from "./text-adventure-library";
export function TextAdventures({ onClose }: { onClose: () => void }) {
  // Native file pickers can background the app without leaving this route.
  // Keep editing/upload state alive; playback owns its foreground gate.
  const auth = useAuth(),
    t = useTranslations(),
    focused = useIsFocused();
  const userId = String(auth.user?.userId ?? auth.user?.id ?? "");
  return (
    <View style={{ flex: 1 }}>
      <Pressable accessibilityRole="button" onPress={onClose} style={{ padding: 16 }}>
        <ThemedText>{t("textAdventure.back")}</ThemedText>
      </Pressable>
      {focused && auth.status === "authenticated" && userId && (
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
