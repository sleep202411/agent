import { Stack, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { IpCreateForm } from "@/features/ip-author/create-form";
export default function IpCreateScreen() {
  const router = useRouter();
  const auth = useAuth(),
    gate = useAuthGate(),
    theme = useTheme(),
    t = useTranslations();
  const userId = String(auth.user?.userId ?? auth.user?.id ?? "");
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: t("ipCreate.heading"),
          headerTintColor: theme.text,
          headerStyle: { backgroundColor: theme.background },
        }}
      />
      {auth.status === "hydrating" ? (
        <ActivityIndicator />
      ) : auth.status !== "authenticated" ? (
        <Pressable accessibilityRole="button" onPress={() => gate.requireAuth()}>
          <ThemedText>{t("login.signIn")}</ThemedText>
        </Pressable>
      ) : userId ? (
        <IpCreateForm
          key={`${userId}:${auth.generation}`}
          userId={userId}
          generation={auth.generation}
          onCreated={(id) => router.replace(`/ip-studio/${id}` as never)}
        />
      ) : (
        <ThemedText>{t("ipAuthor.invalid")}</ThemedText>
      )}
    </View>
  );
}
