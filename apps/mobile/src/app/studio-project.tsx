import { useEffect, useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { PlatformProjectSections } from "@/features/agent/platform-project-sections";
import {
  readPlatformProject,
  resolvePlatformProject,
  type PlatformProject,
} from "@/features/agent/api/platform-projects-api";
import { isAgentOsId } from "@/features/agent/lib/ids";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { toHref } from "@/lib/navigation";

export default function StudioProjectScreen() {
  const params = useLocalSearchParams<{
    projectId?: string | string[];
    workspaceId?: string | string[];
  }>();
  const auth = useAuth(),
    gate = useAuthGate(),
    router = useRouter(),
    theme = useTheme(),
    t = useTranslations();
  const projectId = typeof params.projectId === "string" ? params.projectId.trim() : "";
  const workspaceId = typeof params.workspaceId === "string" ? params.workspaceId.trim() : "";
  const valid =
    isAgentOsId(projectId) && (params.workspaceId === undefined || isAgentOsId(workspaceId));
  const close = (resolvedWorkspaceId = workspaceId) =>
    router.canGoBack()
      ? router.back()
      : router.replace(
          toHref(
            valid && isAgentOsId(resolvedWorkspaceId)
              ? `/studio-projects?workspaceId=${resolvedWorkspaceId}`
              : "/agent"
          )
        );
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: t("studioProjects.title"),
          headerBackButtonDisplayMode: "minimal",
        }}
      />
      {!valid ? (
        <View style={{ padding: 16, gap: 12 }}>
          <ThemedText accessibilityRole="alert">{t("studioProjects.invalidLink")}</ThemedText>
          <Pressable accessibilityRole="button" onPress={() => close()}>
            <ThemedText>{t("common.back")}</ThemedText>
          </Pressable>
        </View>
      ) : auth.status === "hydrating" ? (
        <ActivityIndicator />
      ) : auth.status !== "authenticated" ? (
        <Pressable
          accessibilityRole="button"
          style={{ padding: 16 }}
          onPress={() => gate.requireAuth()}
        >
          <ThemedText>{t("login.signIn")}</ThemedText>
        </Pressable>
      ) : (
        <ProjectEntry
          key={`${auth.generation}:${projectId}:${workspaceId}`}
          projectId={projectId}
          workspaceId={workspaceId}
          generation={auth.generation}
          onClose={close}
        />
      )}
    </View>
  );
}
function ProjectEntry({
  projectId,
  workspaceId,
  generation,
  onClose,
}: {
  projectId: string;
  workspaceId: string;
  generation: number;
  onClose: (workspaceId?: string) => void;
}) {
  const active = useScreenActive(),
    t = useTranslations();
  const [project, setProject] = useState<PlatformProject>();
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!active || project) return;
    const controller = new AbortController();
    void (
      workspaceId
        ? readPlatformProject(projectId, workspaceId, generation, controller.signal)
        : resolvePlatformProject(projectId, generation, controller.signal)
    ).then(
      (value) => {
        if (!controller.signal.aborted) setProject(value);
      },
      (reason) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : String(reason));
      }
    );
    return () => controller.abort();
  }, [active, project, projectId, workspaceId, generation, retry]);
  // Chapters/canvas own ongoing permission refresh and draft recovery. Keep them
  // mounted across backgrounding instead of replacing them with this entry read.
  if (project)
    return (
      <PlatformProjectSections
        projectId={projectId}
        workspaceId={project.workspaceId}
        name={project.name}
        generation={generation}
        onClose={() => onClose(project.workspaceId)}
      />
    );
  return (
    <View style={{ padding: 16, gap: 12 }}>
      {error ? (
        <>
          <ThemedText accessibilityRole="alert">{error}</ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setError(undefined);
              setRetry((v) => v + 1);
            }}
          >
            <ThemedText>{t("common.retry")}</ThemedText>
          </Pressable>
        </>
      ) : (
        <ActivityIndicator />
      )}
      <Pressable accessibilityRole="button" onPress={() => onClose()}>
        <ThemedText>{t("common.back")}</ThemedText>
      </Pressable>
    </View>
  );
}
