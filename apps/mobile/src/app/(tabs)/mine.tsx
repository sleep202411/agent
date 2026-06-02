import { SymbolView } from "expo-symbols";
import { Pressable, StyleSheet, View } from "react-native";

import { useAuth } from "@/auth";
import { TabScreen } from "@/components/tab-screen";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

const menuItems = [
  {
    label: "Personal portfolio",
    detail: "Works, videos, and public profile",
    symbol: { ios: "person.crop.rectangle", android: "badge", web: "badge" },
  },
  {
    label: "My projects",
    detail: "Created and joined productions",
    symbol: { ios: "folder", android: "folder", web: "folder" },
  },
  {
    label: "Role certification",
    detail: "Creator identity and credentials",
    symbol: { ios: "checkmark.seal", android: "verified", web: "verified" },
  },
  {
    label: "Account settings",
    detail: "Binding, privacy, and security",
    symbol: { ios: "gearshape", android: "settings", web: "settings" },
  },
] as const;

function getDisplayName(user: ReturnType<typeof useAuth>["user"]) {
  return (
    user?.nickName ?? user?.nickname ?? user?.userName ?? user?.name ?? user?.email ?? user?.phone
  );
}

function getAccountMeta(user: ReturnType<typeof useAuth>["user"]) {
  return user?.email ?? user?.phone ?? user?.userName ?? "FizzDragon account";
}

export default function MineScreen() {
  const auth = useAuth();
  const theme = useTheme();
  const displayName = getDisplayName(auth.user) ?? "Creator";
  const accountMeta = getAccountMeta(auth.user);
  const initial = displayName.trim().slice(0, 1).toUpperCase();

  function handlePress() {
    // TODO: connect to mobile profile and account routes.
  }

  return (
    <TabScreen gap={Spacing.five}>
      <View style={styles.header}>
        <ThemedText type="small" themeColor="textSecondary">
          FizzDragon
        </ThemedText>
        <ThemedText type="title" style={styles.title}>
          Mine
        </ThemedText>
      </View>

      <ThemedView type="backgroundElement" style={styles.profilePanel}>
        <View style={[styles.avatar, { backgroundColor: theme.brand }]}>
          <ThemedText type="smallBold">{initial}</ThemedText>
        </View>
        <View style={styles.profileCopy}>
          <ThemedText type="subtitle" style={styles.profileName} numberOfLines={1}>
            {displayName}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {accountMeta}
          </ThemedText>
        </View>
      </ThemedView>

      <View style={styles.sectionHeader}>
        <ThemedText type="smallBold">Account</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Profile
        </ThemedText>
      </View>

      <ThemedView type="backgroundElement" style={styles.menuPanel}>
        {menuItems.map((item, index) => (
          <Pressable
            key={item.label}
            accessibilityRole="button"
            onPress={handlePress}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <View
              style={[
                styles.menuRow,
                index < menuItems.length - 1 && {
                  borderBottomColor: theme.border,
                  borderBottomWidth: 1,
                },
              ]}
            >
              <View style={styles.menuLeft}>
                <View style={styles.menuIcon}>
                  <SymbolView name={item.symbol} size={18} tintColor={theme.textSecondary} />
                </View>
                <View style={styles.menuCopy}>
                  <ThemedText type="smallBold">{item.label}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {item.detail}
                  </ThemedText>
                </View>
              </View>
              <SymbolView
                name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }}
                size={16}
                tintColor={theme.textSecondary}
              />
            </View>
          </Pressable>
        ))}
      </ThemedView>

      <Pressable
        accessibilityRole="button"
        onPress={() => void auth.signOut()}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <ThemedView type="backgroundElement" style={styles.signOutButton}>
          <ThemedText type="smallBold">Sign out</ThemedText>
        </ThemedView>
      </Pressable>
    </TabScreen>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 44,
    justifyContent: "center",
  },
  title: {
    marginTop: Spacing.half,
    fontSize: 28,
    lineHeight: 32,
  },
  profilePanel: {
    borderRadius: 8,
    padding: Spacing.three,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
  },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  profileCopy: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.half,
  },
  profileName: {
    fontSize: 22,
    lineHeight: 28,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  menuPanel: {
    borderRadius: 8,
    overflow: "hidden",
  },
  menuRow: {
    minHeight: 70,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.three,
  },
  menuLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
  },
  menuIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  menuCopy: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.half,
  },
  signOutButton: {
    minHeight: 48,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.72,
  },
});
