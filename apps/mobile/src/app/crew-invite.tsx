import { useCallback, useRef, useSyncExternalStore } from "react";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { appEnv } from "@/config/app-env";
import { CrewInviteAccept } from "@/features/services/crew-invite-accept";
import { crewInviteRoute } from "@/features/services/crew-invite-link";
import { crewInviteTargetRoute } from "@/features/services/crew-invite-accept-api";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { toHref } from "@/lib/navigation";

const subscribeHydration = () => () => {};
export default function CrewInviteScreen() {
  const hydrated = useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false
  );
  const { link } = useLocalSearchParams<{ link?: string | string[] }>();
  // Static exports have no query string; match their shell before validating the link.
  if (!hydrated) return <ActivityIndicator />;
  // Re-key on incoming link so an old invitation's review cannot survive navigation.
  return (
    <InviteEntry
      key={typeof link === "string" ? link : "invalid"}
      link={typeof link === "string" ? link : Array.isArray(link) ? "invalid" : undefined}
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
    route = link === undefined ? "/crew-invite" : crewInviteRoute(link, appEnv.appRegion);
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
  const close = () => (router.canGoBack() ? router.back() : router.replace(toHref("/crews")));
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: t("crewJoin.title"),
          headerBackButtonDisplayMode: "minimal",
        }}
      />
      {!route ? (
        <View style={{ padding: 16, gap: 12 }}>
          <ThemedText accessibilityRole="alert">{t("crewJoin.invalidLink")}</ThemedText>
          <Pressable accessibilityRole="button" onPress={close}>
            <ThemedText>{t("common.back")}</ThemedText>
          </Pressable>
        </View>
      ) : auth.status === "authenticated" ? (
        <CrewInviteAccept
          generation={auth.generation}
          initialLink={link}
          onClose={close}
          onOpen={(target) => router.replace(toHref(crewInviteTargetRoute(target)))}
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
