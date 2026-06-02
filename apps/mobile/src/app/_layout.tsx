import { StatusBar } from "expo-status-bar";
import { DarkTheme, Stack, ThemeProvider } from "expo-router";

import "@/global.css";
import { AuthProvider } from "@/auth";
import { AnimatedSplashOverlay } from "@/components/animated-icon";

export default function RootLayout() {
  return (
    <ThemeProvider value={DarkTheme}>
      <StatusBar style="light" />
      <AuthProvider>
        <AnimatedSplashOverlay />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="login" />
        </Stack>
      </AuthProvider>
    </ThemeProvider>
  );
}
