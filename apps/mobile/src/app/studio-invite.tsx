import { useCallback, useRef } from "react";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { appEnv } from "@/config/app-env";
import { StudioInviteAccept } from "@/features/agent/studio-invite-accept";
import { studioInviteRoute } from "@/features/agent/studio-invite-link";
import { studioInviteTargetRoute } from "@/features/agent/api/studio-invite-accept-api";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { toHref } from "@/lib/navigation";

export default function StudioInviteScreen() {
  const { link } = useLocalSearchParams<{ link?: string | string[] }>();
  // Re-key on incoming link so an old invitation's review cannot survive navigation.
  return (
    <InviteEntry
      key={typeof link === "string" ? link : "invalid"}
      link={typeof link === "string" ? link : undefined}
    />
  );
}
function InviteEntry({ link }: { link?: string }) {
  const auth = useAuth();
  const gate = useAuthGate();
  const router = useRouter();
  const theme = useTheme();
  const t = useTranslations();
  const prompted = useRef(false);
  let route: string | undefined;
  try {
    if (link) route = studioInviteRoute(link, appEnv.appRegion);
  } catch {
    /* Show localized invalid-link guidance. */
  }
  const login = useCallback(() => {
    if (!route) return;
    gate.openLogin({ onAuthenticated: () => router.replace(toHref(route)) });
  }, [gate, route, router]);
  useFocusEffect(
    useCallback(() => {
      if (route && auth.status === "anonymous" && !prompted.current) {
        prompted.current = true;
        login();
      }
    }, [auth.status, login, route])
  );
  const close = () => (router.canGoBack() ? router.back() : router.replace(toHref("/agent")));
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: t("studioJoin.title"),
          headerBackButtonDisplayMode: "minimal",
        }}
      />
      {!route ? (
        <View style={{ padding: 16, gap: 12 }}>
          <ThemedText accessibilityRole="alert">{t("studioJoin.invalidLink")}</ThemedText>
          <Pressable accessibilityRole="button" onPress={close}>
            <ThemedText>{t("common.back")}</ThemedText>
          </Pressable>
        </View>
      ) : auth.status === "authenticated" ? (
        <StudioInviteAccept
          generation={auth.generation}
          initialLink={link}
          onClose={close}
          onOpen={(target) => router.replace(toHref(studioInviteTargetRoute(target)))}
        />
      ) : (
        <View style={{ padding: 16, gap: 12 }}>
          {auth.status === "hydrating" ? (
            <ActivityIndicator />
          ) : (
            <Pressable accessibilityRole="button" onPress={login}>
              <ThemedText>{t("auth.signIn")}</ThemedText>
            </Pressable>
          )}
          <Pressable accessibilityRole="button" onPress={close}>
            <ThemedText>{t("common.back")}</ThemedText>
          </Pressable>
        </View>
      )}
    </View>
  );
}
