import { Image } from "expo-image";
import { SymbolView, type SymbolViewProps } from "expo-symbols";
import { Pressable, StyleSheet, View } from "react-native";

import { useAuth } from "@/auth";
import { TabScreen } from "@/components/tab-screen";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { ScreenHeader, SectionHeader } from "@/components/ui";
import { appEnv, resolveAssetUrl } from "@/config";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

type AppSymbol = SymbolViewProps["name"];

const menuItems: { label: string; detail: string; symbol: AppSymbol }[] = [
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
];

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

  const rawAvatar = auth.user?.avatar ?? auth.user?.headImg ?? auth.user?.headImgUrl;
  const avatarUrl =
    typeof rawAvatar === "string" && rawAvatar
      ? resolveAssetUrl(rawAvatar, appEnv.assets.userBaseUrl)
      : undefined;

  function handlePress() {
    // Account routes land in a later pass; browse modules ship first.
  }

  return (
    <TabScreen gap={Spacing.five}>
      <ScreenHeader title="Mine" />

      <ThemedView type="backgroundElement" style={styles.profilePanel}>
        <View style={[styles.avatar, { backgroundColor: theme.brand }]}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <ThemedText type="subtitle" style={styles.avatarInitial}>
              {initial}
            </ThemedText>
          )}
        </View>
        <View style={styles.profileCopy}>
          <ThemedText type="subtitle" style={styles.profileName} numberOfLines={1}>
            {displayName}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {accountMeta}
          </ThemedText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit profile"
          onPress={handlePress}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <View style={[styles.editButton, { backgroundColor: theme.backgroundSelected }]}>
            <SymbolView
              name={{ ios: "pencil", android: "edit", web: "edit" }}
              size={16}
              tintColor={theme.text}
            />
          </View>
        </Pressable>
      </ThemedView>

      <View style={styles.section}>
        <SectionHeader title="Account" trailing="Profile" />
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
                  <View style={[styles.menuIcon, { backgroundColor: theme.backgroundSelected }]}>
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
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => void auth.signOut()}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <ThemedView type="backgroundElement" style={styles.signOutButton}>
          <ThemedText type="smallBold" style={{ color: theme.brand }}>
            Sign out
          </ThemedText>
        </ThemedView>
      </Pressable>
    </TabScreen>
  );
}

const AVATAR = 60;

const styles = StyleSheet.create({
  profilePanel: {
    borderRadius: 8,
    padding: Spacing.three,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: 8,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    fontSize: 24,
    lineHeight: 28,
    color: "#FFFFFF",
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
  editButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  section: {
    gap: Spacing.two,
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
    width: 38,
    height: 38,
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
