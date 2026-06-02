import { SymbolView } from "expo-symbols";
import { Pressable, StyleSheet, View } from "react-native";

import { TabScreen } from "@/components/tab-screen";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

const createActions = [
  {
    label: "Create project",
    detail: "Project type, cover, episodes, team roles",
    symbol: { ios: "plus.square", android: "add_box", web: "add_box" },
  },
  {
    label: "Publish video",
    detail: "Upload a personal or promotional video",
    symbol: { ios: "play.rectangle", android: "smart_display", web: "smart_display" },
  },
  {
    label: "New world",
    detail: "Story foundation, characters, scenes, props",
    symbol: { ios: "sparkles", android: "auto_awesome", web: "auto_awesome" },
  },
  {
    label: "Recruit crew",
    detail: "Open project roles and review applicants",
    symbol: { ios: "person.2", android: "group", web: "group" },
  },
] as const;

const workflowSteps = [
  { label: "World", detail: "Set foundation" },
  { label: "Project", detail: "Add episodes" },
  { label: "Crew", detail: "Assign roles" },
  { label: "Video", detail: "Publish work" },
] as const;

export default function CreateScreen() {
  const theme = useTheme();

  function handlePress() {
    // TODO: connect to createProject, publicVideo, and worldview routes.
  }

  return (
    <TabScreen gap={Spacing.four}>
      <View style={styles.header}>
        <ThemedText type="small" themeColor="textSecondary">
          Studio actions
        </ThemedText>
        <ThemedText type="title" style={styles.title}>
          Create
        </ThemedText>
      </View>

      <View style={styles.actionList}>
        {createActions.map((action) => (
          <Pressable
            key={action.label}
            accessibilityRole="button"
            onPress={handlePress}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <ThemedView type="backgroundElement" style={styles.actionRow}>
              <View style={[styles.actionIcon, { backgroundColor: theme.brand }]}>
                <SymbolView name={action.symbol} size={19} tintColor="#FFFFFF" />
              </View>
              <View style={styles.actionCopy}>
                <ThemedText type="smallBold">{action.label}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                  {action.detail}
                </ThemedText>
              </View>
              <SymbolView
                name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }}
                size={16}
                tintColor={theme.textSecondary}
              />
            </ThemedView>
          </Pressable>
        ))}
      </View>

      <View style={styles.sectionHeader}>
        <ThemedText type="smallBold">Production flow</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          App modules
        </ThemedText>
      </View>

      <ThemedView type="backgroundElement" style={styles.workflowPanel}>
        {workflowSteps.map((step, index) => (
          <View
            key={step.label}
            style={[
              styles.workflowRow,
              index < workflowSteps.length - 1 && {
                borderBottomColor: theme.border,
                borderBottomWidth: 1,
              },
            ]}
          >
            <ThemedText type="smallBold">{step.label}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {step.detail}
            </ThemedText>
          </View>
        ))}
      </ThemedView>
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
  actionList: {
    gap: Spacing.two,
  },
  actionRow: {
    minHeight: 72,
    borderRadius: 8,
    padding: Spacing.three,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  actionCopy: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.half,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  workflowPanel: {
    borderRadius: 8,
    overflow: "hidden",
  },
  workflowRow: {
    minHeight: 58,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.three,
  },
  pressed: {
    opacity: 0.72,
  },
});
