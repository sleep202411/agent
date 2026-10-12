import { StatusBar } from "expo-status-bar";
import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import { useEffect } from "react";
import { StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";

import "@/global.css";
import { AuthProvider } from "@/auth";
import { initLocale } from "@/i18n";
import { PlayOrientationExitCover } from "@/components/play-orientation-exit-cover";
import { checkForUpdate } from "@/lib/update-check";
import { AnimatedSplashOverlay } from "@/components/animated-icon";
import { ConsentGate } from "@/components/consent-gate";
import { MobileAppFrame } from "@/components/mobile-app-frame";
import { Colors } from "@/constants/theme";
import { PLAY_ROUTE_NAV_OPTIONS } from "@/hooks/play-orientation";
import { lockAppPortrait } from "@/hooks/use-screen-orientation";

// Anchor deep links (e.g. a shared /ip/<id>) on top of the tab shell so the
// native back button always has somewhere to return to.
export const unstable_settings = {
  initialRouteName: "(tabs)",
};

// Native, fixed, transparent header for full-bleed detail screens — gives the
// standard back button for free instead of a custom floating control.
const detailHeader = {
  headerShown: true,
  headerTransparent: true,
  headerTitle: "",
  headerTintColor: Colors.dark.text,
  headerBackButtonDisplayMode: "minimal",
} as const;

export default function RootLayout() {
  useEffect(() => {
    void initLocale();
    void checkForUpdate();
    lockAppPortrait();
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <KeyboardProvider>
        <ThemeProvider value={DarkTheme}>
          <StatusBar style="light" />
          <AuthProvider>
            <AnimatedSplashOverlay />
            <MobileAppFrame>
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="agent/index" options={detailHeader} />
                <Stack.Screen name="agent/[projectId]" options={{ headerShown: false }} />
                {/* Login / register / reset — a full-page route the gate pushes
                  (or replaces) onto the stack; always skippable. */}
                <Stack.Screen name="(auth)" />
                <Stack.Screen name="settings" />
                <Stack.Screen name="profile-edit" />
                <Stack.Screen name="profile-experience" />
                <Stack.Screen name="publish-work" />
                <Stack.Screen name="work/[id]" options={detailHeader} />
                <Stack.Screen name="about" />
                <Stack.Screen name="certificate-verify" />
                <Stack.Screen name="earnings" />
                <Stack.Screen name="crew-income" />
                <Stack.Screen name="account-security" />
                <Stack.Screen name="bind-invite" />
                <Stack.Screen name="referrals" />
                <Stack.Screen name="crew-applications" />
                <Stack.Screen name="conversation/[id]" />
                <Stack.Screen name="order/[id]" />
                <Stack.Screen name="orders" />
                <Stack.Screen name="my-services" />
                <Stack.Screen name="inbox" />
                <Stack.Screen
                  name="pay/index"
                  options={{ contentStyle: { backgroundColor: Colors.dark.background } }}
                />
                <Stack.Screen name="pay/community" />
                <Stack.Screen name="delete-account" />
                <Stack.Screen name="ips" options={detailHeader} />
                <Stack.Screen name="games" options={detailHeader} />
                <Stack.Screen
                  name="play/interactive-film/[gameId]"
                  options={{
                    ...detailHeader,
                    ...PLAY_ROUTE_NAV_OPTIONS,
                  }}
                />
                <Stack.Screen
                  name="play/story-preview/[projectId]"
                  options={{
                    ...detailHeader,
                    ...PLAY_ROUTE_NAV_OPTIONS,
                  }}
                />
                <Stack.Screen name="ip/[id]" options={detailHeader} />
                <Stack.Screen
                  name="saved-openings"
                  options={{ ...detailHeader, presentation: "modal" }}
                />
                <Stack.Screen name="courses/[id]" options={detailHeader} />
                <Stack.Screen name="crew/[id]" options={detailHeader} />
                <Stack.Screen name="creator/[id]" options={detailHeader} />
                <Stack.Screen name="service/[id]" options={detailHeader} />
              </Stack>
            </MobileAppFrame>
            <ConsentGate />
            <PlayOrientationExitCover />
          </AuthProvider>
        </ThemeProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.dark.background,
    overflow: "hidden",
  },
});
