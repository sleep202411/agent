import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, TextInput, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { appEnv } from "@/config/app-env";
import { CastingAcceptPanel } from "@/features/ai-lab/casting-accept-panel";
import { castingInviteRoute, parseCastingInviteLink } from "@/features/ai-lab/casting-invite-link";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { toHref } from "@/lib/navigation";
const subscribeHydration = () => () => {};
const clientReady = () => true;
const serverReady = () => false;
export default function CastingInviteScreen() {
  // Static exports have no query string. Match their shell before reading the incoming link.
  const hydrated = useSyncExternalStore(subscribeHydration, clientReady, serverReady);
  const { link } = useLocalSearchParams<{ link?: string | string[] }>();
  if (!hydrated) return <ActivityIndicator />;
  return (
    <Entry
      key={typeof link === "string" ? link : "manual"}
      link={typeof link === "string" ? link : undefined}
    />
  );
}
function Entry({ link }: { link?: string }) {
  const auth = useAuth(),
    gate = useAuthGate(),
    router = useRouter(),
    theme = useTheme(),
    t = useTranslations();
  const [input, setInput] = useState(link ?? ""),
    [error, setError] = useState("");
  const prompted = useRef(false);
  let token: string | undefined, route: string | undefined;
  try {
    if (link) {
      token = parseCastingInviteLink(link, appEnv.appRegion);
      route = castingInviteRoute(link, appEnv.appRegion);
    }
  } catch {
    /* Invalid region/token stays on the local form. */
  }
  const login = useCallback(() => {
    if (route) gate.openLogin({ onAuthenticated: () => router.replace(toHref(route)) });
  }, [route, gate, router]);
  useFocusEffect(
    useCallback(() => {
      if (route && auth.status === "anonymous" && !prompted.current) {
        prompted.current = true;
        login();
      }
    }, [route, auth.status, login])
  );
  const userId = String(auth.user?.userId ?? auth.user?.id ?? "");
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: t("castingAccept.title"),
          headerBackButtonDisplayMode: "minimal",
        }}
      />
      {!token ? (
        <View style={{ padding: 16, gap: 12 }}>
          <ThemedText>{t("castingAccept.paste")}</ThemedText>
          <TextInput
            accessibilityLabel={t("castingAccept.paste")}
            placeholder={t("castingAccept.paste")}
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            value={input}
            onChangeText={setInput}
            maxLength={2048}
            style={{
              color: theme.text,
              backgroundColor: theme.backgroundElement,
              padding: 12,
              borderRadius: 8,
            }}
          />
          {error || link ? (
            <ThemedText accessibilityRole="alert">{error || t("castingAccept.invalid")}</ThemedText>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              try {
                router.replace(toHref(castingInviteRoute(input, appEnv.appRegion)));
              } catch {
                setError(t("castingAccept.invalid"));
              }
            }}
            style={{ padding: 12 }}
          >
            <ThemedText>{t("castingAccept.preview")}</ThemedText>
          </Pressable>
        </View>
      ) : auth.status === "authenticated" && userId ? (
        <CastingAcceptPanel
          key={`${userId}:${auth.generation}:${token}`}
          token={token}
          userId={userId}
          generation={auth.generation}
        />
      ) : auth.status === "hydrating" ? (
        <ActivityIndicator />
      ) : (
        <Pressable accessibilityRole="button" onPress={login} style={{ padding: 16 }}>
          <ThemedText>{t("auth.signIn")}</ThemedText>
        </Pressable>
      )}
    </View>
  );
}
