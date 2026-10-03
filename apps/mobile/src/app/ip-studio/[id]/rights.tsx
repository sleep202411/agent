import { z } from "zod";
import { Stack, useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { IpGovernancePanel } from "@/features/ip-author/governance-panel";
export default function IpGovernanceScreen() {
  const { id, kind, crewId } = useLocalSearchParams<{
    id?: string;
    kind?: string;
    crewId?: string;
  }>();
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
          headerTitle: t("ipGovernance.heading"),
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
      ) : typeof id === "string" && z.string().uuid().safeParse(id).success && userId ? (
        <IpGovernancePanel
          key={`${id}:${userId}:${auth.generation}:${kind}:${crewId}`}
          ipId={id}
          userId={userId}
          generation={auth.generation}
          initialKind={kind === "crew" ? "crew" : undefined}
          suggestedCrewId={
            typeof crewId === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(crewId) ? crewId : undefined
          }
        />
      ) : (
        <ThemedText>{t("ipAuthor.invalid")}</ThemedText>
      )}
    </View>
  );
}
