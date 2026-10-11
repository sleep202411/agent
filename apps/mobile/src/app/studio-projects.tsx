import { useEffect, useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useAuth, useAuthGate } from "@/auth";
import { ThemedText } from "@/components/themed-text";
import { PlatformProjectDirectory } from "@/features/agent/platform-project-directory";
import {
  readStudioWorkspace,
  type StudioWorkspace,
} from "@/features/agent/api/studio-projects-api";
import { isAgentOsId } from "@/features/agent/lib/ids";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { toHref } from "@/lib/navigation";

export default function StudioProjectsScreen() {
  const { workspaceId: param } = useLocalSearchParams<{ workspaceId?: string | string[] }>();
  const auth = useAuth(),
    gate = useAuthGate(),
    router = useRouter(),
    theme = useTheme(),
    t = useTranslations();
  const workspaceId = typeof param === "string" ? param.trim() : "";
  const close = () => (router.canGoBack() ? router.back() : router.replace(toHref("/agent")));
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: t("studioProjects.title"),
          headerBackButtonDisplayMode: "minimal",
        }}
      />
      {!isAgentOsId(workspaceId) ? (
        <View style={{ padding: 16, gap: 12 }}>
          <ThemedText accessibilityRole="alert">{t("studioWorkspace.invalidLink")}</ThemedText>
          <Pressable accessibilityRole="button" onPress={close}>
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
        <WorkspaceEntry
          key={`${auth.generation}:${workspaceId}`}
          workspaceId={workspaceId}
          generation={auth.generation}
          onClose={close}
        />
      )}
    </View>
  );
}
function WorkspaceEntry({
  workspaceId,
  generation,
  onClose,
}: {
  workspaceId: string;
  generation: number;
  onClose(): void;
}) {
  const active = useScreenActive(),
    t = useTranslations();
  const [workspace, setWorkspace] = useState<StudioWorkspace>();
  const [error, setError] = useState<string>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!active || workspace) return;
    const controller = new AbortController();
    void readStudioWorkspace(workspaceId, generation, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setWorkspace(value);
      },
      (reason) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : String(reason));
      }
    );
    return () => controller.abort();
  }, [active, workspace, workspaceId, generation, retry]);
  // Keep the existing directory mounted so backgrounding does not discard edits.
  // It refreshes project access and checks permissions again before mutations.
  if (workspace)
    return (
      <PlatformProjectDirectory workspace={workspace} generation={generation} onClose={onClose} />
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
      <Pressable accessibilityRole="button" onPress={onClose}>
        <ThemedText>{t("common.back")}</ThemedText>
      </Pressable>
    </View>
  );
}
