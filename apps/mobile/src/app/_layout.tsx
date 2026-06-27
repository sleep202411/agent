import { StatusBar } from "expo-status-bar";
import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import { useEffect } from "react";
import { StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import "@/global.css";
import { AuthProvider } from "@/auth";
import { initLocale } from "@/i18n";
import { AnimatedSplashOverlay } from "@/components/animated-icon";
import { ConsentGate } from "@/components/consent-gate";
import { MobileAppFrame } from "@/components/mobile-app-frame";
import { Colors } from "@/constants/theme";

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

// Auth is deferred, never blocking — the route group draws up as one native
// bottom sheet over the guest's current context. Login / register / reset then
// move inside that sheet instead of stacking separate modal surfaces.
const authSheet = {
  presentation: "formSheet" as const,
  sheetAllowedDetents: [0.92],
  sheetInitialDetentIndex: 0,
  sheetGrabberVisible: true,
  sheetCornerRadius: 24,
  contentStyle: { backgroundColor: Colors.dark.background },
};

export default function RootLayout() {
  useEffect(() => {
    void initLocale();
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <ThemeProvider value={DarkTheme}>
        <StatusBar style="light" />
        <AuthProvider>
          <AnimatedSplashOverlay />
          <MobileAppFrame>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="(auth)" options={authSheet} />
              <Stack.Screen name="settings" />
              <Stack.Screen name="referrals" />
              <Stack.Screen name="delete-account" />
              <Stack.Screen name="ips" options={detailHeader} />
              <Stack.Screen name="ip/[id]" options={detailHeader} />
              <Stack.Screen name="crew/[id]" options={detailHeader} />
              <Stack.Screen name="creator/[id]" options={detailHeader} />
              <Stack.Screen name="service/[id]" options={detailHeader} />
            </Stack>
          </MobileAppFrame>
          <ConsentGate />
        </AuthProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
});
