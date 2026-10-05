import { StoryLibraryEditor } from "@/features/agent/components/story-library-editor";
import { TextAdventures } from "@/features/agent/text-adventures";
import { ContentReviewHistory } from "@/features/agent/content-review-history";
import { WorkspaceAnalyticsScreen } from "@/features/agent/workspace-analytics";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
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

import { useAuth, useAuthGate } from "@/auth";
import { getAuthGeneration } from "@/auth/auth-store";
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
  loadAgentWorkspaces,
  canCreateStudioProject,
  type StudioWorkspace,
  StoryProjectCard,
  type CreateStoryProjectValues,
  type StoryProjectSummary,
} from "@/features/agent";
import { PlatformProjectDirectory } from "@/features/agent/platform-project-directory";
import { StudioWorkspaceSettingsScreen } from "@/features/agent/studio-workspace-settings";
import { StudioMembers } from "@/features/agent/studio-members";
import { StudioInviteAccept } from "@/features/agent/studio-invite-accept";
import { studioInviteTargetRoute } from "@/features/agent/api/studio-invite-accept-api";
import { StudioInvites } from "@/features/agent/studio-invites";
import type { StudioInviteScope } from "@/features/agent/api/studio-invites-api";
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
  const { generation } = useAuth();
  const { workspace } = useLocalSearchParams<{ workspace?: string | string[] }>();
  const initialWorkspace =
    typeof workspace === "string" && isAgentOsId(workspace) ? workspace : undefined;
  return (
    <AgentHubSession
      key={`${generation}:${initialWorkspace ?? ""}`}
      generation={generation}
      initialWorkspace={initialWorkspace}
    />
  );
}

