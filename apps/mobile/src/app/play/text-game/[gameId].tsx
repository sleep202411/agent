import { Stack, useLocalSearchParams } from "expo-router";
import { TextGameIdSchema } from "@repo/shared/text-game";
import { View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { PublishedTextAdventure } from "@/features/browse/published-text-adventure";
export default function TextGameScreen() {
  const params = useLocalSearchParams<{ gameId?: string | string[] }>(),
    theme = useTheme(),
    t = useTranslations();
  const id = TextGameIdSchema.safeParse(params.gameId);
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t("games.textLabel"),
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.text,
        }}
      />
      {id.success ? (
        <PublishedTextAdventure key={id.data} gameId={id.data} />
      ) : (
        <ThemedText accessibilityRole="alert">{t("games.invalidTextGame")}</ThemedText>
      )}
    </View>
  );
}
