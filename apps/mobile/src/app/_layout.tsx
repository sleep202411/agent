import { StatusBar } from "expo-status-bar";
import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import { useEffect } from "react";

import "@/global.css";
import { AuthProvider } from "@/auth";
import { initLocale } from "@/i18n";
import { AnimatedSplashOverlay } from "@/components/animated-icon";
import { ConsentGate } from "@/components/consent-gate";
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

export default function RootLayout() {
  useEffect(() => {
    void initLocale();
  }, []);

  return (
    <ThemeProvider value={DarkTheme}>
      <StatusBar style="light" />
      <AuthProvider>
        <AnimatedSplashOverlay />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="login" />
          <Stack.Screen name="register" />
          <Stack.Screen name="forgot-password" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="delete-account" />
          <Stack.Screen name="ip/[id]" options={detailHeader} />
          <Stack.Screen name="crew/[id]" options={detailHeader} />
        </Stack>
        <ConsentGate />
      </AuthProvider>
    </ThemeProvider>
  );
}
