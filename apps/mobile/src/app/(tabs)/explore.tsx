import { Image } from "expo-image";
import { SymbolView } from "expo-symbols";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { TabScreen } from "@/components/tab-screen";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { getJoinedProjects, getMyProjects, type ProjectItem } from "@/services/mobile-content";

const segments = ["Created", "Joined"] as const;

export default function ProjectsScreen() {
  const [activeSegment, setActiveSegment] = useState<(typeof segments)[number]>("Created");
  const [createdProjects, setCreatedProjects] = useState<ProjectItem[]>([]);
  const [joinedProjects, setJoinedProjects] = useState<ProjectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const activeProjects = activeSegment === "Created" ? createdProjects : joinedProjects;
  const theme = useTheme();

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setError(undefined);

      try {
        const [created, joined] = await Promise.all([getMyProjects(), getJoinedProjects()]);
        if (!alive) return;
        setCreatedProjects(created);
        setJoinedProjects(joined);
      } catch (loadError) {
        if (!alive) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load projects.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    void load();
    return () => {
      alive = false;
    };
  }, []);

  function handlePress() {
    // TODO: connect to project detail and management routes.
  }

  return (
    <TabScreen gap={Spacing.four}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <ThemedText type="small" themeColor="textSecondary">
            Project Center
          </ThemedText>
          <ThemedText type="title" style={styles.title}>
            Projects
          </ThemedText>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={handlePress}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <ThemedView type="backgroundElement" style={styles.iconButton}>
            <SymbolView
              name={{ ios: "plus", android: "add", web: "add" }}
              size={20}
              tintColor={theme.text}
            />
          </ThemedView>
        </Pressable>
      </View>

      <ThemedView type="backgroundElement" style={styles.segmentedControl}>
        {segments.map((segment) => {
          const selected = activeSegment === segment;

          return (
            <Pressable
              key={segment}
              accessibilityRole="button"
              onPress={() => setActiveSegment(segment)}
              style={({ pressed }) => [styles.segmentPressable, pressed && styles.pressed]}
            >
              <ThemedView
                type={selected ? "backgroundSelected" : "backgroundElement"}
                style={styles.segmentButton}
              >
                <ThemedText type="smallBold" themeColor={selected ? "text" : "textSecondary"}>
                  {segment}
                </ThemedText>
              </ThemedView>
            </Pressable>
          );
        })}
      </ThemedView>

      <View style={styles.sectionHeader}>
        <ThemedText type="smallBold">{activeSegment} projects</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {loading ? "Loading" : `${activeProjects.length} items`}
        </ThemedText>
      </View>

      {error ? <StatePanel title="Project list failed" detail={error} /> : null}

      {loading ? (
        <LoadingRows />
      ) : activeProjects.length ? (
        <View style={styles.projectList}>
          {activeProjects.map((project) => (
            <ProjectListRow key={project.id} project={project} onPress={handlePress} />
          ))}
        </View>
      ) : (
        <StatePanel
          title={activeSegment === "Created" ? "No created projects" : "No joined projects"}
          detail={
            activeSegment === "Created"
              ? "Create a project from the Create tab to start production."
              : "Join a crew from Story Square to see it here."
          }
        />
      )}
    </TabScreen>
  );
}

function ProjectListRow({ project, onPress }: { onPress: () => void; project: ProjectItem }) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <ThemedView type="backgroundElement" style={styles.projectRow}>
        {project.coverUrl ? (
          <Image
            source={{ uri: project.coverUrl }}
            style={styles.projectPoster}
            contentFit="cover"
          />
        ) : (
          <View style={[styles.projectPoster, styles.coverFallback]}>
            <SymbolView
              name={{ ios: "rectangle.stack", android: "view_carousel", web: "view_carousel" }}
              size={20}
              tintColor={theme.textSecondary}
            />
          </View>
        )}
        <View style={styles.projectCopy}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {project.title}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
            {project.description ?? "No description"}
          </ThemedText>
          <ThemedText type="code" themeColor="textSecondary" numberOfLines={1}>
            {project.meta ?? project.status ?? "Project"}
          </ThemedText>
        </View>
      </ThemedView>
    </Pressable>
  );
}

function LoadingRows() {
  return (
    <View style={styles.projectList}>
      {[0, 1, 2].map((item) => (
        <ThemedView key={item} type="backgroundElement" style={styles.projectRow}>
          <ThemedView type="backgroundSelected" style={styles.projectPoster} />
          <View style={styles.projectCopy}>
            <ThemedView type="backgroundSelected" style={styles.loadingTitle} />
            <ThemedView type="backgroundSelected" style={styles.loadingLine} />
            <ThemedView type="backgroundSelected" style={styles.loadingMeta} />
          </View>
        </ThemedView>
      ))}
    </View>
  );
}

function StatePanel({ detail, title }: { detail: string; title: string }) {
  return (
    <ThemedView type="backgroundElement" style={styles.statePanel}>
      <ThemedText type="smallBold">{title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {detail}
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  header: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.three,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    marginTop: Spacing.half,
    fontSize: 28,
    lineHeight: 32,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentedControl: {
    minHeight: 44,
    borderRadius: 8,
    padding: Spacing.one,
    flexDirection: "row",
    gap: Spacing.one,
  },
  segmentPressable: {
    flex: 1,
  },
  segmentButton: {
    minHeight: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  projectList: {
    gap: Spacing.two,
  },
  projectRow: {
    minHeight: 106,
    borderRadius: 8,
    padding: Spacing.three,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.three,
  },
  projectPoster: {
    width: 58,
    height: 78,
    borderRadius: 8,
    overflow: "hidden",
  },
  coverFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  projectCopy: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.half,
  },
  statePanel: {
    borderRadius: 8,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  loadingTitle: {
    width: "70%",
    height: 18,
    borderRadius: 4,
  },
  loadingLine: {
    width: "100%",
    height: 36,
    borderRadius: 4,
  },
  loadingMeta: {
    width: "38%",
    height: 12,
    borderRadius: 4,
  },
  pressed: {
    opacity: 0.72,
  },
});
