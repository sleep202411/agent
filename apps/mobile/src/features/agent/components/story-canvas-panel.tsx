import { useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/auth";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { ThemedText } from "@/components/themed-text";
import { useStoryChapterContext } from "../context/story-chapter-context";
import type { CandidateScope } from "../api/story-candidates-api";
import { StoryCanvasReader } from "./story-canvas-reader";
import { StoryCandidatesPanel } from "./story-candidates-panel";
import { canvasOverview } from "../lib/story-canvas-overview";

export function StoryCanvasEntry() {
  const context = useStoryChapterContext(),
    auth = useAuth(),
    active = useScreenActive(),
    t = useTranslations();
  const [open, setOpen] = useState(false);
  const scope = useMemo(
    () => ({ projectId: context.projectId, generation: auth.generation }),
    [context.projectId, auth.generation]
  );
  if (auth.status !== "authenticated" || !context.capabilities.includes("story.read")) return null;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        disabled={context.loading || !!context.error}
        onPress={() => setOpen(true)}
        style={{ padding: 10 }}
      >
        <ThemedText type="small">{t("storyCanvas.title")}</ThemedText>
      </Pressable>
      {open && active && !context.loading && !context.error && (
        <StoryCanvasPanel
          key={`${scope.projectId}:${scope.generation}`}
          scope={scope}
          userId={String(auth.user?.userId ?? auth.user?.id ?? "")}
          canEdit={context.capabilities.includes("story.edit")}
          close={() => setOpen(false)}
        />
      )}
    </>
  );
}
export function StoryCanvasPanel({
  scope,
  userId,
  canEdit,
  close,
}: {
  scope: CandidateScope;
  userId: string;
  canEdit: boolean;
  close(): void;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    insets = useSafeAreaInsets();
  const [attempt, setAttempt] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<string>();
  const [overview, setOverview] = useState<ReturnType<typeof canvasOverview>>();
  const [tab, setTab] = useState<"nodes" | "media">("nodes"),
    [selected, setSelected] = useState<string>();
  const reload = () => {
    setOverview(undefined);
    setError(undefined);
    setLoading(true);
    setAttempt((n) => n + 1);
  };
  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingTop: insets.top + 12,
          paddingBottom: insets.bottom + 12,
          paddingHorizontal: 16,
          gap: 12,
        }}
      >
        <View
          style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
        >
          <ThemedText type="smallBold">{t("storyCanvas.title")}</ThemedText>
          <Pressable accessibilityRole="button" onPress={close} style={{ padding: 12 }}>
            <ThemedText type="small">{t("agent.close")}</ThemedText>
          </Pressable>
        </View>
        {loading && <ActivityIndicator />}
        {loading && (
          <StoryCanvasReader
            key={attempt}
            scope={scope}
            title={t("storyCanvas.title")}
            runtimeError={t("storyCanvas.loadError")}
            onError={(message) => {
              setError(message);
              setLoading(false);
            }}
            onResult={(snapshot) => {
              try {
                setOverview(canvasOverview(snapshot));
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : String(cause));
              }
              setLoading(false);
            }}
          />
        )}
        {error && (
          <ThemedText type="small" accessibilityRole="alert">
            {error}
          </ThemedText>
        )}
        {!loading && (
          <Pressable accessibilityRole="button" onPress={reload} style={{ paddingVertical: 10 }}>
            <ThemedText type="small">
              {t(error ? "common.retry" : "storyCanvas.refresh")}
            </ThemedText>
          </Pressable>
        )}
        {overview && (
          <>
            <View style={{ flexDirection: "row", gap: 16 }}>
              {(["nodes", "media"] as const).map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: tab === value }}
                  onPress={() => setTab(value)}
                  style={{
                    paddingVertical: 10,
                    borderBottomWidth: tab === value ? 2 : 0,
                    borderColor: theme.brand,
                  }}
                >
                  <ThemedText type="small">
                    {t(value === "nodes" ? "storyCanvas.nodes" : "storyCanvas.media")} (
                    {value === "nodes" ? overview.nodes.length : overview.assets.length})
                  </ThemedText>
                </Pressable>
              ))}
            </View>
            <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: 16 }}>
              {(tab === "nodes" ? overview.nodes.length === 0 : overview.assets.length === 0) && (
                <ThemedText type="small">{t("storyCanvas.empty")}</ThemedText>
              )}
              {tab === "nodes"
                ? overview.nodes.map((node) => (
                    <View
                      key={node.id}
                      style={{
                        padding: 12,
                        gap: 8,
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: theme.border,
                      }}
                    >
                      <ThemedText type="smallBold">{node.title}</ThemedText>
                      {!!node.text && <ThemedText type="small">{node.text}</ThemedText>}
                    </View>
                  ))
                : overview.assets.map((asset) => (
                    <View
                      key={asset.id}
                      style={{
                        padding: 12,
                        gap: 8,
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: theme.border,
                      }}
                    >
                      <ThemedText type="smallBold">
                        {asset.name || t(`storyCanvas.${asset.kind}`)}
                      </ThemedText>
                      <ThemedText type="small">{t(`storyCanvas.${asset.kind}`)}</ThemedText>
                      {canEdit && asset.mediaAssetId && (
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => setSelected(asset.mediaAssetId)}
                          style={{ paddingVertical: 10 }}
                        >
                          <ThemedText type="small">{t("storyCanvas.saveCandidate")}</ThemedText>
                        </Pressable>
                      )}
                    </View>
                  ))}
            </ScrollView>
          </>
        )}
        {selected && (
          <StoryCandidatesPanel
            scope={scope}
            userId={userId}
            mediaAssetId={selected}
            close={() => setSelected(undefined)}
          />
        )}
      </View>
    </Modal>
  );
}
