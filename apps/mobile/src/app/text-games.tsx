import { Stack } from "expo-router";
import { View } from "react-native";
import { TextGameCatalogue } from "@/features/text-games/catalogue";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
export default function TextGamesScreen() {
  const active = useScreenActive(),
    theme = useTheme(),
    t = useTranslations();
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t("textGames.title"),
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.text,
        }}
      />
      <TextGameCatalogue active={active} />
    </View>
  );
}
