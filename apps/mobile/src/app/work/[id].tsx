import { Stack, useIsFocused, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { useAuth } from "@/auth";
import { PersonalWorkPlayer } from "@/features/profile/personal-work-player";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
export default function PersonalWorkRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const auth = useAuth();
  const focused = useIsFocused();
  const theme = useTheme();
  const t = useTranslations();
  return (
    <View style={{ flex: 1, justifyContent: "center", backgroundColor: theme.background }}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t("mine.tabWorks"),
          headerTintColor: theme.text,
          headerStyle: { backgroundColor: theme.background },
        }}
      />
      {focused && (
        <PersonalWorkPlayer
          key={JSON.stringify([id, auth.generation])}
          id={typeof id === "string" ? id : ""}
        />
      )}
    </View>
  );
}
