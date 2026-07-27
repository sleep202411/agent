import { Stack } from "expo-router";
import { useEffect } from "react";

import {
  cancelPendingAuthRequest,
  clearIsNewUserFlag,
  getAuthSnapshot,
  releasePendingAuthRequest,
} from "@/auth";
import { Colors } from "@/constants/theme";

export default function AuthLayout() {
  useEffect(() => {
    return () => {
      // System back mid-onboarding = skip: keep the session and still fire the
      // pending post-auth callback instead of cancelling it.
      if (getAuthSnapshot().session?.isNewUser) {
        void clearIsNewUserFlag();
        releasePendingAuthRequest();
        return;
      }
      cancelPendingAuthRequest();
    };
  }, []);

  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: Colors.dark.background },
        headerShown: false,
      }}
    >
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
      <Stack.Screen name="forgot-password" />
      <Stack.Screen name="profile-setup" />
      <Stack.Screen name="invite-code" />
    </Stack>
  );
}
