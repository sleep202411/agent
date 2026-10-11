import { Stack, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { CrewCreation } from "@/features/services/crew-creation";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { toHref } from "@/lib/navigation";

export default function CrewCreateScreen() {
  const auth = useAuth(),
    gate = useAuthGate(),
    router = useRouter();
  const t = useTranslations(),
    theme = useTheme();
  const userId = String(auth.user?.userId ?? auth.user?.id ?? "");
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t("crewCreate.createDialogTitle"),
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.text,
        }}
      />
      {auth.status === "hydrating" ? (
        <ActivityIndicator />
      ) : auth.status !== "authenticated" ? (
        <Pressable
          accessibilityRole="button"
          style={{ padding: 16 }}
          onPress={() => gate.requireAuth()}
        >
          <ThemedText>{t("crewCreate.createDialogTitle")}</ThemedText>
        </Pressable>
      ) : userId ? (
        <CrewCreation
          userId={userId}
          generation={auth.generation}
          onClose={() => router.back()}
          onCertification={() => router.push(toHref("/certification-application?level=13"))}
          onCreated={(id) => router.replace(toHref(`/crew-tasks/${id}?section=setup`))}
        />
      ) : null}
    </View>
  );
}
