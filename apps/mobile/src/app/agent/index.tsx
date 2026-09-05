import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { ScreenHeader } from "@/components/ui";
import { MaxContentWidth, Spacing } from "@/constants/theme";
import {
  AGENT_OS_STORY_WORKBENCH_MODE,
  createAgentProject,
  CreateStoryProjectForm,
  isAgentOsId,
  loadAgentProjects,
  StoryProjectCard,
  type CreateStoryProjectValues,
  type StoryProjectSummary,
} from "@/features/agent";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { toHref } from "@/lib/navigation";

function chunkPairs<T>(items: T[]): [T, T | undefined][] {
  const rows: [T, T | undefined][] = [];
  for (let i = 0; i < items.length; i += 2) {
    rows.push([items[i], items[i + 1]]);
  }
  return rows;
}

/** Create hub — name a new story project or continue an existing one. */
export default function AgentHubScreen() {
  const t = useTranslations();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { requireAuth, isAuthenticated } = useAuthGate();
  const [projects, setProjects] = useState<StoryProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const loadedOnceRef = useRef(false);

  const loadProjects = useCallback(async (opts?: { blocking?: boolean }) => {
    const blocking = opts?.blocking ?? !loadedOnceRef.current;
    if (blocking) setLoading(true);
    setError(undefined);
    try {
      const { projects: rows } = await loadAgentProjects();
      setProjects(rows);
      loadedOnceRef.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setProjects([]);
    } finally {
      if (blocking) setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!isAuthenticated) {
        setProjects([]);
        loadedOnceRef.current = false;
        return;
      }
      void loadProjects();
    }, [isAuthenticated, loadProjects])
  );

  const openThread = useCallback(
    (projectId: string, title?: string) => {
      requireAuth({
        onAuthenticated: () => {
          const q = new URLSearchParams({
            mode: AGENT_OS_STORY_WORKBENCH_MODE,
          });
          if (title?.trim()) q.set("title", title.trim());
          router.push(toHref(`/agent/${projectId}?${q.toString()}`));
        },
      });
    },
    [requireAuth, router]
  );

  const onCreate = useCallback(
    (values: CreateStoryProjectValues) => {
      if (creating) return;
      setCreating(true);

      void (async () => {
        try {
          const { project, chapterId } = await createAgentProject({
            title: values.title,
            summary: values.summary,
          });
          if (!isAgentOsId(project.id)) {
            throw new Error(`Invalid story project id: ${project.id}`);
          }
          const q = new URLSearchParams({
            mode: AGENT_OS_STORY_WORKBENCH_MODE,
          });
          if (isAgentOsId(chapterId)) q.set("chapterId", chapterId);
          const createdTitle = project.title?.trim() || values.title.trim();
          if (createdTitle) q.set("title", createdTitle);
          router.push(toHref(`/agent/${project.id}?${q.toString()}`));
        } catch (err) {
          Alert.alert(
            t("agent.createProjectFailed"),
            err instanceof Error ? err.message : String(err)
          );
        } finally {
          setCreating(false);
        }
      })();
    },
    [creating, router, t]
  );

  const topPad = insets.top + Spacing.seven;
  const sidePad = {
    paddingLeft: Math.max(insets.left, Spacing.four),
    paddingRight: Math.max(insets.right, Spacing.four),
  };

  return (
    <ThemedView style={styles.screen}>
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: theme.background }}
        refreshControl={
          isAuthenticated ? (
            <RefreshControl
              refreshing={loading && projects.length > 0}
              onRefresh={() => void loadProjects({ blocking: true })}
              tintColor={theme.brand}
            />
          ) : undefined
        }
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: topPad,
            paddingBottom: insets.bottom + Spacing.seven,
            ...sidePad,
          },
        ]}
      >
        <ScreenHeader title={t("agent.title")} />
        <ThemedText type="small" themeColor="textSecondary">
          {t("agent.hubSubtitle")}
        </ThemedText>

        {!isAuthenticated ? (
          <Pressable
            onPress={() => requireAuth({ onAuthenticated: () => void loadProjects() })}
            style={({ pressed }) => [
              styles.banner,
              { borderColor: theme.brand },
              pressed && styles.pressed,
            ]}
          >
            <ThemedText type="smallBold" style={{ color: theme.brand }}>
              {t("agent.signInToLoadProjects")}
            </ThemedText>
          </Pressable>
        ) : (
          <CreateStoryProjectForm
            busy={creating}
            onSubmit={onCreate}
            submitLabel={t("agent.startCreating")}
          />
        )}

        {isAuthenticated && loading && projects.length === 0 ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={theme.brand} />
            <ThemedText type="small" themeColor="textSecondary">
              {t("agent.loadingProjects")}
            </ThemedText>
          </View>
        ) : null}

        {error ? (
          <View style={[styles.banner, { borderColor: theme.brand }]}>
            <ThemedText type="small" style={{ color: theme.brand }}>
              {error}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" onPress={() => void loadProjects()}>
              {t("common.retry")}
            </ThemedText>
          </View>
        ) : null}

        {isAuthenticated && !loading && projects.length === 0 && !error ? (
          <ThemedText type="small" themeColor="textSecondary">
            {t("agent.projectsEmpty")}
          </ThemedText>
        ) : null}

        {isAuthenticated && projects.length > 0 ? (
          <View style={styles.projectsSection}>
            <ThemedText type="smallBold">{t("agent.projectsTitle")}</ThemedText>
            <View style={styles.grid}>
              {chunkPairs(projects).map((row, rowIndex) => (
                <View key={rowIndex} style={styles.gridRow}>
                  {row.map((project, cellIndex) => {
                    if (!project) {
                      return (
                        <View key={`empty-${rowIndex}-${cellIndex}`} style={styles.cardCell} />
                      );
                    }
                    return (
                      <View key={project.id} style={styles.cardCell}>
                        <StoryProjectCard
                          project={project}
                          onPress={() => openThread(project.id, project.title)}
                        />
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    width: "100%",
    maxWidth: MaxContentWidth,
    alignSelf: "center",
    gap: Spacing.three,
  },
  banner: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.two,
  },
  projectsSection: {
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  grid: {
    gap: Spacing.three,
  },
  gridRow: {
    flexDirection: "row",
    gap: Spacing.three,
  },
  cardCell: {
    flex: 1,
    minWidth: 0,
  },
  pressed: {
    opacity: 0.8,
  },
});