function AgentHubSession({
  generation,
  initialWorkspace,
}: {
  generation: number;
  initialWorkspace?: string;
}) {
  const t = useTranslations();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { requireAuth, isAuthenticated } = useAuthGate();
  const { user } = useAuth();
  const userId = String(user?.userId ?? user?.id ?? "");
  const [editingStory, setEditingStory] = useState<{ projectId: string; generation: number }>();
  const [platformWorkspace, setPlatformWorkspace] = useState<StudioWorkspace>();
  const [adventuresOpen, setAdventuresOpen] = useState(false);
  const [joiningInvite, setJoiningInvite] = useState(false);
  const [reviewWorkspace, setReviewWorkspace] = useState<string>();
  const [analyticsWorkspace, setAnalyticsWorkspace] = useState<string>();
  const [workspaceSettings, setWorkspaceSettings] = useState<{ id?: string }>();
  const [memberScope, setMemberScope] = useState<StudioInviteScope>();
  const [inviteScope, setInviteScope] = useState<StudioInviteScope>();
  const [projects, setProjects] = useState<StoryProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [workspaceMissing, setWorkspaceMissing] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const loadedOnceRef = useRef(false);
  const [workspaces, setWorkspaces] = useState<StudioWorkspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string>();
  const selectedWorkspaceRef = useRef<string | undefined>(initialWorkspace);
  const creatingRef = useRef(false);
  const selectedWorkspace = workspaces.find((row) => row.id === workspaceId);
  const readController = useRef<AbortController | null>(null);

  const loadProjects = useCallback(
    async (opts?: { blocking?: boolean; workspaceId?: string }) => {
      readController.current?.abort();
      const controller = new AbortController();
      readController.current = controller;
      const current = () => !controller.signal.aborted && generation === getAuthGeneration();
      const blocking = opts?.blocking ?? !loadedOnceRef.current;
      if (blocking) setLoading(true);
      setError(undefined);
      setWorkspaceMissing(false);
      let workspaceReadSucceeded = false;
      try {
        const choices = await loadAgentWorkspaces(controller.signal);
        if (!current()) return;
        workspaceReadSucceeded = true;
        const requestedId = opts?.workspaceId ?? selectedWorkspaceRef.current;
        const selected = requestedId
          ? choices.find((row) => row.id === requestedId)
          : (choices.find((row) => row.isDefault) ?? choices[0]);
        setWorkspaces(choices);
        setWorkspaceId(selected?.id);
        if (!selected) {
          setProjects([]);
          setWorkspaceMissing(!!requestedId);
          return;
        }
        selectedWorkspaceRef.current = selected.id;
        if (requestedId !== selected.id) setProjects([]);
        const { projects: rows } = await loadAgentProjects(controller.signal, selected.id);
        if (!current()) return;
        setProjects(rows);
        loadedOnceRef.current = true;
      } catch (err) {
        if (!current()) return;
        setError(err instanceof Error ? err.message : String(err));
        setProjects([]);
        // A Story service failure must not hide independently available Studio
        // projects/settings. Only retire workspace access when that read failed.
        if (!workspaceReadSucceeded) {
          setWorkspaces([]);
          setWorkspaceId(undefined);
        }
      } finally {
        if (current()) setLoading(false);
      }
    },
    [generation]
  );

  useFocusEffect(
    useCallback(() => {
      if (!isAuthenticated) {
        setProjects([]);
        loadedOnceRef.current = false;
        return;
      }
      void loadProjects();
      return () => readController.current?.abort();
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
      if (creatingRef.current || !selectedWorkspace || !canCreateStudioProject(selectedWorkspace))
        return;
      creatingRef.current = true;
      setCreating(true);

      void (async () => {
        try {
          const { project, chapterId } = await createAgentProject({
            workspaceId: selectedWorkspace.id,
            title: values.title,
            summary: values.summary,
          });
          if (generation !== getAuthGeneration()) return;
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
          if (generation !== getAuthGeneration()) return;
          Alert.alert(
            t("agent.createProjectFailed"),
            err instanceof Error ? err.message : String(err)
          );
        } finally {
          creatingRef.current = false;
          if (generation === getAuthGeneration()) setCreating(false);
        }
      })();
    },
    [selectedWorkspace, generation, router, t]
  );

  if (reviewWorkspace)
    return (
      <ContentReviewHistory
        workspaceId={reviewWorkspace}
        generation={generation}
        onClose={() => setReviewWorkspace(undefined)}
      />
    );
  if (adventuresOpen) return <TextAdventures onClose={() => setAdventuresOpen(false)} />;
  if (analyticsWorkspace)
    return (
      <WorkspaceAnalyticsScreen
        workspaceId={analyticsWorkspace}
        generation={generation}
        onClose={() => setAnalyticsWorkspace(undefined)}
      />
    );

  if (editingStory && isAuthenticated && userId)
    return (
      <StoryLibraryEditor
        scope={editingStory}
        userId={userId}
        workspaces={workspaces}
        onClose={() => {
          setEditingStory(undefined);
          void loadProjects();
        }}
        onSaved={(archived, movedWorkspaceId) => {
          if (archived || movedWorkspaceId) setEditingStory(undefined);
          void loadProjects(
            movedWorkspaceId ? { blocking: true, workspaceId: movedWorkspaceId } : undefined
          );
        }}
      />
    );
  if (workspaceSettings)
    return (
      <StudioWorkspaceSettingsScreen
        workspaceId={workspaceSettings.id}
        generation={generation}
        onClose={() => setWorkspaceSettings(undefined)}
        onDone={(id) => {
          setWorkspaceSettings(undefined);
          setProjects([]);
          selectedWorkspaceRef.current = id;
          setWorkspaceId(id);
          void loadProjects({ blocking: true, workspaceId: id });
        }}
      />
    );
  if (platformWorkspace)
    return (
      <PlatformProjectDirectory
        workspace={platformWorkspace}
        generation={generation}
        onClose={() => setPlatformWorkspace(undefined)}
      />
    );
  if (memberScope)
    return (
      <StudioMembers
        scope={memberScope}
        generation={generation}
        onClose={() => setMemberScope(undefined)}
      />
    );
  if (joiningInvite)
    return (
      <StudioInviteAccept
        generation={generation}
        onClose={() => setJoiningInvite(false)}
        onOpen={async (target) => {
          if (target.scope === "project") {
            router.push(toHref(studioInviteTargetRoute(target)));
            return;
          }
          setJoiningInvite(false);
          if (target.scope === "story-project")
            openThread(target.storyProjectId, target.targetName);
          else {
            setProjects([]);
            void loadProjects({ blocking: true, workspaceId: target.workspaceId });
          }
        }}
      />
    );
  if (inviteScope)
    return (
      <StudioInvites
        scope={inviteScope}
        generation={generation}
        onClose={() => setInviteScope(undefined)}
      />
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

        {isAuthenticated && workspaces.length > 0 && (
          <View style={{ gap: Spacing.two }}>
            <ThemedText type="smallBold">{t("agent.workspaceLabel")}</ThemedText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {workspaces.map((workspace) => (
                <Pressable
                  key={workspace.id}
                  accessibilityRole="radio"
                  accessibilityState={{
                    selected: workspace.id === workspaceId,
                    disabled: creating || loading,
                  }}
                  disabled={creating || loading}
                  onPress={() => {
                    if (creatingRef.current || workspace.id === selectedWorkspaceRef.current)
                      return;
                    selectedWorkspaceRef.current = workspace.id;
                    setWorkspaceId(workspace.id);
                    setProjects([]);
                    void loadProjects({ blocking: true, workspaceId: workspace.id });
                  }}
                  style={[
                    styles.banner,
                    {
                      marginRight: Spacing.two,
                      borderColor: workspace.id === workspaceId ? theme.brand : theme.textSecondary,
                    },
                  ]}
                >
                  <ThemedText type="small">{workspace.name}</ThemedText>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        {isAuthenticated && (
          <Pressable
            accessibilityRole="button"
            onPress={() => setAdventuresOpen(true)}
            style={[styles.banner, { borderColor: theme.textSecondary }]}
          >
            <ThemedText type="small">{t("textAdventure.title")}</ThemedText>
          </Pressable>
        )}
        {isAuthenticated && (
          <Pressable
            disabled={creating || loading}
            onPress={() => setWorkspaceSettings({})}
            style={[styles.banner, { borderColor: theme.textSecondary }]}
          >
            <ThemedText type="small">{t("studioWorkspace.create")}</ThemedText>
          </Pressable>
        )}
        {selectedWorkspace?.accessScope === "workspace" && (
          <Pressable
            accessibilityRole="button"
            disabled={creating || loading}
            onPress={() => setReviewWorkspace(selectedWorkspace.id)}
            style={[styles.banner, { borderColor: theme.textSecondary }]}
          >
            <ThemedText type="small">{t("contentReviewHistory.title")}</ThemedText>
          </Pressable>
        )}
        {selectedWorkspace?.accessScope === "workspace" && (
          <Pressable
            accessibilityRole="button"
            disabled={creating || loading}
            onPress={() => setAnalyticsWorkspace(selectedWorkspace.id)}
            style={[styles.banner, { borderColor: theme.textSecondary }]}
          >
            <ThemedText type="small">{t("workspaceAnalytics.title")}</ThemedText>
          </Pressable>
        )}
        {selectedWorkspace && (
          <Pressable
            disabled={creating || loading}
            onPress={() => setWorkspaceSettings({ id: selectedWorkspace.id })}
            style={[styles.banner, { borderColor: theme.textSecondary }]}
          >
            <ThemedText type="small">{t("studioWorkspace.settings")}</ThemedText>
          </Pressable>
        )}
        {selectedWorkspace && (
          <Pressable
            disabled={creating || loading}
            onPress={() => setPlatformWorkspace(selectedWorkspace)}
            style={[styles.banner, { borderColor: theme.textSecondary }]}
          >
            <ThemedText type="small">{t("studioProjects.title")}</ThemedText>
          </Pressable>
        )}
        {selectedWorkspace?.accessScope === "workspace" && (
          <Pressable
            disabled={creating || loading}
            onPress={() =>
              setMemberScope({
                kind: "workspace",
                id: selectedWorkspace.id,
                name: selectedWorkspace.name,
              })
            }
            style={[styles.banner, { borderColor: theme.textSecondary }]}
          >
            <ThemedText type="small">{t("studioMembers.title")}</ThemedText>
          </Pressable>
        )}
        {selectedWorkspace?.accessScope === "workspace" &&
          ["owner", "admin"].includes(selectedWorkspace.role ?? "") && (
            <Pressable
              disabled={creating || loading}
              onPress={() =>
                setInviteScope({
                  kind: "workspace",
                  id: selectedWorkspace.id,
                  name: selectedWorkspace.name,
                })
              }
              style={[styles.banner, { borderColor: theme.textSecondary }]}
            >
              <ThemedText type="small">{t("studioInvites.title")}</ThemedText>
            </Pressable>
          )}
        {isAuthenticated && (
          <Pressable
            disabled={creating}
            onPress={() => setJoiningInvite(true)}
            style={[styles.banner, { borderColor: theme.textSecondary }]}
          >
            <ThemedText type="small">{t("studioJoin.title")}</ThemedText>
          </Pressable>
        )}
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
        ) : selectedWorkspace && canCreateStudioProject(selectedWorkspace) ? (
          <CreateStoryProjectForm
            key={workspaceId}
            busy={creating || loading}
            onSubmit={onCreate}
            submitLabel={t("agent.startCreating")}
          />
        ) : selectedWorkspace ? (
          <ThemedText type="small" themeColor="textSecondary">
            {t("agent.workspaceViewOnly")}
          </ThemedText>
        ) : null}

        {isAuthenticated && loading && projects.length === 0 ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={theme.brand} />
            <ThemedText type="small" themeColor="textSecondary">
              {t("agent.loadingProjects")}
            </ThemedText>
          </View>
        ) : null}

        {error || workspaceMissing ? (
          <View style={[styles.banner, { borderColor: theme.brand }]}>
            <ThemedText type="small" style={{ color: theme.brand }}>
              {error ?? t("aiLab.workspaceUnavailable")}
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
                        {userId &&
                        (project.capabilities?.includes("story.edit") ||
                          project.capabilities?.includes("story.admin")) ? (
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => setEditingStory({ projectId: project.id, generation })}
                            style={{
                              padding: Spacing.two,
                              minHeight: 44,
                              justifyContent: "center",
                            }}
                          >
                            <ThemedText type="small">{t("storyLibrary.title")}</ThemedText>
                          </Pressable>
                        ) : null}
                        {project.capabilities?.includes("story.read") && (
                          <Pressable
                            onPress={() =>
                              setMemberScope({
                                kind: "story-project",
                                id: project.id,
                                name: project.title,
                              })
                            }
                            style={{ padding: Spacing.two }}
                          >
                            <ThemedText type="small">{t("studioMembers.title")}</ThemedText>
                          </Pressable>
                        )}
                        {project.capabilities?.includes("story.admin") && (
                          <Pressable
                            onPress={() =>
                              setInviteScope({
                                kind: "story-project",
                                id: project.id,
                                name: project.title,
                              })
                            }
                            style={{ padding: Spacing.two }}
                          >
                            <ThemedText type="small">{t("studioInvites.title")}</ThemedText>
                          </Pressable>
                        )}
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
