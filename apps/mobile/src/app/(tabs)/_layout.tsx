import { Redirect } from "expo-router";
import { StyleSheet } from "react-native";

import { useAuth } from "@/auth";
import AppTabs from "@/components/app-tabs";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";

export default function TabLayout() {
  const auth = useAuth();

  if (auth.status === "hydrating" || auth.status === "submitting") {
    return (
      <ThemedView style={styles.loadingScreen}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          Loading workspace
        </ThemedText>
      </ThemedView>
    );
  }

  if (auth.status !== "authenticated") {
    return <Redirect href="/login" />;
  }

  return <AppTabs />;
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.four,
  },
});
