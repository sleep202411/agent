import { useRouter } from "expo-router";
import { Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { BottomTabInset, MaxContentWidth, Spacing } from "@/constants/theme";
import { appEnv, isProductionApp } from "@/config";
import { useTheme } from "@/hooks/use-theme";

const quickActions = [
  { label: "New IP", detail: "World, crew, episodes" },
  { label: "Storyboard", detail: "Shots and script beats" },
  { label: "Video", detail: "Generation queue" },
  { label: "Crew", detail: "Roles and applicants" },
];

const studioStats = [
  { label: "Active IPs", value: "0" },
  { label: "Draft videos", value: "0" },
  { label: "Crew tasks", value: "0" },
];

function getDisplayName(user: ReturnType<typeof useAuth>["user"]) {
  return (
    user?.nickName ?? user?.nickname ?? user?.userName ?? user?.name ?? user?.email ?? user?.phone
  );
}

export default function HomeScreen() {
  const auth = useAuth();
  const router = useRouter();
  const safeAreaInsets = useSafeAreaInsets();
  const theme = useTheme();
  const topInset =
    safeAreaInsets.top + (Platform.OS === "web" ? Spacing.eight + Spacing.three : Spacing.four);
  const bottomInset = safeAreaInsets.bottom + BottomTabInset + Spacing.four;
  const regionLabel = `${appEnv.appRegion === "cn" ? "CN" : "Global"} ${appEnv.appVariant}`;
  const isAuthenticated = auth.status === "authenticated";
  const isHydrating = auth.status === "hydrating";
  const displayName = getDisplayName(auth.user);

  function openLogin() {
    router.push("/login");
  }

  function handleProtectedAction() {
    if (!isAuthenticated) {
      openLogin();
      return;
    }
  }

  return (
    <ScrollView
      style={[styles.scrollView, { backgroundColor: theme.background }]}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: topInset,
          paddingBottom: bottomInset,
          paddingLeft: Math.max(safeAreaInsets.left, Spacing.four),
          paddingRight: Math.max(safeAreaInsets.right, Spacing.four),
        },
      ]}
    >
      <View style={styles.page}>
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              FizzDragon
            </ThemedText>
            <ThemedText type="title" style={styles.title}>
              Creator workspace
            </ThemedText>
          </View>
          <View style={styles.headerActions}>
            {!isProductionApp && (
              <ThemedView type="backgroundElement" style={styles.envBadge}>
                <ThemedText type="smallBold" themeColor="textSecondary">
                  {regionLabel}
                </ThemedText>
              </ThemedView>
            )}
            {isAuthenticated ? (
              <ThemedView type="backgroundElement" style={styles.accountBadge}>
                <ThemedText type="smallBold" numberOfLines={1}>
                  {displayName ?? "Account"}
                </ThemedText>
              </ThemedView>
            ) : (
              <Pressable style={({ pressed }) => pressed && styles.pressed} onPress={openLogin}>
                <ThemedView type="backgroundElement" style={styles.accountBadge}>
                  <ThemedText type="smallBold">Sign in</ThemedText>
                </ThemedView>
              </Pressable>
            )}
          </View>
        </View>

        <View style={styles.statsGrid}>
          {studioStats.map((item) => (
            <ThemedView key={item.label} type="backgroundElement" style={styles.statCard}>
              <ThemedText type="title" style={styles.statValue}>
                {isHydrating ? "-" : item.value}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {item.label}
              </ThemedText>
            </ThemedView>
          ))}
        </View>

        <ThemedView type="backgroundElement" style={styles.primaryPanel}>
          <View style={styles.panelCopy}>
            <ThemedText type="subtitle" style={styles.panelTitle}>
              {isAuthenticated ? "Start from an IP bible" : "Sign in to sync your workspace"}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.panelText}>
              {isAuthenticated
                ? "Build the project record first, then attach episodes, roles, scenes, shots, and crew work."
                : "Access your projects, credits, production tasks, and creator profile with the same FizzDragon account."}
            </ThemedText>
          </View>
          <Pressable
            style={({ pressed }) => [
              styles.primaryButton,
              { backgroundColor: theme.brand },
              pressed && styles.pressed,
            ]}
            onPress={isAuthenticated ? handleProtectedAction : openLogin}
          >
            <ThemedText type="smallBold" style={styles.primaryButtonText}>
              {isAuthenticated ? "Create IP" : "Sign in"}
            </ThemedText>
          </Pressable>
        </ThemedView>

        <View style={styles.sectionHeader}>
          <ThemedText type="subtitle" style={styles.sectionTitle}>
            Actions
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Today
          </ThemedText>
        </View>

        <View style={styles.actionGrid}>
          {quickActions.map((item) => (
            <Pressable
              key={item.label}
              onPress={handleProtectedAction}
              style={({ pressed }) => [
                !isAuthenticated && styles.disabledAction,
                pressed && styles.pressed,
              ]}
            >
              <ThemedView type="backgroundElement" style={styles.actionCard}>
                <View style={[styles.actionMark, { backgroundColor: theme.brand }]} />
                <ThemedText type="smallBold">{item.label}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {item.detail}
                </ThemedText>
              </ThemedView>
            </Pressable>
          ))}
        </View>

        <ThemedView type="backgroundElement" style={styles.emptyPanel}>
          <ThemedText type="smallBold">
            {isAuthenticated ? "No recent projects" : "Workspace locked"}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
            {isAuthenticated
              ? "Create your first IP to start tracking drafts, roles, scenes, shots, and crew work."
              : "Sign in before creating or syncing IPs, storyboards, videos, and crew tasks."}
          </ThemedText>
        </ThemedView>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  content: {
    alignItems: "center",
  },
  page: {
    width: "100%",
    maxWidth: MaxContentWidth,
    gap: Spacing.four,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: Spacing.three,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  headerActions: {
    alignItems: "flex-end",
    gap: Spacing.two,
  },
  title: {
    marginTop: Spacing.one,
    maxWidth: 520,
    fontSize: 34,
    lineHeight: 40,
  },
  envBadge: {
    borderRadius: 8,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  accountBadge: {
    maxWidth: 180,
    minHeight: 36,
    borderRadius: 8,
    paddingHorizontal: Spacing.two,
    justifyContent: "center",
  },
  statsGrid: {
    flexDirection: "row",
    gap: Spacing.two,
  },
  statCard: {
    flex: 1,
    minHeight: 92,
    borderRadius: 8,
    padding: Spacing.three,
    justifyContent: "space-between",
  },
  statValue: {
    fontSize: 30,
    lineHeight: 34,
  },
  primaryPanel: {
    borderRadius: 8,
    padding: Spacing.four,
    gap: Spacing.four,
  },
  panelCopy: {
    gap: Spacing.two,
  },
  panelTitle: {
    fontSize: 24,
    lineHeight: 30,
  },
  panelText: {
    maxWidth: 520,
  },
  primaryButton: {
    alignSelf: "flex-start",
    minHeight: 44,
    borderRadius: 8,
    paddingHorizontal: Spacing.four,
    justifyContent: "center",
  },
  primaryButtonText: {
    color: "#FFFFFF",
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    fontSize: 22,
    lineHeight: 28,
  },
  actionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
  },
  actionCard: {
    width: 156,
    minHeight: 116,
    borderRadius: 8,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  actionMark: {
    width: 24,
    height: 3,
    borderRadius: 2,
  },
  emptyPanel: {
    borderRadius: 8,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  emptyText: {
    maxWidth: 560,
  },
  disabledAction: {
    opacity: 0.64,
  },
  pressed: {
    opacity: 0.72,
  },
});
