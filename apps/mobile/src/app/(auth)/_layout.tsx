import { Stack } from "expo-router";
import { useEffect } from "react";

import { cancelPendingAuthRequest } from "@/auth";
import { Colors } from "@/constants/theme";

export default function AuthLayout() {
  useEffect(() => {
    return () => cancelPendingAuthRequest();
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
    </Stack>
  );
}
